"""Media derived for the Advanced Edit's Timeline: Filmstrips and Peaks, made per 30-second chunk of a
Source or a Media Library item (docs/adr/0005-timeline-media-is-derived-per-chunk.md).

A chunk starts at a multiple of CHUNK_SECS seconds. A Filmstrip's holds the frames at each whole
second from there: n = min(30, ceil(duration - start)), scaled to STRIP_HEIGHT pixels tall (their
width set by the video's aspect, rounded to even) and laid side by side in one JPEG. A Peaks chunk
holds the sound from there, mixed to mono at PEAK_RATE and folded into BUCKETS_PER_SECOND buckets
(following Concat's peaks.rs): `[buckets_per_second u16][count u32][min i8 × count][max i8 × count]`,
little-endian. A chunk's path names its format (STRIP_FORMAT, PEAKS_FORMAT), so it is never stale; a
new format is a new version, in new paths.

Chunks are written under a temporary name and renamed when complete, so a half-written one is never
served. Those made on request (a Source's, or an item's uploaded before them) are made outside
the Worker, one at a time under a lock of their own, by an ffmpeg at low priority: on one thread
while the Worker runs a Job, on every core while it is idle. Requests waiting for that lock are
served latest first, so that where a fling across the Timeline stops comes before what it passed.
"""

import math
import os
import struct
import subprocess
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np

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

# The folder Peaks' chunks are kept in, named by their format, and the version in their URLs.
PEAKS_FORMAT = "v1-b1000"
PEAKS_VERSION = "v1"
# A bucket is a millisecond: 48 samples of the sound, mixed to mono and resampled to PEAK_RATE.
BUCKETS_PER_SECOND = 1000
PEAK_RATE = 48_000
_BUCKET = PEAK_RATE // BUCKETS_PER_SECOND
# A bucket's min, in [-1, 0], and max, in [0, 1], are kept as int8: times this.
_PEAK_SCALE = 127
# The output arguments that decode the first sound for Peaks: mono 16-bit samples at PEAK_RATE.
_PEAKS_PCM = ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(PEAK_RATE), "-c:a", "pcm_s16le", "-f", "s16le"]
_SAMPLE_BYTES = 2
# ffmpeg's seek in a compressed sound lands a frame or so late (16 ms into an AAC): Peaks made on
# request seek this many seconds before the chunk, and decode up to it.
_PEAKS_PREROLL = 1


class _LatestFirst:
    """A lock handed, when let go, to the request that began waiting for it last."""

    def __init__(self) -> None:
        self._changed = threading.Condition()
        self._held = False
        self._waiting: list[object] = []

    @contextmanager
    def held(self) -> Iterator[None]:
        me = object()
        with self._changed:
            self._waiting.append(me)
            while self._held or self._waiting[-1] is not me:
                self._changed.wait()
            self._waiting.pop()
            self._held = True
        try:
            yield
        finally:
            with self._changed:
                self._held = False
                self._changed.notify_all()


# One ffmpeg at a time for chunks made on request.
_on_demand = _LatestFirst()


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


def make_strip(
    ffmpeg: Path, video: Path, start: int, duration: float, target: Path, threads: Callable[[], int] = lambda: 1
) -> Path:
    """The chunk of the Filmstrip of `video` (`duration` seconds long) from `start`, at `target`:
    made now, by seeking to `start`, if it isn't there yet. Decoded on `threads()` threads (0: as
    many as ffmpeg likes), asked when its turn comes."""
    frames = frames_in(start, duration)

    def make(part: Path) -> None:
        command = [
            str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-threads", str(threads()),
            "-ss", str(start), "-t", str(frames), "-i", str(video),
            "-map", "0:v:0", "-vf", f"{_STRIP_FRAMES},tile={frames}x1", "-frames:v", "1",
            "-q:v", _STRIP_QUALITY, "-threads", "1", "-f", "image2", str(part),
        ]
        _run(command, f"a Filmstrip of {video.name}")

    return on_demand(target, make)


