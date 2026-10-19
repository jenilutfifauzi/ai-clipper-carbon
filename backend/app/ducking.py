"""Ducking (docs/adr/0016-ducking-from-words-and-detached-sound-is-a-music-clip.md): a Music Clip of
a song or of a video's sound turned down by its depth, in dB, while speech is heard. Pure, and the
one rule the planner's gain (`gain_at`) and the renderer's volume expression follow; the preview has
a copy of `duck_at` (frontend/src/pages/job/editor/loudness.ts), and both are tested on the cases in
tests/fixtures/gain_vectors.json, so that they can't drift (ADR 0001).

Speech is Words, where they are heard on the Timeline (the planner places them: app/planner.py).
Its spans are the Words, those less than the bridge apart joined. Over each span the Music is at its
depth's gain; it goes down to it in a straight line over the lead before the span, and comes back up
to 1 over the release after it (DuckTuning). Where two spans' ramps overlap, the lower wins.
"""

from collections.abc import Iterable, Sequence

from app.config import DuckTuning
from app.transcript import Word

# A span of speech, from and to seconds into the Clip.
Span = tuple[float, float]


def heard_words(words: Iterable[Word], start: float, end: float, speed: float = 1.0) -> list[Word]:
    """`words`, in seconds from where a sound's read starts (as a Segment's are from its start), as
    heard while it plays from `start` to `end` seconds into the Clip at `speed`, forwards: those whose
    middle is heard, kept within it."""
    placed = []
    for word in words:
        on, off = start + word.start / speed, start + word.end / speed
        if start <= (on + off) / 2 < end:
            placed.append(Word(word.text, round(max(on, start), 3), round(min(off, end), 3)))
    return placed


def speech_spans(words: Iterable[Word], tuning: DuckTuning) -> list[Span]:
    """The spans of speech of `words` (in seconds into the Clip), in order: those less than the bridge
    apart joined, and so are those whose ramps would meet, so that the renderer's straight lines
    between them (`duck_steps`) are the duck."""
    reach = max(tuning.bridge_secs, tuning.lead_secs + tuning.release_secs)
    spans: list[Span] = []
    for word in sorted(words, key=lambda word: word.start):
        if spans and word.start - spans[-1][1] < reach:
            spans[-1] = (spans[-1][0], max(spans[-1][1], word.end))
        else:
            spans.append((word.start, word.end))
    return spans


def touching(spans: Sequence[Span], start: float, end: float, tuning: DuckTuning) -> list[Span]:
    """The spans whose duck, ramps included, reaches into a sound heard from `start` to `end`."""
    return [(low, high) for low, high in spans if low - tuning.lead_secs < end and high + tuning.release_secs > start]


def duck_gain(depth: float) -> float:
    """The gain a depth in dB turns a sound down to."""
    return 10 ** (depth / 20)


def duck_at(spans: Sequence[Span], depth: float, time: float, tuning: DuckTuning) -> float:
    """How far a sound ducked `depth` dB under `spans` is turned down `time` seconds into the Clip: 1
    away from speech, its depth's gain over a span, in straight lines between over the lead before
    one and the release after it; the lowest of the spans'."""
    low = duck_gain(depth)
    share = 1.0
    for start, end in spans:
        if time < start:
            share = min(share, 1 + (low - 1) * max(0.0, (time - start + tuning.lead_secs) / tuning.lead_secs))
        elif time <= end:
            share = low
        else:
            share = min(share, low + (1 - low) * min(1.0, (time - end) / tuning.release_secs))
    return share


def duck_steps(spans: Sequence[Span], depth: float, tuning: DuckTuning, start: float = 0.0) -> list[tuple[float, float]]:
    """The points, as (time, gain) in seconds from `start` and in order, that straight lines between
    follow the duck of `spans` (joined: `speech_spans`), 1 before the first and after the last, as
    a keyed volume's `linear_steps` are; none without spans."""
    low = duck_gain(depth)
    points = []
    for begin, end in spans:
        points += [
            (begin - tuning.lead_secs - start, 1.0), (begin - start, low), (end - start, low), (end + tuning.release_secs - start, 1.0),
        ]
    return points
