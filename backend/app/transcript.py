"""The normalized Transcript, and parsing of YouTube json3 caption tracks into it."""

import json
from dataclasses import dataclass
from typing import Literal

TranscriptSource = Literal["youtube", "whisper"]


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Segment:
    """A line of the Transcript, for display."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Transcript:
    language: str
    source: TranscriptSource
    words: list[Word]
    segments: list[Segment]


def parse_json3(data: str | bytes, language: str) -> Transcript:
    """Words from a json3 track, with one Segment per caption event that has words.

    A word starts at its event's start plus its offset, and ends at the next word's
    start, capped at its own event's end. Whitespace-only segs (line breaks) are skipped.
    """
    lines: list[list[tuple[int, int, str]]] = []  # per event: (start ms, event end ms, text)
    for event in json.loads(data).get("events", []):
        event_start = event["tStartMs"]
        event_end = event_start + event["dDurationMs"]
        line = [
            (event_start + seg.get("tOffsetMs", 0), event_end, text)
            for seg in event.get("segs", [])
            if (text := seg.get("utf8", "").strip())
        ]
        if line:
            lines.append(line)

    timed = [word for line in lines for word in line]
    words = []
    for i, (start, cap, text) in enumerate(timed):
        next_start = timed[i + 1][0] if i + 1 < len(timed) else cap
        words.append(Word(text, start / 1000, max(start, min(next_start, cap)) / 1000))

    segments = []
    first = 0
    for line in lines:
        line_words = words[first : first + len(line)]
        first += len(line)
        segments.append(Segment(" ".join(w.text for w in line_words), line_words[0].start, line_words[-1].end))

    return Transcript(language=language, source="youtube", words=words, segments=segments)
