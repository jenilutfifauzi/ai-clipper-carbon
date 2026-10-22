"""Retimed copies (docs/adr/0009-speed-keeps-the-range-and-reverse-is-a-derived-copy.md): a file of a
range of a Source or a Media Library video played backwards, picture and sound (a song's, its sound
alone), which the preview (that can't play a video backwards) and the render (that won't hold a range
in memory) play forwards. A copy can also be retimed at a Speed, with its sound made as the render
makes it, for the preview of a Speed a browser won't play.

A copy is one of two sizes: `preview`, from the item's proxy (its `preview.mp4`, or a media item's
`.proxy.mp4`), no larger than PREVIEW_SIDE; and `full`, from the item's own video, at its size. Copies
are kept beside their item, in `jobs/<id>/retimed/` or `media/<id>.retimed/`, named by their kind, size
and range in milliseconds (and a retimed one's Speed and pitch): `reversed-full-1500-4250.mp4`. A
Source or a media item never changes under its id, so a copy is never stale, and goes with its Job or
item (as ADR 0005's chunks).

Any copy of an item of the same size and retiming whose range covers the one wanted serves it: a
reversed copy of `a..b` shows `c..d` from `b − d` on (`Copy.at`). A split or a trim inward makes no
new copy; a trim outward does.

A copy is made in short pieces (`piece_secs`, a few seconds, fewer at a larger picture), each read
with an accurate seek, reversed (`reverse`, `areverse`, which hold their input in memory) and encoded
on its own, then joined last to first by ffmpeg's concat demuxer without encoding the picture again.
So memory stays bounded at any length. It is written under a temporary name and renamed when
complete, so a copy cut short is never taken for one.

The editor's copies are made outside the Worker, one at a time under a lock of their own, by an
ffmpeg at low priority, latest request first (`Copies.ask`), with their progress kept for the editor
to poll, as ADR 0005's chunks made on request are. A render makes the full-size copy it needs itself,
in the Worker (`Copies.make`).

When a Job is opened, the copies none of its Candidates, nor any state in their Revision History,
plays from (`copies_used`) are removed (`sweep`), with what copies cut short left behind; never what
a copy being made is writing.
"""

import math
import os
import shutil
import subprocess
import threading
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import TypeVar

from app.candidates import Candidate
from app.derived import _LatestFirst
from app.library import shrink
from app.planner import AudioEvent, OverlayEvent, RenderPlan
from app.renderer import last_lines, speed_filters
from app.segment_time import SegmentTime, overlay_time

E = TypeVar("E", OverlayEvent, AudioEvent)

# In a Job's directory.
RETIMED_DIR = "retimed"
# The Speeds a browser plays a video at; the preview plays an item at any other from a copy retimed at
# it (docs/adr/0009).
PLAYABLE_SPEEDS = (0.25, 4.0)
# The longest side of a preview copy.
PREVIEW_SIDE = 1280
# What `reverse` may hold of a piece's decoded frames (yuv420p), and the pieces' shortest and longest.
PIECE_BYTES = 128 * 2**20
PIECE_SECS = (0.5, 10.0)
AUDIO_RATE = 48_000
# A preview copy has a keyframe each second, so that the preview's seeks in it are quick.
_ENCODE = {
    "preview": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-force_key_frames", "expr:gte(t,n_forced)"],
    "full": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"],
}
_AUDIO_BITRATE = {"preview": "128k", "full": "192k"}


class CopySize(StrEnum):
    PREVIEW = "preview"
    FULL = "full"


