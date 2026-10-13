"""Fakes for the ports, for Seam A tests."""

import shutil
import threading
from pathlib import Path

from app.transcriber import TranscriptionStopped
from app.transcript import Segment, Transcript, Word
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


class FakeTranscriber:
    """Hears the scripted Words: those overlapping the requested range, clipped to it, the way
    Whisper hears a word that the range cuts in two. All of a call's Words form one Segment.

    `stall(n)` makes the next `n` calls hang like a stuck Whisper run, until `stop()`.
    `hold(after=n)` makes the calls after the first `n` wait for `release()`.
    """

    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[tuple[str, float, float | None]] = []
        self._stalls = 0
        self._stalled: list[threading.Event] = []
        self._hold_after: int | None = None
        self._released = threading.Event()

    def stall(self, times: int) -> None:
        self._stalls = times

    def hold(self, after: int = 0) -> None:
        self._hold_after = after
        self._released.clear()

    def release(self) -> None:
        self._released.set()

    def stop(self) -> None:
        for stalled in self._stalled:
            stalled.set()

    def transcribe(self, media: Path, language: str, start: float = 0.0, end: float | None = None) -> Transcript:
        self.calls.append((language, start, end))
        if self._stalls:
            self._stalls -= 1
            stalled = threading.Event()
            self._stalled.append(stalled)
            stalled.wait(timeout=10)
            raise TranscriptionStopped("FakeTranscriber was stopped")
        if self._hold_after is not None and len(self.calls) > self._hold_after:
            if not self._released.wait(timeout=10):
                raise TimeoutError("FakeTranscriber was held and never released")

        stop = float("inf") if end is None else end
        words = [
            Word(word.text, max(word.start, start), min(word.end, stop))
            for word in self.words
            if word.end > start and word.start < stop
        ]
        segments = [Segment(" ".join(word.text for word in words), words[0].start, words[-1].end)] if words else []
        return Transcript(language, "whisper", words, segments)
