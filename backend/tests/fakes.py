"""Fakes for the ports, for Seam A tests."""

import shutil
import threading
from pathlib import Path

from app.video_source import VIDEO_FILE, Source, probe


class FakeVideoSource:
    """Copies a fixture video and json3 track into the Job directory.

    `hold()` makes `fetch` block until `release()`; `fail_with()` makes it raise.
    """

    def __init__(self, video: Path, caption_track: Path | None, ffprobe: Path) -> None:
        self.video = video
        self.caption_track = caption_track
        self.ffprobe = ffprobe
        self.calls: list[tuple[str, str]] = []
        self.error: Exception | None = None
        self._released = threading.Event()
        self._released.set()

    def hold(self) -> None:
        self._released.clear()

    def release(self) -> None:
        self._released.set()

    def fail_with(self, error: Exception | None) -> None:
        self.error = error

    def fetch(self, url: str, language: str, dest: Path) -> Source:
        self.calls.append((url, language))
        if not self._released.wait(timeout=10):
            raise TimeoutError("FakeVideoSource was held and never released")
        if self.error:
            raise self.error

        shutil.copy(self.video, dest / VIDEO_FILE)
        track = None
        if self.caption_track:
            track = f"source.{language}-orig.json3"
            shutil.copy(self.caption_track, dest / track)
        return Source(VIDEO_FILE, track, probe(self.ffprobe, dest / VIDEO_FILE))