@dataclass(frozen=True)
class Retime:
    """What a copy plays: its item's range from `start` to `end` seconds, backwards when `reverse`, at
    `speed` (its sound's pitch following it with `pitch`, as the render's does)."""

    start: float
    end: float
    reverse: bool = True
    speed: float = 1.0
    pitch: bool = False

    @property
    def kind(self) -> str:
        return "reversed" if self.speed == 1 else "retimed"

    def name(self, size: CopySize) -> str:
        """The copy's file name: its kind, size and range in ms, and a retimed one's Speed, pitch and direction."""
        first, last = math.floor(round(self.start * 1000, 3)), math.ceil(round(self.end * 1000, 3))
        timed = "" if self.speed == 1 else f"-x{self.speed:g}{'-pitch' if self.pitch else ''}{'-reversed' if self.reverse else ''}"
        return f"{self.kind}-{size}-{first}-{last}{timed}.mp4"

    @classmethod
    def named(cls, name: str) -> tuple[CopySize, "Retime"] | None:
        """The size and retiming a copy's file name gives; None for any other file."""
        parts = name.removesuffix(".mp4").split("-")
        if not name.endswith(".mp4") or len(parts) < 4 or parts[0] not in ("reversed", "retimed") or parts[1] not in CopySize.__members__.values():
            return None
        try:
            first, last = int(parts[2]), int(parts[3])
            speed = float(parts[4][1:]) if parts[0] == "retimed" else 1.0
        except (ValueError, IndexError):
            return None
        reverse = parts[0] == "reversed" or "reversed" in parts[5:]
        return CopySize(parts[1]), cls(first / 1000, last / 1000, reverse, speed, "pitch" in parts[5:])

    def covers(self, other: "Retime") -> bool:
        """Whether a copy of this serves `other`: retimed alike, over a range holding `other`'s."""
        alike = (self.reverse, self.speed, self.pitch) == (other.reverse, other.speed, other.pitch)
        return alike and self.start <= other.start + 0.0005 and self.end >= other.end - 0.0005


@dataclass(frozen=True)
class Copy:
    """A Retimed copy at `path`, of `size`, playing `retime`."""

    path: Path
    size: CopySize
    retime: Retime

    def at(self, start: float, end: float) -> float:
        """Seconds into the copy where it shows the range `start..end` of its item: from its range's
        end less `end` when reversed, else from `start` less its range's start, at its Speed."""
        into = self.retime.end - end if self.retime.reverse else start - self.retime.start
        return round(max(0.0, into) / self.retime.speed, 6)

    def read(self, time: SegmentTime) -> SegmentTime:
        """How a copy at 1× plays what `time` shows of its item: forwards, from `at`, for as long, at
        `time`'s Speed."""
        at = self.at(time.start, time.end)
        return SegmentTime(at, at + time.span, time.speed)


@dataclass(frozen=True)
class Making:
    """How a copy asked for is coming along: `progress` from 0 to 1, then the `copy`; or the `error`
    that stopped it."""

    progress: float
    copy: Copy | None = None
    error: str | None = None


