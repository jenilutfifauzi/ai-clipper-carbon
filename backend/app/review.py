"""Review operations on a Job's Candidates: the owner's edits, manual Candidates, and keeping that
work when Selection runs again."""

from bisect import bisect_left
from dataclasses import dataclass, replace
from uuid import uuid4

from app.candidates import (
    Candidate,
    Layout,
    LayoutOverride,
    MusicClip,
    Origin,
    Overlay,
    Segment,
    TextLayer,
    Transition,
    WordEdit,
    manual_candidate,
    timeline_length,
)
from app.config import SelectionTuning
from app.selection import snap
from app.styles import StyleOverrides
from app.transcript import Transcript

# The longest clip an edit or a manual Candidate may make, unless the Job's range allows longer:
# Shorts and Reels take at most 3 minutes. The Job's own range is not enforced on the owner's
# edits (the UI warns instead), since the owner may want a clip outside it.
MAX_CLIP_SECS = 180
# The shortest Segment of a Media Library video.
MIN_MEDIA_SECS = 0.1


class InvalidEdit(ValueError):
    pass


class CandidateNotFound(LookupError):
    pass


class StaleRevision(Exception):
    """An edit made from a Revision the Candidate has moved past; `candidate` is it as it is now."""

    def __init__(self, candidate: Candidate):
        super().__init__(f"Candidate {candidate.id} is at Revision {candidate.revision}")
        self.candidate = candidate


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
    hook_kicker: str | None = None
    text_layers: list[TextLayer] | None = None
    music: list[MusicClip] | None = None
    source_volume: float | None = None
    # Snapped to Words; one Segment is stored as `start` and `end`.
    segments: list[Segment] | None = None
    overlays: list[Overlay] | None = None
    # Each by the Segment it follows; one whose join isn't there is left out.
    transitions: list[Transition] | None = None
    # The Revision the change was made from: StaleRevision unless it is the Candidate's. None: saved
    # over whatever is there.
    revision: int | None = None


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

    def segments(self, segments: list[Segment]) -> list[Segment]:
        """The Segments with the ends of those that show the Source snapped to Words (as `bounds`
        snaps a Clip's); InvalidEdit for none, for none of the Source, or for one that isn't a usable
        Segment. A video's is placed by its Framing, and the episode's has none: its Layouts frame it.
        (A Media Library video's are checked against it by the API; their Timeline's length against
        the longest clip by `update`, once their Transitions are known.)"""
        if not any(segment.media is None for segment in segments):
            raise InvalidEdit("A clip needs at least one Segment of the episode")
        snapped = []
        for segment in segments:
            if (segment.media is None) is not (segment.framing is None):
                raise InvalidEdit(
                    "A video's Segment needs its framing (its transform, crop and background)"
                    if segment.framing is None
                    else "A Segment of the episode has no framing: its Layout frames it"
                )
            if segment.media is None:
                start, end = self.bounds(segment.start, segment.end)
                snapped.append(replace(segment, start=start, end=end))
            elif segment.end - segment.start < MIN_MEDIA_SECS:
                raise InvalidEdit(f"A video's Segment lasts {MIN_MEDIA_SECS:g} s at least")
            else:
                snapped.append(segment)
        return snapped

    def check_length(self, segments: list[Segment], transitions: list[Transition]) -> None:
        """InvalidEdit when the Main Track of `segments` plays longer than the longest clip."""
        longest = max(MAX_CLIP_SECS, self.max_secs)
        if (length := timeline_length(segments, transitions)) > longest:
            raise InvalidEdit(f"A clip can last at most {longest:g} s; its Segments would last {length:.0f} s")


