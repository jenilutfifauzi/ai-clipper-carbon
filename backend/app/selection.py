"""Selection: a Transcript in, ranked Candidates out, steered by the Channel Profile and the Brief.

1. The Transcript is cut into overlapping Windows, and the Score pass scores each of them, with
   the Brief and the profile in short.
2. The best-scoring Windows form the shortlist.
3. The Detail pass reads the whole Transcript, the profile, the Brief and the few-shot examples,
   and proposes clips from the shortlisted Windows. In audio-signal mode it also hears the
   shortlisted Windows' audio (see `_audio`).
4. Post-processing turns the proposals into Candidates (see `_candidates`).

Every number used here is in SelectionTuning; the prompts are in app/prompts.py.
"""

import base64
import json
import logging
import math
import re
import time
from bisect import bisect_left, bisect_right
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from uuid import uuid4

from app.candidates import HOOK_MAX_CHARS, KICKER_MAX_CHARS, Candidate, Descriptions
from app.config import LlmChoice, SelectionTuning
from app.fewshot import Example
from app.llm import (
    AudioPart,
    ClipProposal,
    Llm,
    LlmRequest,
    Overloaded,
    ScoreResponse,
    TransientLlmError,
    parse_time,
)
from app.planner import without_emoji
from app.profile import ChannelProfile
from app.prompts import audio_label, detail_prompt, prompt_version, score_prompt
from app.transcript import Transcript, Word, timestamp

logger = logging.getLogger(__name__)

# Called with a status line, and the percent done when it has moved.
Progress = Callable[..., None]
# The audio of the Source from a start to an end in seconds, and its MIME type.
WindowAudio = Callable[[float, float], tuple[bytes, str]]

# What a Detail request holds besides its prompt and audio, in bytes: the generation config with
# the response schema (about 3 kB), each part's JSON, and room to spare.
_REQUEST_OVERHEAD = 64 * 1024
_PART_OVERHEAD = 128


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
    # The few-shot examples the Detail pass was shown.
    examples: list[Example]
    windows: list[ScoredWindow]
    shortlist: list[str]
    proposals: list[ClipProposal]
    candidates: list[Candidate]
    # The LLM it ran on; None in runs saved before that was recorded.
    llm: LlmChoice | None = None
    # Whether audio-signal mode was on, and the shortlisted Windows whose audio the Detail pass
    # heard: all of them unless the request's size cap left some out.
    audio_signal: bool = False
    audio_windows: list[str] = field(default_factory=list)


def select(
    llm: Llm,
    tuning: SelectionTuning,
    transcript: Transcript,
    duration: float,
    min_secs: float,
    max_secs: float,
    profile: ChannelProfile = ChannelProfile(),
    brief: str | None = None,
    examples: Sequence[Example] = (),
    progress: Progress = lambda message, percent=None: None,
    window_audio: WindowAudio | None = None,
) -> Selection:
    """Ranked Candidates of `min_secs` to `max_secs` from the Transcript of a `duration`-second Source.

    With `window_audio` (audio-signal mode), the Detail pass also gets the shortlisted Windows' audio.
    """
    length = max(tuning.window_min_secs, tuning.window_factor * max_secs)
    windows = _windows(transcript.words, length, tuning.window_overlap_secs)
    batches = _batches(windows, tuning.score_batch_size)
    steps = len(batches) + 1
    scored: list[ScoredWindow] = []
    for i, batch in enumerate(batches):
        progress(f"Scoring {len(windows)} Windows (request {i + 1} of {len(batches)})", 100 * i / steps)
        prompt = score_prompt(
            batch, transcript.language, duration, min_secs, max_secs, profile, brief, tuning.profile_summary_chars
        )
        response = _retrying(llm.score, LlmRequest(prompt, tuning.score_temperature), tuning, progress)
        scored += _scores(batch, response)

    count = _target_count(duration, tuning)
    shortlist = _shortlist(scored, round(tuning.shortlist_factor * count), tuning.shortlist_max_overlap)
    cutter = _Cutter(transcript, duration, tuning)
    proposals: list[ClipProposal] = []
    audio: list[AudioPart] = []
    if shortlist:
        lines = [
            (cutter.starts[first], " ".join(w.text for w in cutter.words[first : last + 1]))
            for first, last in cutter.line_words
        ]

        def prompt(with_audio: bool) -> str:
            return detail_prompt(
                lines, transcript.language, shortlist, count, tuning.spare_clips, duration, min_secs, max_secs,
                profile, brief, examples, with_audio,
            )

        if window_audio is not None:
            progress(f"Extracting the audio of {len(shortlist)} shortlisted Windows", 100 * len(batches) / steps)
            audio = _audio(shortlist, window_audio, prompt(True), tuning)
        progress(f"Choosing {count} Candidates from {len(shortlist)} shortlisted Windows", 100 * len(batches) / steps)
        request = LlmRequest(prompt(bool(audio)), tuning.detail_temperature, tuple(audio))
        proposals = _retrying(llm.detail, request, tuning, progress).clips

    candidates = _candidates(proposals, cutter, scored, count, min_secs, max_secs)
    return Selection(
        prompt_version(bool(audio)), count, list(examples), scored, [w.id for w in shortlist], proposals, candidates,
        audio_signal=window_audio is not None, audio_windows=[part.window_id for part in audio],
    )


