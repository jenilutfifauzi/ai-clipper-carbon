"""Media derived for the Advanced Edit's Timeline: Filmstrips, made per 30-second chunk of a Source or
a Media Library video (docs/adr/0005-timeline-media-is-derived-per-chunk.md).

A chunk starts at a multiple of CHUNK_SECS seconds and holds the frames at each whole second from
there: n = min(30, ceil(duration - start)), scaled to STRIP_HEIGHT pixels tall (their width set by
the video's aspect, rounded to even) and laid side by side in one JPEG. Its path names the format
(STRIP_FORMAT), so a chunk is never stale; a new format is a new version, in new paths.

Chunks are written under a temporary name and renamed when complete, so a half-written one is never
served. Those made on request (a Source's, or a video uploaded before Filmstrips) are made outside
the Worker, one at a time under a lock of their own, by an ffmpeg at low priority on one thread.
"""

import math
import os
import subprocess
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

CHUNK_SECS = 30
STRIP_HEIGHT = 112
# The folder a Filmstrip's chunks are kept in, named by its format, and the version in their URLs.
STRIP_FORMAT = "v1-1fps-h112"
STRIP_VERSION = "v1"
# ffmpeg's JPEG quality scale (2 best, 31 worst): 5 is about libjpeg's quality 75.
_STRIP_QUALITY = "5"
# Frames from STRIP_HEIGHT pixels tall, at the video's display aspect, rounded to even.
_STRIP_SCALE = f"scale='2*round({STRIP_HEIGHT}*dar/2)':{STRIP_HEIGHT},setsar=1"
# Frames are taken at each whole second, and a video's last picture may end a little before its sound
# does: the last picture is held for a second, so the last tile is never missing.
_STRIP_FRAMES = f"tpad=stop_mode=clone:stop_duration=1,fps=1,{_STRIP_SCALE}"

# One ffmpeg at a time for chunks made on request.
_on_demand = threading.Lock()


def chunk_starts(duration: float) -> list[int]:
    """The starts of the chunks of media `duration` seconds long."""
    return list(range(0, math.ceil(round(duration, 3)), CHUNK_SECS))


def frames_in(start: int, duration: float) -> int:
    """How many frames the chunk from `start` holds; 0 for a start off the grid or outside the media."""
    if start < 0 or start % CHUNK_SECS:
        return 0
    return max(0, min(CHUNK_SECS, math.ceil(round(duration - start, 3))))


@dataclass(frozen=True)
class StripOutputs:
    """The Filmstrip's part of an ffmpeg command that already reads the video: a filter graph, the
    output arguments to add after the command's own, and the chunks they write, to `keep` once
    ffmpeg has succeeded."""

    graph: str
    args: list[str]
    # Each chunk's temporary file, and its own.
    parts: list[tuple[Path, Path]]

    def keep(self) -> None:
        """Rename the chunks written into place."""
        for part, target in self.parts:
            if part.is_file():
                os.replace(part, target)


def strip_outputs(source: str, duration: float, folder: Path) -> StripOutputs:
    """Every chunk of the Filmstrip of the stream labelled `source`, of a video `duration` seconds
    long, into `folder`, from the one decode."""
    starts = chunk_starts(duration)
    folder.mkdir(parents=True, exist_ok=True)
    graph = f"[{source}]{_STRIP_FRAMES},split={len(starts)}{''.join(f'[strip{start}in]' for start in starts)}"
    args: list[str] = []
    parts = []
    for start in starts:
        frames = frames_in(start, duration)
        graph += f";[strip{start}in]trim=start_frame={start}:end_frame={start + frames},tile={frames}x1[strip{start}]"
        part = _part(folder / f"{start}.jpg")
        args += ["-map", f"[strip{start}]", "-frames:v", "1", "-q:v", _STRIP_QUALITY, "-f", "image2", str(part)]
        parts.append((part, folder / f"{start}.jpg"))
    return StripOutputs(graph, args, parts)


def make_strip(ffmpeg: Path, video: Path, start: int, duration: float, target: Path) -> Path:
    """The chunk of the Filmstrip of `video` (`duration` seconds long) from `start`, at `target`:
    made now, by seeking to `start`, if it isn't there yet."""
    frames = frames_in(start, duration)
    command = [
        str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-threads", "1",
        "-ss", str(start), "-t", str(frames), "-i", str(video),
        "-map", "0:v:0", "-vf", f"{_STRIP_FRAMES},tile={frames}x1", "-frames:v", "1",
        "-q:v", _STRIP_QUALITY, "-threads", "1", "-f", "image2",
    ]
    return on_demand(target, lambda part: _run([*command, str(part)], f"a Filmstrip of {video.name}"))


def on_demand(target: Path, make: Callable[[Path], None]) -> Path:
    """`target`, made by `make` (given the temporary file to write) if it isn't there yet, under the
    on-demand lock. A request that waited for the lock looks again before making anything, so two
    requests for one chunk make it once."""
    if target.is_file():
        return target
    with _on_demand:
        if target.is_file():
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        part = _part(target)
        try:
            make(part)
            os.replace(part, target)
        finally:
            part.unlink(missing_ok=True)
    return target


def _part(target: Path) -> Path:
    return target.with_name(f".{target.stem}.{uuid.uuid4().hex}.part{target.suffix}")


def _run(command: list[str], what: str) -> None:
    """Run ffmpeg at low priority."""
    result = subprocess.run(["nice", "-n", "10", *command], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't make {what}: {result.stderr.strip()}")