def update(
    candidates: list[Candidate], candidate_id: str, change: CandidateChange, episode: Episode
) -> tuple[list[Candidate], Candidate]:
    """The Candidates with one of them changed, and that one. Changing its bounds, hook text, layout or
    style marks it edited."""
    i = _index(candidates, candidate_id)
    old = candidates[i]
    if change.revision is not None and change.revision != old.revision:
        raise StaleRevision(old)
    start, end, segments = old.start, old.end, old.segments
    transitions = _pick(change.transitions, old.transitions)
    if change.start is not None or change.end is not None:
        if old.segments and change.segments is None:
            raise InvalidEdit("This clip is cut into Segments: change them in the Advanced Edit")
        start, end = episode.bounds(_pick(change.start, old.start), _pick(change.end, old.end))
    if change.segments is not None:
        _check_ids("Segment", [segment.id for segment in change.segments])
        segments = episode.segments(change.segments)
        transitions = _joined(transitions, segments)
        episode.check_length(segments, transitions)
        # The hull of the Source they show; one Segment of it is a plain range.
        shown = [segment for segment in segments if segment.media is None]
        start, end = min(s.start for s in shown), max(s.end for s in shown)
        if len(segments) == 1:
            segments = []
    elif change.transitions is not None:
        episode.check_length(old.main_track(), _joined(transitions, old.segments))
    if change.text_layers is not None:
        _check_ids("Text Layer", [layer.id for layer in change.text_layers])
    if change.music is not None:
        _check_ids("Music Clip", [clip.id for clip in change.music])
    if change.overlays is not None:
        _check_ids("Overlay", [overlay.id for overlay in change.overlays])
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
        hook_kicker=old.hook_kicker if change.hook_kicker is None else " ".join(change.hook_kicker.split()),
        text_layers=_pick(change.text_layers, old.text_layers),
        music=_pick(change.music, old.music),
        source_volume=_pick(change.source_volume, old.source_volume),
        segments=segments,
        overlays=_pick(change.overlays, old.overlays),
        transitions=_joined(transitions, segments),
    )
    if change.text_layers is not None:
        _check_inside(new, old)
    edited = _look(new) != _look(old)
    new = replace(new, edited=old.edited or edited)
    if replace(new, selected=old.selected) != old:
        new = replace(new, revision=old.revision + 1)
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
        candidate.layout_overrides, candidate.hook_kicker, candidate.text_layers, candidate.music,
        candidate.source_volume, candidate.segments, candidate.overlays, candidate.transitions,
    )


def _merged(edits: list[WordEdit]) -> list[WordEdit]:
    """The edits in time order, leaving out those that change nothing; of two at the same time, the later."""
    by_time = {round(edit.at, 3): edit for edit in edits}
    return [edit for _, edit in sorted(by_time.items()) if edit.text is not None or edit.break_before]


def _joined(transitions: list[Transition], segments: list[Segment]) -> list[Transition]:
    """The Transitions that have a join to be at: after a Segment that isn't the last; of two at one
    join, the later. (A Segment deleted or moved to the end takes its Transition with it.)"""
    joins = {segment.id for segment in segments[:-1]}
    by_join = {transition.after: transition for transition in transitions if transition.after in joins}
    return [by_join[segment.id] for segment in segments[:-1] if segment.id in by_join]


def _check_inside(new: Candidate, old: Candidate) -> None:
    """InvalidEdit for a Text Layer, new or changed, that starts at or after the end of the Clip.
    (One left past it by a trim is kept: the planner doesn't show it.)"""
    before = {layer.id: layer for layer in old.text_layers}
    for layer in new.text_layers:
        if layer != before.get(layer.id) and layer.start >= new.duration:
            raise InvalidEdit(f"Text Layer {layer.id} starts after the clip ends ({new.duration:g} s)")


def _check_ids(kind: str, ids: list[str]) -> None:
    """InvalidEdit unless each of the items has its own id."""
    if len(set(ids)) != len(ids):
        raise InvalidEdit(f"Two of the {kind}s have the same id")


def _index(candidates: list[Candidate], candidate_id: str) -> int:
    for i, candidate in enumerate(candidates):
        if candidate.id == candidate_id:
            return i
    raise CandidateNotFound(candidate_id)


def _pick[T](new: T | None, old: T) -> T:
    return old if new is None else new
