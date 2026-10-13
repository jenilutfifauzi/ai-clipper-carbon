"""Selection: a Transcript in, ranked Candidates out.

1. The Transcript is cut into overlapping Windows, and the Score pass scores each of them.
2. The best-scoring Windows form the shortlist.
3. The Detail pass reads the whole Transcript and proposes clips from the shortlisted Windows.
4. Post-processing turns the proposals into Candidates (see `_candidates`).

Every number used here is in SelectionTuning; the prompts are in app/prompts.py.
"""

import logging
import math
import time
from bisect import bisect_left, bisect_right
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from uuid import uuid4

from app.candidates import Candidate, Descriptions
from app.config import SelectionTuning
from app.llm import ClipProposal, Llm, LlmRequest, ScoreResponse, TransientLlmError, parse_time
from app.prompts import PROMPT_VERSION, detail_prompt, score_prompt
from app.transcript import Transcript, Word, timestamp

logger = logging.getLogger(__name__)

# Called with a status line, and the percent done when it has moved.
Progress = Callable[..., None]


@dataclass(frozen=True)
class Window:
    """A slice of the Transcript from a Word's start to a Word's end."""

    id: str
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class ScoredWindow:
    id: str
    start: float
    end: float
    # None when the Score pass left the Window out of its answer.
    score: int | None
    reason: str | None


@dataclass(frozen=True)
class Selection:
    """A run of Selection, kept with the Job so a run can be inspected: every Window's score, the
    shortlist, and the Detail pass's proposals as they came, before post-processing."""

    prompt_version: str
    target_count: int
    windows: list[ScoredWindow]
    shortlist: list[str]
    proposals: list[ClipProposal]
    candidates: list[Candidate]


def select(
    llm: Llm,
    tuning: SelectionTuning,
    transcript: Transcript,
    duration: float,
    min_secs: float,
    max_secs: float,
    progress: Progress = lambda message, percent=None: None,
) -> Selection:
    """Ranked Candidates of `min_secs` to `max_secs` from the Transcript of a `duration`-second Source."""
    length = max(tuning.window_min_secs, tuning.window_factor * max_secs)
    windows = _windows(transcript.words, length, tuning.window_overlap_secs)
    batches = _batches(windows, tuning.score_batch_size)
    steps = len(batches) + 1
    scored: list[ScoredWindow] = []
    for i, batch in enumerate(batches):
        progress(f"Scoring {len(windows)} Windows (request {i + 1} of {len(batches)})", 100 * i / steps)
        prompt = score_prompt(batch, transcript.language, duration, min_secs, max_secs)
        response = _retrying(llm.score, LlmRequest(prompt, tuning.score_temperature), tuning, progress)
        scored += _scores(batch, response)

    count = _target_count(duration, tuning)
    shortlist = _shortlist(scored, round(tuning.shortlist_factor * count), tuning.shortlist_max_overlap)
    proposals: list[ClipProposal] = []
    if shortlist:
        progress(f"Choosing {count} Candidates from {len(shortlist)} shortlisted Windows", 100 * len(batches) / steps)
        prompt = detail_prompt(transcript, shortlist, count, duration, min_secs, max_secs)
        proposals = _retrying(llm.detail, LlmRequest(prompt, tuning.detail_temperature), tuning, progress).clips

    cutter = _Cutter(transcript, duration, tuning)
    candidates = _candidates(proposals, cutter, scored, count, min_secs, max_secs)
    return Selection(PROMPT_VERSION, count, scored, [w.id for w in shortlist], proposals, candidates)


def _target_count(duration: float, tuning: SelectionTuning) -> int:
    return max(tuning.min_candidates, math.floor(duration / 60 / tuning.minutes_per_candidate + 0.5))


def _windows(words: Sequence[Word], length: float, overlap: float) -> list[Window]:
    """Windows of at most `length` seconds of whole Words, each starting at the first Word that
    starts at least `overlap` before the previous one ends. The last Window reaches back a full
    `length` from the Transcript's end instead of being a short leftover."""
    starts = [w.start for w in words]
    ends = [w.end for w in words]
    windows: list[Window] = []
    first = 0
    while first < len(words):
        last = max(first, bisect_right(ends, starts[first] + length) - 1)
        text = " ".join(w.text for w in words[first : last + 1])
        windows.append(Window(f"w{len(windows) + 1:03}", starts[first], ends[last], text))
        if last == len(words) - 1:
            break
        following = min(bisect_left(starts, ends[last] - overlap, lo=first + 1), last + 1)
        if ends[-1] - starts[following] <= length:
            following = max(first + 1, bisect_left(starts, ends[-1] - length))
        first = following
    return windows