def snap(
    transcript: Transcript, duration: float, tuning: SelectionTuning, start: float, end: float
) -> tuple[float, float] | None:
    """The owner's range `start`..`end` (a review edit, or a manual Candidate) cut on Word boundaries
    the way Selection cuts its Candidates: the Words it covers, with the lead-in and tail (see
    `_Cutter.edges`). None when it covers no Word.

    It covers each Word that ends after `start` and starts before `end`: a range from one Word's
    start to another's end means those Words, and a Candidate's own edges mean its own Words again,
    so an edge sent back unchanged stays where it was. A proposal's times are read differently (see
    `_Cutter.first_word`), and are then moved to whole sentences and fitted to the duration range;
    the owner's Words are their own choice, so neither is done here.
    """
    cutter = _Cutter(transcript, duration, tuning)
    first = bisect_right(cutter.ends, start)
    last = bisect_left(cutter.starts, end) - 1
    if first > last:
        return None
    start, end = cutter.edges(first, last)
    return round(start, 3), round(end, 3)


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


def _audio(
    shortlist: list[ScoredWindow], window_audio: WindowAudio, prompt: str, tuning: SelectionTuning
) -> list[AudioPart]:
    """The shortlisted Windows' recordings, in Transcript order, for a Detail request with `prompt`.
    They are taken best-scored first (ties to the earlier) while the request stays within
    audio_request_max_bytes, counting the audio as base64, as it is sent inline; the rest, the
    lowest-scored, are left out. They are made audio_workers at a time."""
    with ThreadPoolExecutor(tuning.audio_workers) as pool:
        recordings = dict(zip((w.id for w in shortlist), pool.map(lambda w: window_audio(w.start, w.end), shortlist)))
    room = tuning.audio_request_max_bytes - len(json.dumps(prompt)) - _REQUEST_OVERHEAD
    kept: dict[str, AudioPart] = {}
    for window in sorted(shortlist, key=lambda w: -1 if w.score is None else w.score, reverse=True):
        data, mime_type = recordings[window.id]
        part = AudioPart(window.id, audio_label(window), data, mime_type)
        size = len(base64.b64encode(data)) + len(json.dumps(part.label)) + len(mime_type) + 2 * _PART_OVERHEAD
        if size > room:
            break
        room -= size
        kept[window.id] = part
    if left_out := [w.id for w in shortlist if w.id not in kept]:
        logger.warning("Left out the audio of Windows %s: the Detail request would be too large", ", ".join(left_out))
    return [kept[w.id] for w in shortlist if w.id in kept]


