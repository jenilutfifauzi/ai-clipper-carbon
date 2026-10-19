"""Caption files: a Render Plan's Cues as SRT or VTT subtitles (docs/adr/0020).

Each Cue is one subtitle cue, numbered in order, shown from its start to its end (to the
millisecond) with its `plain` lines: the Words as they are written, with the Word Edits, not in
the Caption Style's case nor with its stripping. A Cue moved at a Layout change is two plan entries
with one key, the second from where the first ends: one subtitle cue. Every render writes both
beside its MP4 (app/rendering.py), and the editor and the agent can ask for either of a Candidate.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.planner import Cue, CueKey


class CaptionFormat(StrEnum):
    SRT = "srt"
    VTT = "vtt"


# A Cue's entries touch when one ends within this of the next's start.
_TOUCHING_SECS = 0.001


@dataclass(frozen=True)
class _Subtitle:
    start: float
    end: float
    lines: list[str]
    key: CueKey


def caption_file(cues: list[Cue], format: CaptionFormat) -> str:
    """The text of the caption file in `format` of a plan's `cues`."""
    blocks = [
        f"{number}\n{_time(cue.start, format)} --> {_time(cue.end, format)}\n"
        + "".join(f"{_escaped(line, format)}\n" for line in cue.lines)
        for number, cue in enumerate(_subtitles(cues), 1)
    ]
    header = ["WEBVTT\n"] if format is CaptionFormat.VTT else []
    return "\n".join([*header, *blocks])


def _subtitles(cues: list[Cue]) -> list[_Subtitle]:
    """The subtitle cues of `cues`, in order: the entries of a Cue moved at a Layout change (one key,
    each from where the one before ends) as one. A Cue with no plain text left is none."""
    found: list[_Subtitle] = []
    for cue in sorted(cues, key=lambda cue: cue.start):
        lines = [line for line in (line.strip() for line in cue.plain) if line]
        if not lines:
            continue
        last = found[-1] if found else None
        if last is not None and last.key == cue.key and abs(cue.start - last.end) <= _TOUCHING_SECS:
            found[-1] = _Subtitle(last.start, cue.end, last.lines, last.key)
        else:
            found.append(_Subtitle(cue.start, cue.end, lines, cue.key))
    return found


def _time(secs: float, format: CaptionFormat) -> str:
    """`secs` as hh:mm:ss,mmm (SRT) or hh:mm:ss.mmm (VTT)."""
    ms = max(0, round(secs * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    seconds, ms = divmod(ms, 1000)
    mark = "," if format is CaptionFormat.SRT else "."
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{mark}{ms:03d}"


def _escaped(line: str, format: CaptionFormat) -> str:
    """A line as cue text: VTT reads &, < and > as markup, so they are escaped; SRT takes it as it is."""
    if format is CaptionFormat.SRT:
        return line
    return line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