class Copies:
    """The Retimed copies of one item (a Source, or a Media Library video or song), in `folder`, made
    from `videos` (its proxy for the preview size, its own file for the full size), whose full-size
    picture is `frame` (width, height, frames a second); a song's, None, are sound alone."""

    def __init__(self, folder: Path, videos: Mapping[CopySize, Path], frame: tuple[int, int, float] | None) -> None:
        self.folder = folder
        self.videos = videos
        self.frame = frame

    def find(self, size: CopySize, retime: Retime) -> Copy | None:
        """The smallest complete copy of `size` that serves `retime`, if any."""
        found = []
        for path in self.folder.glob(f"*-{size}-*.mp4") if self.folder.is_dir() else ():
            named = Retime.named(path.name)
            if named is not None and named[0] is size and named[1].covers(retime):
                found.append(Copy(path, size, named[1]))
        return min(found, key=lambda copy: copy.retime.end - copy.retime.start, default=None)

    def make(
        self,
        ffmpeg: Path,
        size: CopySize,
        retime: Retime,
        progress: Callable[[float], None] = lambda done: None,
        threads: Callable[[], int] = lambda: 0,
        nice: bool = False,
    ) -> Copy:
        """A copy of `size` serving `retime`: one there is, or one made now, in this thread, its
        `progress` reported from 0 to 1 (a render's, in the Worker)."""
        found = self.find(size, retime)
        if found is not None:
            return found
        path = self.folder / retime.name(size)
        frame = self._frame(size)
        fps, piece = (frame[2], piece_secs(*frame)) if frame else (None, PIECE_SECS[1])
        _reverse_in_pieces(ffmpeg, self.videos[size], retime, size, path, fps, piece, progress, threads(), nice)
        named = Retime.named(path.name)
        assert named is not None
        return Copy(path, size, named[1])

    def ask(self, ffmpeg: Path, size: CopySize, retime: Retime, threads: Callable[[], int] = lambda: 1) -> Making:
        """How the copy of `size` serving `retime` is coming along (the editor's, polled): there
        already, being made (by an earlier ask of it, or of a wider range), or now queued to be made
        outside the Worker, under the lock, latest ask first, at low priority, on `threads()` threads
        (asked when its turn comes). A failure is told once; the next ask tries again."""
        found = self.find(size, retime)
        if found is not None:
            return Making(1.0, found)
        with _asked_lock:
            for target, making in list(_asked.items()):
                named = Retime.named(target.name)
                if target.parent != self.folder or named is None or named[0] is not size or not named[1].covers(retime):
                    continue
                if making.error is not None:
                    del _asked[target]
                return making
            target = self.folder / retime.name(size)
            _asked[target] = Making(0.0)

        def report(done: float) -> None:
            with _asked_lock:
                _asked[target] = Making(round(done, 3))

        def run() -> None:
            try:
                with _retiming.held():
                    self.make(ffmpeg, size, retime, report, threads, nice=True)
            except Exception as exc:
                with _asked_lock:
                    _asked[target] = Making(0.0, error=str(exc))
            else:
                with _asked_lock:
                    _asked.pop(target, None)

        threading.Thread(target=run, name=f"retime {target.name}", daemon=True).start()
        return Making(0.0)

    def _frame(self, size: CopySize) -> tuple[int, int, float] | None:
        if self.frame is None:
            return None
        width, height, fps = self.frame
        if size is CopySize.PREVIEW and max(width, height) > PREVIEW_SIDE:
            scale = PREVIEW_SIDE / max(width, height)
            return round(width * scale), round(height * scale), fps
        return width, height, fps


# The copies asked for by the editor and not yet made (or failed), by their target path.
_asked: dict[Path, Making] = {}
_asked_lock = threading.Lock()
# One ffmpeg at a time for the editor's copies.
_retiming = _LatestFirst()
# What copies being made are writing now, by the editor or a render: their final names, the parts
# they are written under and the folders of their pieces, which the sweep leaves.
_writing: set[Path] = set()
_writing_lock = threading.Lock()


def piece_secs(width: int, height: int, fps: float) -> float:
    """How long the pieces of a copy of a `width`×`height` picture at `fps` are: as many frames as
    PIECE_BYTES holds in yuv420p, within PIECE_SECS."""
    held = PIECE_BYTES / (width * height * 1.5 * max(fps, 1.0))
    return min(PIECE_SECS[1], max(PIECE_SECS[0], round(held, 3)))


def read_from_copies(
    plan: RenderPlan, files: dict[str, Path], copy_of: Callable[[str | None, SegmentTime], Copy]
) -> tuple[RenderPlan, dict[str, Path]]:
    """The Render Plan as the renderer reads it, and its files: each reversed Segment, each reversed
    Overlay's picture and sound (one Behind the Main Track's too), and each reversed Music Clip, played forwards from the full-size copy
    `copy_of` gives for its item (None: the Source) and range, at its Speed. The copy is in `files` under its own path: a
    media Segment's or an Overlay's stands in for its video; a Source Segment's is its `read_from`,
    still a Segment of the Source (its Scenes' panels, the Clip's own volume)."""
    segments = []
    files = dict(files)

    def read(media: str | None, time: SegmentTime) -> tuple[str, SegmentTime]:
        copy = copy_of(media, time)
        files[str(copy.path)] = copy.path
        return str(copy.path), copy.read(time)

    for segment in plan.segments:
        if not segment.reverse or segment.hold is not None:
            segments.append(segment)
            continue
        path, played = read(segment.media, segment.time)
        reads = {"media": path} if segment.media is not None else {"read_from": path}
        segments.append(replace(segment, **reads, source_start=played.start, source_end=played.end, reverse=False))

    def forwards(event: E) -> E:
        if not event.reverse:
            return event
        path, played = read(event.media, event.time)
        return replace(event, media=path, offset=played.start, reverse=False)

    overlays, audio = [forwards(event) for event in plan.overlays], [forwards(event) for event in plan.audio]
    return replace(plan, segments=segments, overlays=overlays, behind=[forwards(event) for event in plan.behind], audio=audio), files


