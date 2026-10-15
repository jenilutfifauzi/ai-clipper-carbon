"""The Media Library: videos, music and images the owner uploads for the Advanced Edit, kept for every
Job in DATA_DIR/media (.scratch/advanced-edit/spec.md).

An upload is written to disk as it comes, then read by ffprobe to tell what it is, whatever its name
says: a video (a moving picture, with or without sound), audio (sound only; a song's cover picture
doesn't make it a video), or an image (one picture). Each is then normalized by ffmpeg into one known
format that the browser plays and the Renderer reads alike:
- a video into H.264 and AAC at 30 fps, no larger than MAX_SIDE, with a small proxy for the editor's
  preview, a thumbnail and the chunks of its Filmstrip and (with sound) its Peaks (app/derived.py),
  from one decode;
- audio into AAC, with the chunks of its Peaks;
- an image into an RGBA PNG no larger than MAX_SIDE, as the Logos are.
A Candidate refers to an item by its id; an item in use can't be deleted (the API checks).
"""

import json
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from pydantic import TypeAdapter

from app.derived import (
    PEAKS_FORMAT,
    STRIP_FORMAT,
    chunk_starts,
    frames_in,
    make_peaks,
    make_strip,
    peaks_outputs,
    strip_outputs,
)
from app.library import Index, shrink
from app.renderer import last_lines

# In DATA_DIR, with its index.
MEDIA_DIR = "media"
INDEX_FILE = "media.json"