def _retrying[R](
    call: Callable[[LlmRequest], R], request: LlmRequest, tuning: SelectionTuning, progress: Progress
) -> R:
    """`call(request)`, retrying transient errors with exponential backoff. An overload that outlasts
    the retries is raised as it came, for the Job to wait out (see Pipeline._wait_for_gemini)."""
    attempt, delay = 1, tuning.llm_retry_secs
    while True:
        try:
            return call(request)
        except TransientLlmError as exc:
            if attempt == tuning.llm_attempts:
                if isinstance(exc, Overloaded):
                    raise
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

    1. Snap: each proposal becomes a run of whole Words. Its edges are the Words its times mean
       (see `_Cutter.first_word`/`last_word`), unless its quoted opening and closing words are
       found near those (see `_Cutter.opening`/`closing`). Then they are moved to
       whole sentences (see `_Cutter.sentences`). One with no Words between its edges is dropped,
       and so is one that can't be fitted to the duration range even with no neighbours (see
       step 4), before it can push out others in steps 2 and 3.
    2. Overlaps: best first (predicted score, then hook strength, then the earlier), a proposal
       that shares a Word with a better one is dropped. Sharing only silence is fine.
    3. Diversity: best first again, a proposal less than `adjacent_secs` from a better one (one
       passage cut in two), or whose topic is close to a better one's, is dropped. The Detail pass
       is asked for spare clips beyond the target count to fill the gaps that steps 2–4 leave.
    4. Duration range: see `_Cutter.fit`. Best first again, so the better clip has first claim on
       the room between neighbours; a fitted clip never grows into a neighbour.
    5. Target count: only the best `count` are kept.
    6. Rank: by predicted score, as in step 2. Each Candidate gets a new random id.
    """
    clips = []
    for proposal in proposals:
        # The quotes are looked for near the Words the times mean: an end label can sit after a
        # long silence.
        start, end = parse_time(proposal.start), parse_time(proposal.end)
        first, last = cutter.first_word(start), cutter.last_word(end)
        opening = cutter.opening(proposal.opening_words, start if first is None else cutter.starts[first])
        closing = cutter.closing(proposal.closing_words, end if last is None else cutter.ends[last])
        quoted_start, quoted_end = opening is not None, closing is not None
        first = opening if quoted_start else first
        last = closing if quoted_end else last
        if first is None or last is None or last < first:
            logger.info("Dropped the clip at %s–%s: no Words between its edges", proposal.start, proposal.end)
            continue
        first, last = cutter.sentences(first, last, quoted_start, quoted_end)
        if cutter.fit(first, last, -1, len(cutter.words), min_secs, max_secs) is None:
            logger.info(
                "Dropped the clip at %s–%s: too far outside %g–%g s",
                proposal.start, proposal.end, min_secs, max_secs,
            )
            continue
        clips.append(_Clip(proposal, first, last))
    clips.sort(key=lambda c: (-c.proposal.predicted_score, -c.proposal.hook_strength, c.first))

    apart: list[_Clip] = []
    for clip in clips:
        if any(clip.first <= other.last and other.first <= clip.last for other in apart):
            logger.info("Dropped the clip at %s–%s: it overlaps a better one", clip.proposal.start, clip.proposal.end)
        else:
            apart.append(clip)

    distinct: list[_Clip] = []
    tuning = cutter.tuning
    for clip in apart:
        where = (clip.proposal.start, clip.proposal.end)
        if any(cutter.gap(clip, other) < tuning.adjacent_secs for other in distinct):
            logger.info("Dropped the clip at %s–%s: it runs on from a better one", *where)
        elif any(_same_topic(clip.proposal.topic, other.proposal.topic, tuning.topic_overlap) for other in distinct):
            logger.info("Dropped the clip at %s–%s: a better one has its topic", *where)
        else:
            distinct.append(clip)
    apart = distinct

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


_TOKEN = re.compile(r"\w+")
_SENTENCE_END = (".", "?", "!", "…")
_QUOTES = "\"'”’»)"


def _tokens(text: str) -> list[str]:
    """Lowercase words without punctuation, for comparing quotes with Words: "main -main," and
    "main-main" both give ["main", "main"]."""
    return _TOKEN.findall(text.lower())


def _same_topic(topic: str, other: str, overlap: float) -> bool:
    """Whether two topics share at least `overlap` of their words (Jaccard) of 4 letters or more."""
    words, others = ({t for t in _tokens(text) if len(t) >= 4} for text in (topic, other))
    return bool(words and others) and len(words & others) / len(words | others) >= overlap


def _cut(text: str, limit: int) -> str:
    """`text` cut to its whole words that fit in `limit` characters (or to `limit` characters, if
    even its first word is longer). An Emphasis cut in two loses its opening asterisk, so that no
    unpaired one is shown."""
    kept = ""
    for word in text.split():
        longer = f"{kept} {word}" if kept else word
        if len(longer) > limit:
            kept = kept or word[:limit]
            break
        kept = longer
    if kept.count("*") % 2:
        at = kept.rindex("*")
        kept = " ".join((kept[:at] + kept[at + 1 :]).split())
    return kept


def _words(text: str) -> set[str]:
    """The words of `text`, in lower case, without punctuation or Emphasis marks."""
    return set(re.findall(r"\w+", text.lower()))


# Moods and cheers the AI offers as a Kicker though they say nothing of the clip.
MOOD_KICKERS = frozenset({"semangat", "motivasi", "keren", "inspirasi", "wow", "viral", "mantap"})


def _kicker(text: str, hook: str) -> str:
    """The AI's Kicker as kept: cut to KICKER_MAX_CHARS, and "" when every word of it is in the
    `hook` (it would only say the hook twice) or it is only a mood (MOOD_KICKERS)."""
    kicker = _cut(without_emoji(text), KICKER_MAX_CHARS)
    words = _words(kicker)
    return "" if words <= _words(hook) or words <= MOOD_KICKERS else kicker


def _hook(text: str) -> str:
    """The AI's hook as kept: without emoji, cut to HOOK_MAX_CHARS, and without its Emphasis when
    that covers every word (it then stands out from nothing)."""
    hook = _cut(without_emoji(text), HOOK_MAX_CHARS)
    # Runs pair asterisks from the left, as the planner does.
    outside = re.sub(r"\*[^*]*\*", "", hook)
    return hook if re.search(r"\w", outside) else " ".join(hook.replace("*", "").split())


def _candidate(proposal: ClipProposal, start: float, end: float, window_score: int | None) -> Candidate:
    hook = _hook(proposal.viral_hook_text)
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
        hook_text=hook,
        hook_kicker=_kicker(proposal.hook_kicker, hook),
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
        self.tokens = [_tokens(w.text) for w in self.words]
        segment_starts = {bisect_right(self.ends, segment.start) for segment in transcript.segments}
        self.line_words = self._lines(segment_starts)
        # The first Word of the first line shown with each label in the Detail prompt.
        self.lines: dict[str, int] = {}
        for first, _ in self.line_words:
            self.lines.setdefault(timestamp(self.starts[first]), first)

    def _lines(self, segment_starts: set[int]) -> list[tuple[int, int]]:
        """The Detail prompt's lines, as (first, last) Word indexes: one per sentence (see
        `starts_sentence`), since a Segment of Whisper's or a caption line often starts in
        mid-sentence and the model tends to open a clip where a line does. A sentence still going
        after line_max_secs, and a transcript with no sentence ends (captions without punctuation),
        break at the next Segment's start."""
        lines = []
        first = 0
        for i in range(1, len(self.words)):
            if self.starts_sentence(i) or (
                i in segment_starts and self.starts[i] - self.starts[first] >= self.tuning.line_max_secs
            ):
                lines.append((first, i - 1))
                first = i
        if self.words:
            lines.append((first, len(self.words) - 1))
        return lines

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

    def opening(self, quote: str, near: float) -> int | None:
        """The first Word of the quote's best match among the Words starting within
        quote_search_secs of `near`: the best-matching, then the nearest. None when nothing matches
        well enough."""
        quoted = _tokens(quote)[: self.tuning.quote_max_words]
        if not quoted:
            return None
        lo = bisect_left(self.starts, near - self.tuning.quote_search_secs)
        hi = bisect_right(self.starts, near + self.tuning.quote_search_secs)
        matches = [
            (self._match(quoted, self._tokens_from(i, len(quoted))), -abs(self.starts[i] - near), i)
            for i in range(lo, hi)
        ]
        return self._best(matches)

    def closing(self, quote: str, near: float) -> int | None:
        """The last Word of the quote's best match among the Words ending within quote_search_secs
        of `near`, as `opening`."""
        quoted = _tokens(quote)[-self.tuning.quote_max_words :]
        if not quoted:
            return None
        lo = bisect_left(self.ends, near - self.tuning.quote_search_secs)
        hi = bisect_right(self.ends, near + self.tuning.quote_search_secs)
        matches = [
            (self._match(quoted, self._tokens_until(i, len(quoted))), -abs(self.ends[i] - near), i)
            for i in range(lo, hi)
        ]
        return self._best(matches)

    def sentences(self, first: int, last: int, quoted_start: bool, quoted_end: bool) -> tuple[int, int]:
        """The run `first`..`last` moved to whole sentences: a start in mid-sentence moves to the next
        sentence if that starts within fragment_secs (what came before was the previous sentence's
        tail), and an end in mid-sentence moves to its sentence's end if that is within
        complete_secs. An edge placed by a quote is the model's choice of Word, and only
        punctuation can show it is in mid-sentence: a pause there may be a breath, and in captions
        without punctuation a pause is often all there is. Where no sentence edge is near, the
        edges stay."""
        start = first
        while not self.starts_sentence(start, pauses=not quoted_start) and start < last:
            start += 1
            if self.starts[start] - self.starts[first] > self.tuning.fragment_secs:
                start = first
                break
        if start == last and not self.starts_sentence(start, pauses=not quoted_start):
            start = first
        end = last
        while not self.ends_sentence(end, pauses=not quoted_end):
            end += 1
            if self.ends[end] - self.ends[last] > self.tuning.complete_secs:
                end = last
                break
        return start, end

    def starts_sentence(self, i: int, pauses: bool = True) -> bool:
        """Whether Word `i` starts a sentence: it is the first, the Word before ends in . ? ! or …,
        or (with `pauses`) a silence of sentence_pause_secs comes before it."""
        if i == 0:
            return True
        return self.words[i - 1].text.rstrip(_QUOTES).endswith(_SENTENCE_END) or (
            pauses and self.starts[i] - self.ends[i - 1] >= self.tuning.sentence_pause_secs
        )

    def ends_sentence(self, i: int, pauses: bool = True) -> bool:
        return i == len(self.words) - 1 or self.starts_sentence(i + 1, pauses)

    def gap(self, clip: _Clip, other: _Clip) -> float:
        """The time between two clips that don't overlap."""
        if clip.first > other.last:
            return self.starts[clip.first] - self.ends[other.last]
        return self.starts[other.first] - self.ends[clip.last]

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

        Too long: Words come off the end, which keeps the hook at the start, back to the last
        sentence end that leaves it at least `min_secs` long, if there is one; the tail is shortened
        if that alone fits it. Too short: Words are added after the end, then before the start.
        None when that can't reach the range, or would move the edges by more than
        `duration_fix_secs` in all: the clip is then no longer the moment that was proposed.
        """
        start, end = self.edges(first, last)
        new_first, new_last = first, last
        if end - start > max_secs:
            while new_last > new_first and self.words[new_last].end - start > max_secs:
                new_last -= 1
            sentence = new_last
            while sentence > new_first and not self.ends_sentence(sentence):
                sentence -= 1
            if self.ends_sentence(sentence) and self._length(new_first, sentence) >= min_secs:
                new_last = sentence
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

    def _tokens_from(self, first: int, count: int) -> list[str]:
        """The first `count` tokens of the Words from `first` on."""
        tokens: list[str] = []
        for i in range(first, len(self.words)):
            if len(tokens) >= count:
                break
            tokens += self.tokens[i]
        return tokens[:count]

    def _tokens_until(self, last: int, count: int) -> list[str]:
        """The last `count` tokens of the Words up to `last`."""
        tokens: list[str] = []
        for i in range(last, -1, -1):
            if len(tokens) >= count:
                break
            tokens = self.tokens[i] + tokens
        return tokens[-count:]

    def _match(self, quoted: list[str], tokens: list[str]) -> float:
        return SequenceMatcher(None, quoted, tokens, autojunk=False).ratio()

    def _best(self, matches: list[tuple[float, float, int]]) -> int | None:
        best = max(matches, default=None)
        return best[2] if best and best[0] >= self.tuning.quote_min_match else None

    def _length(self, first: int, last: int) -> float:
        start, end = self.edges(first, last)
        return end - start

    def _line(self, time: float) -> int | None:
        return self.lines.get(timestamp(time)) if time == int(time) else None

    def _nearest(self, times: list[float], time: float) -> int | None:
        lo = bisect_left(times, time - self.tuning.snap_search_secs)
        hi = bisect_right(times, time + self.tuning.snap_search_secs)
        return min(range(lo, hi), key=lambda i: abs(times[i] - time)) if lo < hi else None
