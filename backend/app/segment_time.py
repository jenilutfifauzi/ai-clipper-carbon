"""One mapping between Timeline time and Source time per Segment
(docs/adr/0009-speed-keeps-the-range-and-reverse-is-a-derived-copy.md): a Segment's length on the
Timeline, and which time of the Source (or of its video) shows a time into it on the Timeline, and
back. Pure, and the one rule the planner, the renderer, the preview's Words and the checks read a
Segment by; the frontend has a copy of it (frontend/src/pages/job/editor/segmentTime.ts), and both
are tested on the cases in tests/fixtures/segment_times.json, so that they can't drift (ADR 0001).

A Segment plays its range at its Speed, forwards or in Reverse, or holds the frame at its start for
its hold (a Freeze frame):
- forwards: `source = start + offset × speed`;
- in Reverse: `source = end − offset × speed`;
- held: `source = start`;
`offset` being seconds into it on the Timeline. An Overlay of a video plays the part of the video
it shows as a Segment plays its range (`overlay_time`).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class SegmentTime:
    """How a Segment plays: its range from `start` to `end` on the Source's timeline (or seconds into
    its video), at `speed`, forwards or in `reverse`; or, with `hold`, the frame at `start` held for
    that many seconds."""

    start: float
    end: float
    speed: float = 1.0
    reverse: bool = False
    hold: float | None = None

    @property
    def length(self) -> float:
        """How long it plays on the Timeline: its hold, or its range's length divided by its Speed."""
        if self.hold is not None:
            return self.hold
        return round((self.end - self.start) / self.speed, 6)

    @property
    def span(self) -> float:
        """How long its range is, on the Source (or in its video): what is read of it."""
        return self.end - self.start

    def source_at(self, offset: float) -> float:
        """The Source time it shows `offset` seconds into it on the Timeline."""
        if self.hold is not None:
            return self.start
        if self.reverse:
            return self.end - offset * self.speed
        return self.start + offset * self.speed

    def offset_at(self, source: float) -> float:
        """How many seconds into it on the Timeline it shows `source`, a time in its range (its
        start, for a held one)."""
        if self.hold is not None:
            return 0.0
        if self.reverse:
            return (self.end - source) / self.speed
        return (source - self.start) / self.speed

    def offset_of(self, into: float) -> float:
        """`offset_at` for the time `into` seconds into its range, as a Word, a Word Edit or a Layout
        Override reaches the planner."""
        if self.hold is not None:
            return 0.0
        if self.reverse:
            return (self.end - self.start - into) / self.speed
        return into / self.speed

    def part(self, begin: float, end: float) -> "SegmentTime":
        """How its part from `begin` to `end` seconds into it on the Timeline plays (a Scene of it):
        the range shown then, at its Speed and in its direction, or its frame held that long."""
        if self.hold is not None:
            return SegmentTime(self.start, self.start, hold=end - begin)
        first, last = sorted((self.source_at(begin), self.source_at(end)))
        return SegmentTime(first, last, self.speed, self.reverse)


class _Ranged(Protocol):
    @property
    def start(self) -> float: ...

    @property
    def end(self) -> float: ...

    @property
    def speed(self) -> float: ...

    @property
    def reverse(self) -> bool: ...

    @property
    def hold(self) -> float | None: ...


def segment_time(segment: _Ranged) -> SegmentTime:
    """How a Candidate's Segment plays. One saved before Speed, Reverse and Freeze frames, or without
    them, plays forwards at 1×."""
    return SegmentTime(segment.start, segment.end, segment.speed, segment.reverse, segment.hold)


def overlay_time(
    offset: float, secs: float, speed: float = 1.0, reverse: bool = False, video: float = math.inf, shown: float = math.inf
) -> SegmentTime:
    """How an Overlay `secs` long on the Timeline plays its video (docs/adr/0009), as a Segment plays
    its range: `secs × speed` of it from `offset`, backwards when `reverse`. Cut where the video ends,
    `video` seconds into it, and after the `shown` seconds of it before the Clip ends, as the planner
    cuts it: the part it shows first is kept, which in Reverse is its range's end, so that its range
    then starts later. Its sound plays alike, and a Music Clip's song at 1×."""
    whole = min(offset + secs * speed, video)
    if shown >= secs:
        return SegmentTime(offset, whole, speed, reverse)
    read = max(0.0, shown) * speed
    if reverse:
        return SegmentTime(max(offset, whole - read), whole, speed, True)
    return SegmentTime(offset, min(whole, offset + read), speed)


def transition_overlap(secs: float, before: float, after: float) -> float:
    """How long a Transition of `secs` overlaps the Segments either side of its join, `before` and
    `after` seconds long on the Timeline: half the shorter of them at most."""
    return round(min(secs, before / 2, after / 2), 3)


def track_length(times: Sequence[SegmentTime], joins: Sequence[float | None]) -> float:
    """How long a Main Track of Segments playing as `times` lasts: their Timeline lengths, less the
    overlaps of their Transitions, `joins` giving the length of the one after each (None: none)."""
    lengths = [time.length for time in times]
    total = sum(lengths)
    for secs, before, after in zip(joins, lengths, lengths[1:]):
        if secs is not None:
            total -= transition_overlap(secs, before, after)
    return round(total, 3)