def preview_copy(start: float, end: float, speed: float = 1.0, reverse: bool = False, pitch: bool = False) -> Retime | None:
    """What the preview copy of an item (a Segment, or a video Overlay) playing its file's range from
    `start` to `end` at `speed`, backwards when `reverse`, plays: at a Speed a browser won't play
    (outside PLAYABLE_SPEEDS), its range retimed at it; else in Reverse, its range reversed, which the
    preview plays at its Speed. None for an item played from its own file. The editor's twin is
    `previewCopyOf` in frontend/src/pages/job/editor/retimedCopy.ts; both are tested on the cases in
    tests/fixtures/preview_copies.json."""
    if not PLAYABLE_SPEEDS[0] <= speed <= PLAYABLE_SPEEDS[1]:
        return Retime(start, end, reverse, speed, pitch)
    return Retime(start, end) if reverse else None


def copies_played(start: float, end: float, speed: float = 1.0, reverse: bool = False, pitch: bool = False) -> list[tuple[CopySize, Retime]]:
    """The Retimed copies an item (a Segment, or a video Overlay) playing its file's range from `start`
    to `end` at `speed`, backwards when `reverse`, is played from, by their size: in Reverse, the
    full-size reversed copy its render reads; and its `preview_copy`. Empty for an item played from
    its own file."""
    played = [(CopySize.FULL, Retime(start, end))] if reverse else []
    preview = preview_copy(start, end, speed, reverse, pitch)
    return played if preview is None else [*played, (CopySize.PREVIEW, preview)]


def copies_used(candidates: Iterable[Candidate], durations: Mapping[str, float]) -> dict[str | None, list[tuple[CopySize, Retime]]]:
    """The Retimed copies `candidates` play from (`copies_played`), by their item: a Media Library
    video's or song's id, or None for the Source. An Overlay or a Music Clip is of one of the items
    `durations` gives (an image has none), or a Music Clip of the Source, its range cut where its
    file (the Source's read being kept within it) and the Clip end (`overlay_time`)."""
    used: dict[str | None, list[tuple[CopySize, Retime]]] = defaultdict(list)
    for candidate in candidates:
        for segment in candidate.main_track():
            if segment.hold is None:
                used[segment.media] += copies_played(segment.start, segment.end, segment.speed, segment.reverse, segment.pitch)
        for overlay in candidate.overlays:
            if overlay.media in durations:
                shown = candidate.duration - overlay.start
                time = overlay_time(overlay.offset, overlay.secs, overlay.speed, overlay.reverse, durations[overlay.media], shown)
                used[overlay.media] += copies_played(time.start, time.end, overlay.speed, overlay.reverse, overlay.pitch)
        for clip in candidate.music:
            if clip.media is None or clip.media in durations:
                length = math.inf if clip.media is None else durations[clip.media]
                time = overlay_time(clip.offset, clip.secs, clip.speed, clip.reverse, length, candidate.duration - clip.start)
                used[clip.media] += copies_played(time.start, time.end, clip.speed, clip.reverse, clip.pitch)
    return used


def sweep(folder: Path, used: Iterable[tuple[CopySize, Retime]]) -> list[Path]:
    """Remove the copies in `folder` that serve none of `used`, and the parts and pieces copies cut
    short (by a process stopped mid-copy) left there, but nothing a copy being made is writing now.
    The paths removed."""
    used = list(used)
    removed = []
    with _writing_lock:
        for path in sorted(folder.iterdir()) if folder.is_dir() else ():
            if path in _writing:
                continue
            named = Retime.named(path.name)
            if named is None:
                if not (path.name.startswith(".") and path.name.endswith((".part.mp4", ".pieces"))):
                    continue
            elif any(size is named[0] and named[1].covers(retime) for size, retime in used):
                continue
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
            removed.append(path)
    return removed


