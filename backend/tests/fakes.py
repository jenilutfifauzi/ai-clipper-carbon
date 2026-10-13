"""Fakes for the ports, for Seam A tests."""

import re
import shutil
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.llm import DetailResponse, LlmRequest, ScoreResponse
from app.transcriber import TranscriptionStopped
from app.transcript import Segment, Transcript, Word
from app.video_source import VIDEO_FILE, Source, probe


class FakeVideoSource:
    """Copies a fixture video and json3 track into the Job directory.

    `hold()` makes `fetch` block until `release()`; `fail_with()` makes it raise.
    `fetch_captions` copies `captions[url]` (`caption_track` for other URLs): a track, None for a
    video without one, or an exception to raise. Its calls are recorded apart from `fetch`'s.
    """

    def __init__(self, video: Path, caption_track: Path | None, ffprobe: Path) -> None:
        self.video = video
        self.caption_track = caption_track
        self.ffprobe = ffprobe
        self.captions: dict[str, Path | Exception | None] = {}
        self.calls: list[tuple[str, str]] = []
        self.caption_calls: list[tuple[str, str]] = []
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

    def fetch_captions(self, url: str, language: str, dest: Path) -> str | None:
        self.caption_calls.append((url, language))
        captions = self.captions.get(url, self.caption_track)
        if isinstance(captions, Exception):
            raise captions
        if captions is None:
            return None
        track = f"source.{language}-orig.json3"
        shutil.copy(captions, dest / track)
        return track


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


# A Window as the Score prompt shows it.
WINDOW = re.compile(r'<window id="([^"]+)" start="([^"]+)" end="([^"]+)">\n(.*?)\n</window>', re.S)


def windows_in(prompt: str) -> list[tuple[str, str, str, str]]:
    """The (id, start, end, text) of each Window in a Score prompt."""
    return WINDOW.findall(prompt)


class FakeLlm:
    """Answers like Gemini, from scripted judgements, and records every request.

    Score: each Window in the prompt gets `score_window(text)`, 50 unless scripted.
    Detail: `clips`, written by the test in the response schema's shape; none unless scripted.
    `fail_with(error, times, after)` makes `times` calls raise `error`, after `after` that don't.
    `sent` records when each request came (time.monotonic()).
    """

    def __init__(self) -> None:
        self.score_window: Callable[[str], int] = lambda text: 50
        self.clips: list[dict] = []
        self.score_requests: list[LlmRequest] = []
        self.detail_requests: list[LlmRequest] = []
        self.sent: list[float] = []
        self._failures: list[Exception | None] = []

    def fail_with(self, error: Exception, times: int = 1, after: int = 0) -> None:
        self._failures += [None] * after + [error] * times

    def score(self, request: LlmRequest) -> ScoreResponse:
        self.score_requests.append(request)
        self._fail()
        answers = [
            {"id": id, "reason": "obrolan biasa", "score": self.score_window(text)}
            for id, _, _, text in windows_in(request.prompt)
        ]
        return ScoreResponse.model_validate({"windows": answers})

    def detail(self, request: LlmRequest) -> DetailResponse:
        self.detail_requests.append(request)
        self._fail()
        return DetailResponse.model_validate({"clips": self.clips})

    def _fail(self) -> None:
        self.sent.append(time.monotonic())
        if self._failures and (error := self._failures.pop(0)):
            raise error
