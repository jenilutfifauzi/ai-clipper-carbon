"""The Transcriber port, the watchdog that guards any Transcriber, and the mlx-whisper implementation."""

import logging
import multiprocessing
import threading
from concurrent.futures import Future
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import Protocol

from app import whisper_worker
from app.config import SILERO_VAD_MODEL, Settings, TranscriptionTuning
from app.transcript import Transcript

logger = logging.getLogger(__name__)

# How long the watchdog waits for a stopped call to unwind before retrying.
_STOP_GRACE_SECS = 10
# How long an asked-to-exit Whisper worker gets before it is killed.
_EXIT_GRACE_SECS = 3


class Transcriber(Protocol):
    def transcribe(self, media: Path, language: str, start: float = 0.0, end: float | None = None) -> Transcript:
        """A `source = whisper` Transcript of `media` from `start` to `end` seconds (or its end).

        Words and Segments are on the media's timeline: the range's offset is already applied.
        """
        ...

    def stop(self) -> None:
        """Abort a `transcribe` running on another thread (it raises `TranscriptionStopped`) and
        free the model's memory. The next `transcribe` starts afresh.
        """
        ...


class TranscriptionStopped(RuntimeError):
    pass


class TranscriptionStalled(RuntimeError):
    """A range ran past its time budget twice, so the watchdog gave up on it."""


class Watchdog:
    """Runs any Transcriber with a time budget per call, derived from the range's duration.

    A call past its budget is stopped and retried once. If the retry runs out too,
    `TranscriptionStalled` is raised, and the caller skips the range.
    """

    def __init__(self, transcriber: Transcriber, tuning: TranscriptionTuning) -> None:
        self.transcriber = transcriber
        self.tuning = tuning

    def transcribe(self, media: Path, language: str, start: float, end: float, budget: float | None = None) -> Transcript:
        """The range transcribed within `budget` seconds, by default the tuning's for its duration."""
        if budget is None:
            budget = self.tuning.budget_secs + self.tuning.budget_factor * (end - start)
        span = f"{clock(start)}–{clock(end)}"
        for attempt in range(2):
            transcript = self._within(budget, media, language, start, end)
            if transcript is not None:
                return transcript
            retrying = "; retrying" if not attempt else ""
            logger.warning("Transcribing %s ran past its %.1f s budget%s", span, budget, retrying)
        raise TranscriptionStalled(f"Skipped {span}: transcription stalled twice (budget {budget:.1f} s)")

    def _within(self, budget: float, media: Path, language: str, start: float, end: float) -> Transcript | None:
        outcome: Future[Transcript] = Future()

        def run() -> None:
            try:
                outcome.set_result(self.transcriber.transcribe(media, language, start, end))
            except BaseException as exc:
                outcome.set_exception(exc)

        thread = threading.Thread(target=run, name="transcribe", daemon=True)
        thread.start()
        thread.join(budget)
        if not thread.is_alive():
            return outcome.result()
        self.transcriber.stop()
        thread.join(_STOP_GRACE_SECS)
        return None


def clock(seconds: float) -> str:
    whole = int(seconds)
    return f"{whole // 3600}:{whole // 60 % 60:02}:{whole % 60:02}"


@dataclass
class _Worker:
    process: BaseProcess
    connection: Connection


class WhisperTranscriber:
    """mlx-whisper in a worker process that keeps the model loaded between calls.

    A stuck MLX computation can't be interrupted from another thread, so `stop()` asks the
    worker process to exit and kills it if it's still busy. Either way the model's ~2 GB are
    released, which is also how a stage hands the memory back when it's done. The worker is
    spawned, so a script that uses this needs an `if __name__ == "__main__":` guard.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._worker: _Worker | None = None

    def transcribe(self, media: Path, language: str, start: float = 0.0, end: float | None = None) -> Transcript:
        worker = self._running_worker()
        try:
            worker.connection.send(whisper_worker.Request(str(media), language, start, end))
            reply: whisper_worker.Reply = worker.connection.recv()
        except (EOFError, OSError) as exc:
            # Only this thread reads the connection, so only it may close it (stop() never does).
            worker.connection.close()
            with self._lock:
                if self._worker is worker:
                    self._worker = None
            worker.process.join(5)
            raise TranscriptionStopped(f"The Whisper worker stopped (exit code {worker.process.exitcode})") from exc
        if reply.error is not None:
            raise RuntimeError(f"Whisper failed: {reply.error}")
        assert reply.transcript is not None
        logger.info(
            "Whisper: %.1f s of audio from %.1f s (%.1f s of speech) in %.1f s, %.2fx realtime; "
            "peak MLX memory %.2f GB, worker max RSS %.2f GB",
            reply.audio_secs, start, reply.speech_secs, reply.elapsed_secs,
            reply.audio_secs / max(reply.elapsed_secs, 1e-6), reply.peak_memory / 1e9, reply.max_rss / 1e9,
        )
        return reply.transcript

    def stop(self) -> None:
        with self._lock:
            worker, self._worker = self._worker, None
        if worker is None:
            return
        try:
            worker.connection.send(None)  # an idle worker exits on this; a busy one never reads it
        except OSError:
            pass
        worker.process.join(_EXIT_GRACE_SECS)
        if worker.process.is_alive():
            worker.process.kill()
            worker.process.join()

    def _running_worker(self) -> _Worker:
        with self._lock:
            if self._worker is None or not self._worker.process.is_alive():
                context = multiprocessing.get_context("spawn")
                connection, child = context.Pipe()
                options = whisper_worker.Options(
                    self.settings.whisper_model, str(self.settings.ffmpeg_bin), str(SILERO_VAD_MODEL)
                )
                process = context.Process(
                    target=whisper_worker.serve, args=(child, options), name="whisper", daemon=True
                )
                process.start()
                child.close()  # so the parent's reads see EOF when the worker dies
                self._worker = _Worker(process, connection)
            return self._worker