def fold_peaks(samples: bytes) -> bytes:
    """A Peaks chunk of `samples` (mono, 16-bit, at PEAK_RATE): the lowest and highest sample of each
    bucket, seeded at zero (silence is a flat 0/0, and a min never sits above the axis), with a
    trailing partial bucket counted."""
    pcm = np.frombuffer(samples, dtype="<i2")
    count = -(-len(pcm) // _BUCKET)
    buckets = np.zeros(count * _BUCKET, dtype=np.int32)
    buckets[: len(pcm)] = pcm
    buckets = buckets.reshape(count, _BUCKET)
    low, high = (
        np.rint(extreme * _PEAK_SCALE / 32768).astype(np.int8)
        for extreme in (buckets.min(axis=1, initial=0), buckets.max(axis=1, initial=0))
    )
    return struct.pack("<HI", BUCKETS_PER_SECOND, count) + low.tobytes() + high.tobytes()


@dataclass(frozen=True)
class PeaksOutputs:
    """The Peaks' part of an ffmpeg command that already reads the sound: the output arguments to add
    after the command's own, which decode it to `pcm`, folded into chunks in `folder` by `keep` once
    ffmpeg has succeeded."""

    args: list[str]
    pcm: Path
    folder: Path

    def keep(self) -> None:
        """Fold the decoded sound into its chunks, each written under a temporary name and renamed,
        and remove it."""
        size = CHUNK_SECS * PEAK_RATE * _SAMPLE_BYTES
        try:
            with self.pcm.open("rb") as pcm:
                for start in chunk_starts(self.pcm.stat().st_size / _SAMPLE_BYTES / PEAK_RATE):
                    pcm.seek(start * PEAK_RATE * _SAMPLE_BYTES)
                    target = self.folder / f"{start}.peaks"
                    part = _part(target)
                    part.write_bytes(fold_peaks(pcm.read(size)))
                    os.replace(part, target)
        finally:
            self.pcm.unlink(missing_ok=True)


def peaks_outputs(folder: Path) -> PeaksOutputs:
    """Every chunk of the Peaks of the first sound of an ffmpeg command's input, into `folder`, from
    the one decode."""
    folder.mkdir(parents=True, exist_ok=True)
    pcm = _part(folder / "sound.pcm")
    return PeaksOutputs([*_PEAKS_PCM, str(pcm)], pcm, folder)


class NoSound(RuntimeError):
    """The media has no sound to make Peaks of."""


# Left beside a media's Peaks chunks once it is found to have no sound, so that no chunk of it is
# asked of ffmpeg again.
_NO_SOUND = "no-sound"


def make_peaks(ffmpeg: Path, media: Path, start: int, target: Path) -> Path:
    """The chunk of the Peaks of the sound of `media` from `start`, at `target`: made now, by seeking
    to `start`, if it isn't there yet. NoSound when `media` has none (found once, then remembered)."""
    no_sound = target.with_name(_NO_SOUND)
    if no_sound.exists():
        raise NoSound(f"{media.name} has no sound")
    preroll = min(start, _PEAKS_PREROLL)
    # The first chunk is read from the top: a seek to 0 in an AAC drops its first 21 ms as well as
    # the encoder's priming.
    seek = ["-ss", str(start - preroll)] if start else []
    command = [
        str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-threads", "1",
        *seek, "-i", str(media), "-ss", str(preroll), "-t", str(CHUNK_SECS),
        *_PEAKS_PCM, "-threads", "1", "pipe:1",
    ]

    def make(part: Path) -> None:
        try:
            part.write_bytes(fold_peaks(_run(command, f"the Peaks of {media.name}")))
        except RuntimeError as exc:
            if "matches no streams" not in str(exc):
                raise
            no_sound.touch()
            raise NoSound(f"{media.name} has no sound") from None

    return on_demand(target, make)


def on_demand(target: Path, make: Callable[[Path], None]) -> Path:
    """`target`, made by `make` (given the temporary file to write) if it isn't there yet, under the
    on-demand lock. A request that waited for the lock looks again before making anything, so two
    requests for one chunk make it once."""
    if target.is_file():
        return target
    with _on_demand.held():
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


def _run(command: list[str], what: str) -> bytes:
    """Run ffmpeg at low priority; what it wrote to its output."""
    result = subprocess.run(["nice", "-n", "10", *command], capture_output=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't make {what}: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout
