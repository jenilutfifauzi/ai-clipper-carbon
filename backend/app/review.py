"""Review operations on a Job's Candidates: the owner's edits, manual Candidates, and keeping that
work when Selection runs again."""

from bisect import bisect_left
from dataclasses import dataclass, replace
from uuid import uuid4

from app.candidates import Candidate, Layout, LayoutOverride, Origin, WordEdit, manual_candidate
from app.config import SelectionTuning
from app.selection import snap
from app.styles import StyleOverrides
from app.transcript import Transcript

# The longest clip an edit or a manual Candidate may make, unless the Job's range allows longer:
# Shorts and Reels take at most 3 minutes. The Job's own range is not enforced on the owner's
# edits (the UI warns instead), since the owner may want a clip outside it.
MAX_CLIP_SECS = 180


class InvalidEdit(ValueError):
    pass


class CandidateNotFound(LookupError):
    pass


@dataclass(frozen=True)
class CandidateChange:
    """What an update changes; None leaves a field as it is. `start` and `end` are snapped to Words."""

    start: float | None = None
    end: float | None = None
    hook_text: str | None = None
    layout: Layout | None = None
    selected: bool | None = None
    preset_id: str | None = None
    style_overrides: StyleOverrides | None = None
    word_edits: list[WordEdit] | None = None
    hook_start: float | None = None
    hook_secs: float | None = None
    layout_overrides: list[LayoutOverride] | None = None


@dataclass(frozen=True)
class Episode:
    """What edits are checked against: the Job's Transcript, Source duration and longest clip."""

    transcript: Transcript
    duration: float
    max_secs: float
    tuning: SelectionTuning

    def bounds(self, start: float, end: float) -> tuple[float, float]:
        """`start`..`end` snapped to Words (see selection.snap); InvalidEdit when it isn't a usable clip."""
        if not 0 <= start < end <= self.duration:
            raise InvalidEdit(
                f"The range {start:g}–{end:g} s must lie within the Source (0–{self.duration:g} s), start before end"
            )
        snapped = snap(self.transcript, self.duration, self.tuning, start, end)
        if snapped is None:
            raise InvalidEdit(f"No Words between {start:g} s and {end:g} s")
        longest = max(MAX_CLIP_SECS, self.max_secs)
        if snapped[1] - snapped[0] > longest:
            raise InvalidEdit(f"A clip can last at most {longest:g} s; this one would last {snapped[1] - snapped[0]:.0f} s")
        return snapped


def update(
    candidates: list[Candidate], candidate_id: str, change: CandidateChange, episode: Episode
) -> tuple[list[Candidate], Candidate]:
    """The Candidates with one of them changed, and that one. Changing its bounds, hook text, layout or
    style marks it edited."""
    i = _index(candidates, candidate_id)
    old = candidates[i]
    start, end = old.start, old.end
    if change.start is not None or change.end is not None:
        start, end = episode.bounds(_pick(change.start, old.start), _pick(change.end, old.end))
    new = replace(
        old,
        start=start,
        end=end,
        hook_text=old.hook_text if change.hook_text is None else " ".join(change.hook_text.split()),
        layout=_pick(change.layout, old.layout),
        selected=_pick(change.selected, old.selected),
        preset_id=_pick(change.preset_id, old.preset_id),
        style_overrides=_pick(change.style_overrides, old.style_overrides),
        word_edits=old.word_edits if change.word_edits is None else _merged(change.word_edits),
        hook_start=_pick(change.hook_start, old.hook_start),
        hook_secs=_pick(change.hook_secs, old.hook_secs),
        layout_overrides=_pick(change.layout_overrides, old.layout_overrides),
    )
    edited = _look(new) != _look(old)
    new = replace(new, edited=old.edited or edited)
    return [*candidates[:i], new, *candidates[i + 1 :]], new


def add_manual(
    candidates: list[Candidate], start: float, end: float, episode: Episode
) -> tuple[list[Candidate], Candidate]:
    """The Candidates with a manual one for `start`..`end` (snapped to Words) added after the AI's,
    and the new one. It may overlap others: that is the owner's call."""
    start, end = episode.bounds(start, end)
    new = manual_candidate(uuid4().hex[:8], start, end)
    return ranked([*candidates, new]), new


def keep_reviewed(previous: list[Candidate], fresh: list[Candidate], transcript: Transcript) -> list[Candidate]:
    """The Candidates after Selection has run again on a Job: the previous ones that hold the owner's
    review work (manual, edited or selected) are kept as they are, and the rest are replaced by the
    new run's, leaving out any that shares a Word with a kept one."""
    kept = [candidate for candidate in previous if candidate.reviewed]
    starts = [word.start for word in transcript.words]
    fresh = [candidate for candidate in fresh if not any(_share_words(starts, candidate, other) for other in kept)]
    return ranked([*kept, *fresh])


def ranked(candidates: list[Candidate]) -> list[Candidate]:
    """The AI's Candidates by predicted score, then the manual ones in the order they were added."""
    return sorted(candidates, key=lambda c: (c.origin is Origin.MANUAL, -(c.predicted_score or 0)))


def _share_words(starts: list[float], a: Candidate, b: Candidate) -> bool:
    """Whether two Candidates hold a Word in common. Each runs from just before a Word's start to just
    after a Word's end, so they do when a Word starts where both are; sharing only the silence
    between one's tail and the other's lead-in doesn't count."""
    lo, hi = max(a.start, b.start), min(a.end, b.end)
    i = bisect_left(starts, lo)
    return i < len(starts) and starts[i] < hi


def _look(candidate: Candidate) -> tuple:
    """What the owner's edits change about a Candidate's Clip."""
    return (
        candidate.start, candidate.end, candidate.hook_text, candidate.layout, candidate.preset_id,
        candidate.style_overrides, candidate.word_edits, candidate.hook_start, candidate.hook_secs,
        candidate.layout_overrides,
    )


def _merged(edits: list[WordEdit]) -> list[WordEdit]:
    """The edits in time order, leaving out those that change nothing; of two at the same time, the later."""
    by_time = {round(edit.at, 3): edit for edit in edits}
    return [edit for _, edit in sorted(by_time.items()) if edit.text is not None or edit.break_before]


def _index(candidates: list[Candidate], candidate_id: str) -> int:
    for i, candidate in enumerate(candidates):
        if candidate.id == candidate_id:
            return i
    raise CandidateNotFound(candidate_id)


def _pick[T](new: T | None, old: T) -> T:
    return old if new is None else new
