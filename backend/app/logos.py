"""Logos: images the owner uploads for Watermarks, kept for every Job in DATA_DIR/logos.

An upload (PNG, JPEG or WebP) is converted by ffmpeg to an RGBA PNG no larger than MAX_SIDE on its
longest side, so that the preview and the Renderer both read one known format, and its size is read
back with ffprobe. A Preset or Candidate whose Logo has been deleted shows no Watermark.
"""

import json
import subprocess
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pydantic import TypeAdapter

from app.storage import write_atomic

# In DATA_DIR, with its index.
LOGOS_DIR = "logos"
INDEX_FILE = "logos.json"
# The largest upload taken, and the longest side kept.
MAX_UPLOAD_BYTES = 5 * 2**20
MAX_SIDE = 1080
# Image formats ffmpeg is asked to read, by their first bytes.
_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"RIFF")


class BadLogo(ValueError):
    """The upload isn't an image that can be a Logo."""


class LogoNotFound(LookupError):
    pass


@dataclass(frozen=True)
class Logo:
    id: str
    # The uploaded file's name, without its extension.
    name: str
    # Of the PNG kept, in pixels.
    width: int
    height: int
    created: datetime


_LOGOS = TypeAdapter(list[Logo])


class LogoStore:
    """The owner's Logos, in `folder`: <id>.png each, and their index."""

    def __init__(self, folder: Path, ffmpeg: Path) -> None:
        self.folder = folder
        self.ffmpeg = ffmpeg
        self._lock = threading.Lock()

    def all(self) -> list[Logo]:
        """In the order they were uploaded."""
        index = self.folder / INDEX_FILE
        return _LOGOS.validate_json(index.read_bytes()) if index.is_file() else []

    def get(self, logo_id: str) -> Logo:
        for logo in self.all():
            if logo.id == logo_id:
                return logo
        raise LogoNotFound(logo_id)

    def find(self, logo_id: str | None) -> Logo | None:
        """The Logo, or None when there is no such Logo (it has been deleted)."""
        try:
            return None if logo_id is None else self.get(logo_id)
        except LogoNotFound:
            return None

    def file(self, logo_id: str) -> Path:
        """The Logo's PNG."""
        return self.folder / f"{self.get(logo_id).id}.png"

    def add(self, data: bytes, filename: str) -> Logo:
        """Keep the image `data`, uploaded as `filename`, as a Logo. BadLogo when it is too large or
        isn't a PNG, JPEG or WebP image ffmpeg can read."""
        if len(data) > MAX_UPLOAD_BYTES:
            raise BadLogo(f"A logo can be {MAX_UPLOAD_BYTES // 2**20} MB at most")
        if not data.startswith(_SIGNATURES) or (data.startswith(b"RIFF") and data[8:12] != b"WEBP"):
            raise BadLogo("Upload a PNG, JPEG or WebP image")
        self.folder.mkdir(parents=True, exist_ok=True)
        logo_id = uuid4().hex
        upload, png = self.folder / f".{logo_id}.upload", self.folder / f"{logo_id}.png"
        try:
            upload.write_bytes(data)
            # Shrunk (never enlarged) to fit MAX_SIDE, keeping its aspect.
            fit = f"scale='min({MAX_SIDE},iw)':'min({MAX_SIDE},ih)':force_original_aspect_ratio=decrease,format=rgba"
            result = subprocess.run(
                [str(self.ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y", "-i", str(upload),
                 "-frames:v", "1", "-vf", fit, "-f", "image2", "-c:v", "png", str(png)],
                capture_output=True, text=True,
            )
            if result.returncode or not png.is_file():
                raise BadLogo("That image couldn't be read: upload a PNG, JPEG or WebP image")
            width, height = self._size(png)
        except BaseException:
            png.unlink(missing_ok=True)
            raise
        finally:
            upload.unlink(missing_ok=True)
        logo = Logo(logo_id, Path(filename).stem[:60] or "Logo", width, height, datetime.now(UTC))
        with self._lock:
            self._save([*self.all(), logo])
        return logo

    def delete(self, logo_id: str) -> None:
        with self._lock:
            logos = self.all()
            if not any(logo.id == logo_id for logo in logos):
                raise LogoNotFound(logo_id)
            self._save([logo for logo in logos if logo.id != logo_id])
        (self.folder / f"{logo_id}.png").unlink(missing_ok=True)

    def _size(self, png: Path) -> tuple[int, int]:
        result = subprocess.run(
            [str(self.ffmpeg.with_name("ffprobe")), "-v", "error", "-select_streams", "v:0", "-of", "json",
             "-show_entries", "stream=width,height", str(png)],
            capture_output=True, text=True,
        )
        streams = json.loads(result.stdout or "{}").get("streams") if not result.returncode else None
        if not streams:
            raise BadLogo("That image couldn't be read: upload a PNG, JPEG or WebP image")
        return streams[0]["width"], streams[0]["height"]

    def _save(self, logos: list[Logo]) -> None:
        write_atomic(self.folder / INDEX_FILE, _LOGOS.dump_json(logos, indent=2))
