"""The Watchdog around a Transcriber: what it keeps of a call that runs past its budget."""

import threading
import time
from pathlib import Path

import pytest

from app.config import TranscriptionTuning
from app.transcriber import TranscriptionStalled, TranscriptionStopped, Watchdog
from app.transcript import Transcript

MEDIA = Path("source.mp4")


class SlowTranscriber:
    """Takes `secs[i]` for its i-th call. `stop()` stops a call still running, unless it is
    `finishing`: a Whisper worker that is past the end of its range sends its reply before it reads
    the request to exit."""

    def __init__(self, secs: list[float], finishing: bool = False) -> None:
        self.secs = secs
        self.finishing = finishing
        self.calls = 0
        self.stops = 0
        self._stopped = threading.Event()

    def transcribe(self, media: Path, language: str, start: float = 0.0, end: float | None = None) -> Transcript:
        secs = self.secs[self.calls]
        self.calls += 1
        self._stopped.clear()
        if self._stopped.wait(secs) and not self.finishing:
            raise TranscriptionStopped("stopped")
        return Transcript(language, "whisper", [], [])

    def stop(self) -> None:
        self.stops += 1
        self._stopped.set()


def watchdog(transcriber: SlowTranscriber) -> Watchdog:
    return Watchdog(transcriber, TranscriptionTuning())  # type: ignore[arg-type]


def test_a_call_that_finishes_as_it_is_stopped_keeps_its_transcript():
    transcriber = SlowTranscriber([0.3], finishing=True)

    transcript = watchdog(transcriber).transcribe(MEDIA, "id", 0, 10, budget=0.2)

    assert transcript.language == "id"
    assert transcriber.calls == 1


def test_the_retry_gets_twice_the_budget_for_its_cold_start():
    transcriber = SlowTranscriber([1.0, 0.3])

    began = time.monotonic()
    transcript = watchdog(transcriber).transcribe(MEDIA, "id", 0, 10, budget=0.2)

    assert transcript.language == "id"
    assert (transcriber.calls, transcriber.stops) == (2, 1)
    assert time.monotonic() - began < 1.0


def test_a_retry_past_its_budget_too_stalls():
    transcriber = SlowTranscriber([1.0, 1.0])

    with pytest.raises(TranscriptionStalled, match="budget 0.2 s"):
        watchdog(transcriber).transcribe(MEDIA, "id", 0, 10, budget=0.2)
    assert transcriber.calls == 2