def _reverse_in_pieces(
    ffmpeg: Path,
    video: Path,
    retime: Retime,
    size: CopySize,
    target: Path,
    fps: float | None,
    piece: float,
    progress: Callable[[float], None],
    threads: int,
    nice: bool,
    encode: list[str] | None = None,
) -> None:
    """Write the copy of `video` that `retime` says to `target`: its range cut into pieces of about
    `piece` seconds, each reversed (when `retime.reverse`) and played at its Speed, then joined last to
    first (or first to last), under a temporary name renamed when complete. At a Speed, its picture is
    brought back to `fps` frames a second, as a render's is (every 8th frame at 8×, each frame 8
    times at 0.125×), and each piece's sound, made by the render's filters, is cut or padded to the
    piece's length (`atempo` drops a little of a sound's end), so that the joins keep in step. A
    song's copy (no `fps`) is its sound alone. Its picture is encoded as its `size`'s, or as `encode`
    says (a Matte's reversed copy, app/matte.py)."""
    span = retime.end - retime.start
    count = max(1, math.ceil(span / piece - 1e-9))
    length = span / count
    target.parent.mkdir(parents=True, exist_ok=True)
    work = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.pieces")
    part = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.part.mp4")
    run = ["nice", "-n", "10"] if nice else []
    base = [str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-threads", str(threads)]
    picture = [*([shrink(PREVIEW_SIDE, even=True)] if size is CopySize.PREVIEW else []), "format=yuv420p"]
    sound = []
    if retime.reverse:
        picture.append("reverse")
        sound.append("areverse")
    if retime.speed != 1 and fps:
        # Each frame of the copy is the last of the item's at or before its time: a frame landing on
        # one of the copy's (a thousandth of a frame early, against rounding) is that one.
        picture += ["settb=AVTB", f"setpts=PTS/{retime.speed:.6g}-{0.001 / fps:.6g}/TB", f"fps={fps:.6g}:round=up"]
    if retime.speed != 1:
        played = length / retime.speed
        sound += [*speed_filters(retime.speed, retime.pitch, AUDIO_RATE), f"apad=whole_dur={played:.6f}", f"atrim=duration={played:.6f}"]
    with _writing_lock:
        _writing.update((target, work, part))
    try:
        work.mkdir()
        pieces = []
        for i in range(count):
            out = work / f"{i}.mov"
            shown = ["-map", "0:v:0", "-vf", ",".join(picture), *(encode or _ENCODE[size])] if fps else []
            command = [
                *run, *base, "-ss", f"{retime.start + i * length:.6f}", "-t", f"{length:.6f}", "-i", str(video),
                *shown, "-map", "0:a:0?", *(["-af", ",".join(sound)] if sound else []),
                "-threads", str(threads), "-c:a", "pcm_s16le", "-ar", str(AUDIO_RATE), str(out),
            ]
            _run(command, f"piece {i + 1} of {count} of a copy of {video.name}")
            pieces.append(out)
            progress((i + 1) / (count + 1))
        listing = work / "pieces.txt"
        # Each piece placed `length` after the one before, whatever its frames' durations add up to, so
        # that the copy keeps to its range's times.
        joined = reversed(pieces) if retime.reverse else pieces
        listing.write_text("".join(f"file '{out.name}'\nduration {length / retime.speed:.6f}\n" for out in joined))
        _run(
            [
                *run, *base, "-f", "concat", "-safe", "0", "-i", str(listing),
                *(["-map", "0:v:0", "-c:v", "copy"] if fps else []), "-map", "0:a:0?", "-c:a", "aac", "-b:a", _AUDIO_BITRATE[size],
                "-movflags", "+faststart", "-f", "mp4", str(part),
            ],
            f"a copy of {video.name}",
        )
        os.replace(part, target)
        progress(1.0)
    finally:
        part.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)
        with _writing_lock:
            _writing.difference_update((target, work, part))


def _run(command: list[str], what: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't make {what}: {last_lines(result.stderr, 1)}")