def _batches(windows: list[Window], size: int) -> list[list[Window]]:
    """Near-equal batches of at most `size`: 9 Windows go 5 + 4, not 8 + 1, so that no Window is
    scored alone, against nothing (openshorts' clip_selection.score_batches)."""
    count = math.ceil(len(windows) / size)
    return [windows[i * len(windows) // count : (i + 1) * len(windows) // count] for i in range(count)]


def _scores(batch: list[Window], response: ScoreResponse) -> list[ScoredWindow]:
    answers = {}
    for answer in response.windows:
        answers.setdefault(answer.id, answer)
    if missing := [w.id for w in batch if w.id not in answers]:
        logger.warning("The Score pass left out Windows %s", ", ".join(missing))
    return [
        ScoredWindow(w.id, w.start, w.end, answers[w.id].score, answers[w.id].reason)
        if w.id in answers
        else ScoredWindow(w.id, w.start, w.end, None, None)
        for w in batch
    ]


def _shortlist(windows: list[ScoredWindow], size: int, max_overlap: float) -> list[ScoredWindow]:
    """The `size` best-scoring Windows (ties to the earlier), in Transcript order. A Window that
    overlaps one already picked by more than `max_overlap` of the shorter one's length is skipped."""
    picked: list[ScoredWindow] = []
    for window in sorted(windows, key=lambda w: -1 if w.score is None else w.score, reverse=True):
        if len(picked) == size:
            break
        if all(
            min(window.end, other.end) - max(window.start, other.start)
            <= max_overlap * min(window.end - window.start, other.end - other.start)
            for other in picked
        ):
            picked.append(window)
    return sorted(picked, key=lambda w: w.start)


def _retrying[R](
    call: Callable[[LlmRequest], R], request: LlmRequest, tuning: SelectionTuning, progress: Progress
) -> R:
    """`call(request)`, retrying transient errors with exponential backoff."""
    attempt, delay = 1, tuning.llm_retry_secs
    while True:
        try:
            return call(request)
        except TransientLlmError as exc:
            if attempt == tuning.llm_attempts:
                raise TransientLlmError(f"Gave up after {attempt} attempts: {exc}") from exc
            logger.warning("Retrying in %g s: %s", delay, exc)
            progress(f"Retrying in {delay:g} s: {exc}")
            time.sleep(delay)
            attempt, delay = attempt + 1, 2 * delay


@dataclass(frozen=True)
class _Clip:
    proposal: ClipProposal
    # Indexes of its first and last Words.
    first: int
    last: int


def _candidates(
    proposals: list[ClipProposal],
    cutter: "_Cutter",
    windows: list[ScoredWindow],
    count: int,
    min_secs: float,
    max_secs: float,
) -> list[Candidate]:
    """The proposals, made into Candidates in these steps:

    1. Snap: each proposal becomes a run of whole Words (see `_Cutter.first_word`/`last_word`).
       One with no Words between its edges is dropped.
    2. Overlaps: best first (predicted score, then hook strength, then the earlier), a proposal
       that shares a Word with a better one is dropped. Sharing only silence is fine.
    3. Duration range: see `_Cutter.fit`. Best first again, so the better clip has first claim on
       the room between neighbours; a fitted clip never grows into a neighbour.
    4. Target count: only the best `count` are kept.
    5. Rank: by predicted score, as in step 2. Each Candidate gets a new random id.
    """
    clips = []
    for proposal in proposals:
        first = cutter.first_word(parse_time(proposal.start))
        last = cutter.last_word(parse_time(proposal.end))
        if first is None or last is None or last < first:
            logger.info("Dropped the clip at %s–%s: no Words between its edges", proposal.start, proposal.end)
            continue
        clips.append(_Clip(proposal, first, last))
    clips.sort(key=lambda c: (-c.proposal.predicted_score, -c.proposal.hook_strength, c.first))

    apart: list[_Clip] = []
    for clip in clips:
        if any(clip.first <= other.last and other.first <= clip.last for other in apart):
            logger.info("Dropped the clip at %s–%s: it overlaps a better one", clip.proposal.start, clip.proposal.end)
        else:
            apart.append(clip)

    fitted: list[tuple[_Clip, float, float]] = []
    for i, clip in enumerate(apart):
        neighbours = [other for other, _, _ in fitted] + apart[i + 1 :]
        lo = max((other.last for other in neighbours if other.last < clip.first), default=-1)
        hi = min((other.first for other in neighbours if other.first > clip.last), default=len(cutter.words))
        if fit := cutter.fit(clip.first, clip.last, lo, hi, min_secs, max_secs):
            first, last, start, end = fit
            fitted.append((_Clip(clip.proposal, first, last), start, end))
        else:
            logger.info(
                "Dropped the clip at %s–%s: too far outside %g–%g s",
                clip.proposal.start, clip.proposal.end, min_secs, max_secs,
            )

    scores = {w.id: w.score for w in windows}
    return [
        _candidate(clip.proposal, start, end, scores.get(clip.proposal.window_id))
        for clip, start, end in fitted[:count]
    ]


def _candidate(proposal: ClipProposal, start: float, end: float, window_score: int | None) -> Candidate:
    hashtags = ("#" + tag.strip().lstrip("#").replace(" ", "") for tag in proposal.hashtags if tag.strip("# "))
    return Candidate(
        id=uuid4().hex[:8],
        start=round(start, 3),
        end=round(end, 3),
        predicted_score=proposal.predicted_score,
        hook_strength=proposal.hook_strength,
        emotion=proposal.emotion.strip(),
        reason=proposal.reason.strip(),
        retention_notes=proposal.retention_notes.strip(),
        hook_text=" ".join(proposal.viral_hook_text.split()),
        title=proposal.title.strip(),
        descriptions=Descriptions(
            tiktok=proposal.tiktok_description.strip(),
            instagram=proposal.instagram_description.strip(),
            shorts=proposal.shorts_description.strip(),
        ),
        hashtags=list(dict.fromkeys(hashtags)),
        window_id=proposal.window_id,
        window_score=window_score,
    )


class _Cutter:
    """Cuts on Word boundaries: which Words a proposed time means, and where a run of Words begins and ends."""

    def __init__(self, transcript: Transcript, duration: float, tuning: SelectionTuning) -> None:
        self.words = transcript.words
        self.duration = duration
        self.tuning = tuning
        self.starts = [w.start for w in self.words]
        self.ends = [w.end for w in self.words]
        # The first Word of the first line shown with each label in the Detail prompt.
        self.lines: dict[str, int] = {}
        for segment in transcript.segments:
            self.lines.setdefault(timestamp(segment.start), bisect_right(self.ends, segment.start))

    def first_word(self, start: float) -> int | None:
        """The Word a proposed start means: the first Word of the line with that label (the Detail
        prompt asks for one), else the Word starting nearest it within the search range, else the
        first Word starting after it."""
        if (line := self._line(start)) is not None:
            return line if line < len(self.words) else None
        if (nearest := self._nearest(self.starts, start)) is not None:
            return nearest
        after = bisect_left(self.starts, start)
        return after if after < len(self.words) else None

    def last_word(self, end: float) -> int | None:
        """The Word a proposed end means: the Word before the line with that label (the Detail
        prompt asks for the label of the first line after the clip), else the Word ending nearest
        it within the search range, else the last Word ending before it."""
        if (line := self._line(end)) is not None:
            return line - 1 if line > 0 else None
        if (nearest := self._nearest(self.ends, end)) is not None:
            return nearest
        before = bisect_right(self.ends, end) - 1
        return before if before >= 0 else None

    def edges(self, first: int, last: int) -> tuple[float, float]:
        """Where the run of Words `first`..`last` is cut: a lead-in before the first Word and a tail
        after the last, each cut short where it would reach into the Word before or after, and
        kept within the Source."""
        words = self.words
        before = words[first - 1].end if first > 0 else 0.0
        after = words[last + 1].start if last + 1 < len(words) else self.duration
        start = max(0.0, min(words[first].start, max(words[first].start - self.tuning.lead_in_secs, before)))
        end = min(self.duration, max(words[last].end, min(words[last].end + self.tuning.tail_secs, after)))
        return start, end

    def fit(
        self, first: int, last: int, lo: int, hi: int, min_secs: float, max_secs: float
    ) -> tuple[int, int, float, float] | None:
        """Fit the run of Words `first`..`last` to `min_secs`..`max_secs`, using only the Words
        between `lo` and `hi` (exclusive), and return its Words and edges.

        Too long: Words come off the end, which keeps the hook at the start; the tail is shortened
        if that alone fits it. Too short: Words are added after the end, then before the start.
        None when that can't reach the range, or would move the edges by more than
        `duration_fix_secs` in all: the clip is then no longer the moment that was proposed.
        """
        start, end = self.edges(first, last)
        new_first, new_last = first, last
        if end - start > max_secs:
            while new_last > new_first and self.words[new_last].end - start > max_secs:
                new_last -= 1
        elif end - start < min_secs:
            while new_last + 1 < hi and self._length(new_first, new_last) < min_secs:
                new_last += 1
            while new_first - 1 > lo and self._length(new_first, new_last) < min_secs:
                new_first -= 1
        new_start, new_end = self.edges(new_first, new_last)
        new_end = min(new_end, new_start + max_secs)
        moved = abs(new_start - start) + abs(new_end - end)
        if new_end < self.words[new_last].end or new_end - new_start < min_secs or moved > self.tuning.duration_fix_secs:
            return None
        return new_first, new_last, new_start, new_end

    def _length(self, first: int, last: int) -> float:
        start, end = self.edges(first, last)
        return end - start

    def _line(self, time: float) -> int | None:
        return self.lines.get(timestamp(time)) if time == int(time) else None

    def _nearest(self, times: list[float], time: float) -> int | None:
        lo = bisect_left(times, time - self.tuning.snap_search_secs)
        hi = bisect_right(times, time + self.tuning.snap_search_secs)
        return min(range(lo, hi), key=lambda i: abs(times[i] - time)) if lo < hi else None
