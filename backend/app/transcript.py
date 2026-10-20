"""The normalized Transcript, and parsing of YouTube json3 caption tracks into it."""

import json
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import Field

TranscriptSource = Literal["youtube", "whisper"]
# A language as Whisper and YouTube name it: "id", "en", "pt-BR".
Language = Annotated[str, Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$")]


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


def timestamp(seconds: float) -> str:
    """A time as shown next to Transcript lines: m:ss, or h:mm:ss from the first hour on (rounded down)."""
    whole = int(seconds)
    hours, minutes, secs = whole // 3600, whole // 60 % 60, whole % 60
    return f"{hours}:{minutes:02}:{secs:02}" if hours else f"{minutes}:{secs:02}"


def parse_json3(data: str | bytes, language: str) -> Transcript:
    """Words from a json3 track, with one Segment per caption event that has words.

    A word starts at its event's start plus its offset, and ends at the next word's
    start, capped at its own event's end (or, without a duration, the next event's start).
    Whitespace-only segs (line breaks) are skipped.
    """
    lines: list[list[tuple[int, int, str]]] = []  # per event: (start ms, event end ms, text)
    events = json.loads(data).get("events", [])
    for i, event in enumerate(events):
        event_start = event["tStartMs"]
        if "dDurationMs" in event:
            event_end = event_start + event["dDurationMs"]
        else:  # Some tracks leave it out; the event then lasts until the next one starts.
            following = (e["tStartMs"] for e in events[i + 1 :] if "tStartMs" in e)
            event_end = next(following, event_start)
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