class MediaKind(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"


# The largest upload of each kind (an image as large as a Logo may be), and the longest video:
# Shorts and Reels are 3 minutes at most.
MAX_BYTES = {MediaKind.VIDEO: 500 * 10**6, MediaKind.AUDIO: 50 * 10**6, MediaKind.IMAGE: 5 * 2**20}
MAX_UPLOAD_BYTES = max(MAX_BYTES.values())
MAX_SECS = {MediaKind.VIDEO: 180.0}
# The longest side of a video or image kept, of a video's proxy, and of its thumbnail.
MAX_SIDE = 1920
PROXY_SIDE = 640
THUMBNAIL_SIDE = 320
FPS = 30
# What is taken, as ffprobe names it: MP4, MOV or WebM video; MP3, M4A, WAV or AAC songs; PNG, JPEG
# or WebP images. (Matroska is WebM's container; only WebM's codecs make it one.)
_MP4 = "mov,mp4,m4a,3gp,3g2,mj2"
_VIDEO_FORMATS = (_MP4, "matroska,webm")
_WEBM_CODECS = ("vp8", "vp9", "av1")
_AUDIO_FORMATS = ("mp3", "wav", "aac", _MP4)
_IMAGE_FORMATS = ("png_pipe", "jpeg_pipe", "webp_pipe")
_ALLOWED = "Upload an MP4, MOV or WebM video, an MP3, M4A, WAV or AAC song, or a PNG, JPEG or WebP image"


class BadMedia(ValueError):
    """The upload can't be a Media Library item."""


class MediaNotFound(LookupError):
    pass


@dataclass(frozen=True)
class MediaItem:
    id: str
    kind: MediaKind
    # The uploaded file's name, without its extension.
    name: str
    # Of the normalized file: its size in bytes, its length (None for an image), its picture's size
    # (None for audio) and whether it has sound.
    size_bytes: int
    duration: float | None
    width: int | None
    height: int | None
    has_audio: bool
    created: datetime


_ITEMS = TypeAdapter(list[MediaItem])
_SUFFIXES = {MediaKind.VIDEO: ".mp4", MediaKind.AUDIO: ".m4a", MediaKind.IMAGE: ".png"}
MEDIA_TYPES = {MediaKind.VIDEO: "video/mp4", MediaKind.AUDIO: "audio/mp4", MediaKind.IMAGE: "image/png"}


class MediaStore:
    """The Media Library, in `folder`: per item <id>.mp4 (and <id>.proxy.mp4, <id>.jpg and the
    Filmstrip's chunks in <id>.strips), <id>.m4a or <id>.png, the Peaks' chunks of one with sound in
    <id>.peaks, and their index."""

    def __init__(self, folder: Path, ffmpeg: Path, ffprobe: Path) -> None:
        self.folder = folder
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe
        self._index = Index(folder / INDEX_FILE, _ITEMS)

    def all(self) -> list[MediaItem]:
        """In the order they were uploaded."""
        return self._index.all()

    def get(self, media_id: str) -> MediaItem:
        item = self._index.find(media_id)
        if item is None:
            raise MediaNotFound(media_id)
        return item

    def find(self, media_id: str) -> MediaItem | None:
        return self._index.find(media_id)

    def file(self, media_id: str) -> Path:
        """The item's normalized file."""
        item = self.get(media_id)
        return self.folder / f"{item.id}{_SUFFIXES[item.kind]}"

    def proxy(self, media_id: str) -> Path:
        """A video's small copy for the preview; MediaNotFound for any other item."""
        item = self.get(media_id)
        if item.kind is not MediaKind.VIDEO:
            raise MediaNotFound(media_id)
        return self.folder / f"{item.id}.proxy.mp4"

    def thumbnail(self, media_id: str) -> Path:
        """A still of a video (JPEG), or an image's PNG; MediaNotFound for audio."""
        item = self.get(media_id)
        if item.kind is MediaKind.AUDIO:
            raise MediaNotFound(media_id)
        return self.folder / (f"{item.id}.jpg" if item.kind is MediaKind.VIDEO else f"{item.id}.png")

    def filmstrip(self, media_id: str, start: int) -> tuple[Path, int]:
        """A video's Filmstrip chunk from `start` seconds, and how many frames it holds. A chunk the
        upload didn't make (an item uploaded before Filmstrips) is made now, from the proxy.
        MediaNotFound for any other item, or a `start` off the grid or past the end."""
        item = self.get(media_id)
        frames = frames_in(start, item.duration or 0)
        if item.kind is not MediaKind.VIDEO or not frames:
            raise MediaNotFound(media_id)
        chunk = self._strips(media_id) / f"{start}.jpg"
        return make_strip(self.ffmpeg, self.proxy(media_id), start, item.duration or 0, chunk), frames

    def peaks(self, media_id: str, start: int) -> Path:
        """The chunk of a video's or a song's Peaks from `start` seconds. A chunk the upload didn't make
        (an item uploaded before Peaks) is made now, from the item's file. MediaNotFound for an image,
        a video without sound, or a `start` off the grid or past the end."""
        item = self.get(media_id)
        if item.kind is MediaKind.IMAGE or not item.has_audio or not frames_in(start, item.duration or 0):
            raise MediaNotFound(media_id)
        return make_peaks(self.ffmpeg, self.file(media_id), start, self._peaks(media_id) / f"{start}.peaks")

    def add(self, upload: BinaryIO, filename: str) -> MediaItem:
        """Keep what `upload` holds, uploaded as `filename`, as an item. BadMedia when it is too large
        or too long for its kind, or isn't a video, audio or image ffmpeg can read."""
        self.folder.mkdir(parents=True, exist_ok=True)
        media_id = uuid4().hex
        raw = self.folder / f".{media_id}.upload"
        made = [self.folder / f"{media_id}{suffix}" for suffix in (*_SUFFIXES.values(), ".proxy.mp4", ".jpg")]
        try:
            with raw.open("wb") as out:
                copied = _copy(upload, out, MAX_UPLOAD_BYTES + 1)
            if copied > MAX_UPLOAD_BYTES:
                raise BadMedia(f"A file can be {MAX_UPLOAD_BYTES // 10**6} MB at most")
            kind, duration, sound = self._kind(raw)
            if copied > MAX_BYTES[kind]:
                raise BadMedia(f"{kind.value.capitalize()} can be {MAX_BYTES[kind] // 10**6} MB at most")
            longest = MAX_SECS.get(kind)
            if longest is not None and duration > longest:
                raise BadMedia(f"{kind.value.capitalize()} can be {_minutes(longest)} long at most")
            self._normalize(raw, media_id, kind, duration, sound)
            item = self._describe(media_id, kind, Path(filename).stem[:80] or kind.value.capitalize())
            if kind is MediaKind.VIDEO:
                self._drop_uneven_chunks(media_id, duration, item.duration or 0)
        except BaseException:
            for path in made:
                path.unlink(missing_ok=True)
            shutil.rmtree(self._strips(media_id).parent, ignore_errors=True)
            shutil.rmtree(self._peaks(media_id).parent, ignore_errors=True)
            raise
        finally:
            raw.unlink(missing_ok=True)
        self._index.add(item)
        return item

    def delete(self, media_id: str) -> None:
        if not self._index.remove(media_id):
            raise MediaNotFound(media_id)
        for path in self.folder.glob(f"{media_id}.*"):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)

    def _strips(self, media_id: str) -> Path:
        return self.folder / f"{media_id}.strips" / STRIP_FORMAT

    def _peaks(self, media_id: str) -> Path:
        return self.folder / f"{media_id}.peaks" / PEAKS_FORMAT

    def _drop_uneven_chunks(self, media_id: str, uploaded: float, normalized: float) -> None:
        """Remove the chunks the upload made by the uploaded file's length that the normalized one
        would hold a different number of frames in, as its last can, by a few milliseconds: they are
        made again on request, to match the frame count served."""
        for start in chunk_starts(uploaded):
            if frames_in(start, uploaded) != frames_in(start, normalized):
                (self._strips(media_id) / f"{start}.jpg").unlink(missing_ok=True)

    def _probe(self, path: Path) -> dict:
        result = subprocess.run(
            [str(self.ffprobe), "-v", "error", "-of", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True,
        )
        return json.loads(result.stdout or "{}") if not result.returncode else {}

    def _kind(self, path: Path) -> tuple[MediaKind, float, bool]:
        """What the upload is, how long (0 for an image), and whether it has sound. BadMedia for
        anything but the formats taken (`_ALLOWED`), whatever its name says."""
        probe = self._probe(path)
        streams = probe.get("streams") or []
        format_name = probe.get("format", {}).get("format_name", "")
        # A song's cover picture is a video stream, attached.
        pictures = [s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
        sounds = [s for s in streams if s.get("codec_type") == "audio"]
        duration = float(probe.get("format", {}).get("duration") or 0)
        if pictures and format_name in _IMAGE_FORMATS:
            return MediaKind.IMAGE, 0.0, False
        if pictures and format_name in _VIDEO_FORMATS:
            if format_name != _MP4 and pictures[0].get("codec_name") not in _WEBM_CODECS:
                raise BadMedia(_ALLOWED)
            return MediaKind.VIDEO, duration, bool(sounds)
        if sounds and not pictures and format_name in _AUDIO_FORMATS:
            return MediaKind.AUDIO, duration, True
        raise BadMedia(_ALLOWED if streams else f"That file couldn't be read. {_ALLOWED}")

    def _normalize(self, raw: Path, media_id: str, kind: MediaKind, duration: float, sound: bool) -> None:
        base = [str(self.ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-i", str(raw)]
        out = self.folder / media_id
        strips = None
        peaks = peaks_outputs(self._peaks(media_id)) if sound else None
        if kind is MediaKind.VIDEO:
            # One decode: the kept copy, the proxy, the thumbnail, the Filmstrip and the Peaks.
            strips = strip_outputs("s", duration, self._strips(media_id))
            graph = (
                f"[0:v:0]fps={FPS},{shrink(MAX_SIDE, even=True)},setsar=1,format=yuv420p,split=4[v][p][t][s];"
                f"[p]{shrink(PROXY_SIDE, even=True)}[proxy];[t]trim=end_frame=1,{shrink(THUMBNAIL_SIDE, even=True)}[thumb];"
                f"{strips.graph}"
            )
            command = [
                *base, "-filter_complex", graph,
                "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f"{out}.mp4",
                "-map", "[proxy]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
                "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-movflags", "+faststart", f"{out}.proxy.mp4",
                *strips.args,
                *(peaks.args if peaks else []),
                "-map", "[thumb]", "-frames:v", "1", "-q:v", "4", f"{out}.jpg",
            ]
        elif kind is MediaKind.AUDIO:
            # One decode: the Peaks, and the kept copy (last, as it is checked).
            command = [
                *base, *(peaks.args if peaks else []),
                "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f"{out}.m4a",
            ]
        else:
            command = [*base, "-frames:v", "1", "-vf", f"{shrink(MAX_SIDE, even=True)},format=rgba", "-c:v", "png", f"{out}.png"]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode or not Path(command[-1]).is_file():
            raise BadMedia(f"That file couldn't be converted: {last_lines(result.stderr, 1)}")
        if strips:
            strips.keep()
        if peaks:
            peaks.keep()

    def _describe(self, media_id: str, kind: MediaKind, name: str) -> MediaItem:
        path = self.folder / f"{media_id}{_SUFFIXES[kind]}"
        probe = self._probe(path)
        streams = probe.get("streams") or []
        picture = next((s for s in streams if s.get("codec_type") == "video"), None)
        duration = None if kind is MediaKind.IMAGE else round(float(probe.get("format", {}).get("duration") or 0), 3)
        return MediaItem(
            id=media_id,
            kind=kind,
            name=name,
            size_bytes=path.stat().st_size,
            duration=duration,
            width=picture["width"] if picture else None,
            height=picture["height"] if picture else None,
            has_audio=any(s.get("codec_type") == "audio" for s in streams),
            created=datetime.now(UTC),
        )


def _copy(source: BinaryIO, target: BinaryIO, limit: int) -> int:
    """Copy up to `limit` bytes; returns how many were copied."""
    copied = 0
    while copied < limit and (chunk := source.read(min(2**20, limit - copied))):
        target.write(chunk)
        copied += len(chunk)
    return copied


def _minutes(secs: float) -> str:
    minutes = round(secs / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"
