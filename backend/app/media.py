"""The Media Library: videos, music and images the owner uploads for the Advanced Edit, kept for every
Job in DATA_DIR/media (.scratch/advanced-edit/spec.md).

An upload is written to disk as it comes, then read by ffprobe to tell what it is, whatever its name
says: a video (a moving picture, with or without sound), audio (sound only; a song's cover picture
doesn't make it a video), or an image (one picture). Each is then normalized by ffmpeg into one known
format that the browser plays and the Renderer reads alike:
- a video into H.264 and AAC at 30 fps, no larger than MAX_SIDE, with a small proxy for the editor's
  preview and a thumbnail, from one decode;
- audio into AAC;
- an image into an RGBA PNG no larger than MAX_SIDE, as the Logos are.
A Candidate refers to an item by its id; an item in use can't be deleted (the API checks).
"""

import json
import subprocess
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from pydantic import TypeAdapter

from app.storage import write_atomic

# In DATA_DIR, with its index.
MEDIA_DIR = "media"
INDEX_FILE = "media.json"


class MediaKind(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"


# The largest upload of each kind, and the longest video (Shorts and Reels are 3 minutes at most)
# and music.
MAX_BYTES = {MediaKind.VIDEO: 500 * 10**6, MediaKind.AUDIO: 50 * 10**6, MediaKind.IMAGE: 10 * 10**6}
MAX_UPLOAD_BYTES = max(MAX_BYTES.values())
MAX_SECS = {MediaKind.VIDEO: 180.0, MediaKind.AUDIO: 600.0}
# The longest side of a video or image kept, of a video's proxy, and of its thumbnail.
MAX_SIDE = 1920
PROXY_SIDE = 640
THUMBNAIL_SIDE = 320
FPS = 30
# Formats ffprobe gives a single picture.
_IMAGE_FORMATS = ("image2", "png_pipe", "jpeg_pipe", "webp_pipe", "gif", "bmp_pipe")


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
    """The Media Library, in `folder`: per item <id>.mp4 (and <id>.proxy.mp4 and <id>.jpg), <id>.m4a
    or <id>.png, and their index."""

    def __init__(self, folder: Path, ffmpeg: Path, ffprobe: Path) -> None:
        self.folder = folder
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe
        self._lock = threading.Lock()

    def all(self) -> list[MediaItem]:
        """In the order they were uploaded."""
        index = self.folder / INDEX_FILE
        return _ITEMS.validate_json(index.read_bytes()) if index.is_file() else []

    def get(self, media_id: str) -> MediaItem:
        for item in self.all():
            if item.id == media_id:
                return item
        raise MediaNotFound(media_id)

    def find(self, media_id: str) -> MediaItem | None:
        try:
            return self.get(media_id)
        except MediaNotFound:
            return None

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
            kind, duration = self._kind(raw)
            if copied > MAX_BYTES[kind]:
                raise BadMedia(f"{kind.value.capitalize()} can be {MAX_BYTES[kind] // 10**6} MB at most")
            longest = MAX_SECS.get(kind)
            if longest is not None and duration > longest:
                raise BadMedia(f"{kind.value.capitalize()} can be {_minutes(longest)} long at most")
            self._normalize(raw, media_id, kind)
            item = self._describe(media_id, kind, Path(filename).stem[:80] or kind.value.capitalize())
        except BaseException:
            for path in made:
                path.unlink(missing_ok=True)
            raise
        finally:
            raw.unlink(missing_ok=True)
        with self._lock:
            self._save([*self.all(), item])
        return item

    def delete(self, media_id: str) -> None:
        with self._lock:
            items = self.all()
            if not any(item.id == media_id for item in items):
                raise MediaNotFound(media_id)
            self._save([item for item in items if item.id != media_id])
        for path in self.folder.glob(f"{media_id}.*"):
            path.unlink(missing_ok=True)

    def _probe(self, path: Path) -> dict:
        result = subprocess.run(
            [str(self.ffprobe), "-v", "error", "-of", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True,
        )
        return json.loads(result.stdout or "{}") if not result.returncode else {}

    def _kind(self, path: Path) -> tuple[MediaKind, float]:
        """What the upload is, and how long (0 for an image)."""
        probe = self._probe(path)
        streams = probe.get("streams") or []
        if not streams:
            raise BadMedia("That file couldn't be read: upload a video, a song or an image")
        format_name = probe.get("format", {}).get("format_name", "")
        # A song's cover picture is a video stream, attached.
        pictures = [s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
        sounds = [s for s in streams if s.get("codec_type") == "audio"]
        duration = float(probe.get("format", {}).get("duration") or 0)
        if pictures and format_name in _IMAGE_FORMATS:
            return MediaKind.IMAGE, 0.0
        if pictures:
            return MediaKind.VIDEO, duration
        if sounds:
            return MediaKind.AUDIO, duration
        raise BadMedia("That file couldn't be read: upload a video, a song or an image")

    def _normalize(self, raw: Path, media_id: str, kind: MediaKind) -> None:
        base = [str(self.ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-i", str(raw)]
        out = self.folder / media_id
        if kind is MediaKind.VIDEO:
            # One decode: the kept copy, the proxy and the thumbnail.
            graph = (
                f"[0:v:0]fps={FPS},{_fit(MAX_SIDE)},setsar=1,format=yuv420p,split=3[v][p][t];"
                f"[p]{_fit(PROXY_SIDE)}[proxy];[t]trim=end_frame=1,{_fit(THUMBNAIL_SIDE)}[thumb]"
            )
            command = [
                *base, "-filter_complex", graph,
                "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f"{out}.mp4",
                "-map", "[proxy]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
                "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-movflags", "+faststart", f"{out}.proxy.mp4",
                "-map", "[thumb]", "-frames:v", "1", "-q:v", "4", f"{out}.jpg",
            ]
        elif kind is MediaKind.AUDIO:
            command = [*base, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f"{out}.m4a"]
        else:
            command = [*base, "-frames:v", "1", "-vf", f"{_fit(MAX_SIDE)},format=rgba", "-c:v", "png", f"{out}.png"]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode or not Path(command[-1]).is_file():
            raise BadMedia(f"That file couldn't be converted: {_last_line(result.stderr)}")

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

    def _save(self, items: list[MediaItem]) -> None:
        write_atomic(self.folder / INDEX_FILE, _ITEMS.dump_json(items, indent=2))


def _fit(side: int) -> str:
    """A scale filter that shrinks (never enlarges) a picture to fit `side`, keeping its aspect, to even sizes."""
    return f"scale='min({side},iw)':'min({side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"


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


def _last_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[-1] if lines else "ffmpeg failed"

