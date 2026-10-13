"""The worker process behind WhisperTranscriber: one request at a time, with the model kept loaded.

A request's range is decoded with the configured ffmpeg. Silero VAD finds the speech, and silences
of 2 s or more are cut out (keeping 0.4 s either side, like faster-whisper's VAD filter), because
Whisper hallucinates in long silences. mlx-whisper transcribes the remaining speech, and the times
are mapped back onto the media's timeline. mlx is imported only here, never in the app process.
"""

import resource
import signal
import time
from bisect import bisect_right
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

import numpy as np

from app.audio import SAMPLE_RATE, SileroVad, decode
from app.transcript import Segment, Transcript, Word

VAD_MIN_SILENCE_SECS = 2.0
VAD_PAD_SECS = 0.4
VAD_MIN_SPEECH_SECS = 0.25


@dataclass(frozen=True)
class Options:
    whisper_model: str
    ffmpeg: str
    vad_model: str


@dataclass(frozen=True)
class Request:
    media: str
    language: str
    start: float
    end: float | None


@dataclass(frozen=True)
class Reply:
    transcript: Transcript | None = None
    error: str | None = None
    audio_secs: float = 0.0
    speech_secs: float = 0.0
    elapsed_secs: float = 0.0
    peak_memory: int = 0  # bytes, as MLX's allocator reports it
    max_rss: int = 0  # bytes


def serve(connection: Connection, options: Options) -> None:
    """Answer Requests with Replies until a None request, or until the app process is gone."""
    import mlx.core as mx
    import mlx_whisper
    from huggingface_hub.utils import disable_progress_bars

    signal.signal(signal.SIGINT, signal.SIG_IGN)  # Ctrl+C is for the app process to handle
    disable_progress_bars()
    vad = SileroVad(Path(options.vad_model))
    while True:
        try:
            request: Request | None = connection.recv()
        except EOFError:
            return
        if request is None:
            return
        began = time.monotonic()
        try:
            audio = decode(Path(options.ffmpeg), Path(request.media), request.start, request.end)
            speech = vad.speech(
                audio, min_silence=VAD_MIN_SILENCE_SECS, pad=VAD_PAD_SECS, min_speech=VAD_MIN_SPEECH_SECS
            )
            words: list[Word] = []
            segments: list[Segment] = []
            if speech:
                result = mlx_whisper.transcribe(
                    np.concatenate([audio[begin:end] for begin, end in speech]),
                    path_or_hf_repo=options.whisper_model,
                    language=request.language,
                    word_timestamps=True,
                    condition_on_previous_text=False,
                )
                words, segments = restore(result["segments"], speech, request.start)
            reply = Reply(
                Transcript(request.language, "whisper", words, segments),
                audio_secs=len(audio) / SAMPLE_RATE,
                speech_secs=sum(end - begin for begin, end in speech) / SAMPLE_RATE,
                elapsed_secs=time.monotonic() - began,
                peak_memory=mx.get_peak_memory(),
                max_rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            )
        except Exception as exc:
            reply = Reply(error=f"{type(exc).__name__}: {exc}")
        mx.clear_cache()
        try:
            connection.send(reply)
        except OSError:
            return


def restore(
    segments: list[dict[str, Any]], speech: list[tuple[int, int]], offset: float
) -> tuple[list[Word], list[Segment]]:
    """Words and Segments, with Whisper's times on the concatenated speech mapped back onto the media.

    Both ends of a word are placed in the speech range that holds the word's midpoint. Whisper
    splits a hyphenated word such as "main-main" into "main" and "-main"; they're joined again.
    """
    joined_starts = []  # where each speech range begins in the concatenated audio, in seconds
    total = 0
    for begin, end in speech:
        joined_starts.append(total / SAMPLE_RATE)
        total += end - begin

    def place(seconds: float, i: int) -> float:
        begin, end = speech[i][0] / SAMPLE_RATE, speech[i][1] / SAMPLE_RATE
        return round(offset + min(max(begin + float(seconds) - joined_starts[i], begin), end), 3)

    words: list[Word] = []
    lines: list[Segment] = []
    for segment in segments:
        line = []
        for word in segment.get("words", []):
            if not (text := word["word"].strip()):
                continue
            i = max(bisect_right(joined_starts, (word["start"] + word["end"]) / 2) - 1, 0)
            if line and text.startswith("-") and not word["word"][0].isspace():
                line[-1] = Word(line[-1].text + text, line[-1].start, place(word["end"], i))
            else:
                line.append(Word(text, place(word["start"], i), place(word["end"], i)))
        if line:
            words += line
            lines.append(Segment(" ".join(word.text for word in line), line[0].start, line[-1].end))
    return words, lines
