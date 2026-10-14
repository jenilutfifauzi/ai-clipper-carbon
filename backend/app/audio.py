"""Audio for transcription: decoding with the configured ffmpeg, Silero voice activity detection,
and cutting a long Source into chunks at pauses. Also the Windows' audio that audio-signal mode
sends to the Detail pass."""

import subprocess
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import onnxruntime

from app.config import SILERO_VAD_MODEL

SAMPLE_RATE = 16_000
_WINDOW = 512  # samples per Silero step at 16 kHz (32 ms)
_CONTEXT = 64  # samples of the previous window that Silero expects in front of each step

# A chunk ends in the middle of a pause at least this long.
MIN_PAUSE_SECS = 0.3

# A Window's audio for the Detail pass: mono Opus in Ogg, which Gemini reads as audio/ogg.
WINDOW_AUDIO_MIME_TYPE = "audio/ogg"


def decode(ffmpeg: Path, media: Path, start: float = 0.0, end: float | None = None) -> np.ndarray:
    """The first audio stream of `media` from `start` to `end` seconds (or its end), as 16 kHz mono float32."""
    command = [str(ffmpeg), "-nostdin", "-v", "error", "-ss", f"{start:.3f}"]
    if end is not None:
        command += ["-t", f"{max(end - start, 0):.3f}"]
    command += ["-i", str(media), "-map", "0:a:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    result = subprocess.run(command, capture_output=True)
    if result.returncode:
        stderr = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"ffmpeg couldn't decode the audio of {media.name}: {stderr}")
    return np.frombuffer(result.stdout, dtype="<f4")


def window_audio(ffmpeg: Path, media: Path, start: float, end: float, cache: Path, bitrate: str, rate: int) -> bytes:
    """The first audio stream of `media` from `start` to `end` seconds as mono Ogg Opus at `bitrate`
    and `rate` Hz (WINDOW_AUDIO_MIME_TYPE). Each range is encoded once and kept in `cache`."""
    path = cache / f"{round(1000 * start)}-{round(1000 * end)}.{bitrate}.{rate}.ogg"
    if path.is_file():
        return path.read_bytes()
    cache.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.part")
    command = [
        str(ffmpeg), "-nostdin", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{max(end - start, 0):.3f}",
        "-i", str(media), "-map", "0:a:0", "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", str(rate),
        "-c:a", "libopus", "-b:a", bitrate, "-f", "ogg", str(partial),
    ]
    result = subprocess.run(command, capture_output=True)
    if result.returncode:
        partial.unlink(missing_ok=True)
        stderr = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"ffmpeg couldn't extract the audio of {media.name} from {start:g} to {end:g} s: {stderr}")
    partial.replace(path)
    return path.read_bytes()


class SileroVad:
    """Silero VAD through onnxruntime, on one CPU thread."""

    def __init__(self, model: Path = SILERO_VAD_MODEL) -> None:
        options = onnxruntime.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        self._session = onnxruntime.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])

    def probabilities(self, audio: np.ndarray) -> np.ndarray:
        """The speech probability of each 32 ms window of 16 kHz `audio`."""
        windows = -(-len(audio) // _WINDOW)
        padded = np.zeros(_CONTEXT + windows * _WINDOW, dtype=np.float32)
        padded[_CONTEXT : _CONTEXT + len(audio)] = audio
        state = np.zeros((2, 1, 128), dtype=np.float32)
        rate = np.array(SAMPLE_RATE, dtype=np.int64)
        probabilities = np.empty(windows, dtype=np.float32)
        for i in range(windows):
            frame = padded[i * _WINDOW : (i + 1) * _WINDOW + _CONTEXT][None]
            output, state = self._session.run(None, {"input": frame, "state": state, "sr": rate})
            probabilities[i] = output[0, 0]
        return probabilities

    def speech(
        self,
        audio: np.ndarray,
        *,
        min_silence: float,
        pad: float = 0.0,
        min_speech: float = 0.0,
        threshold: float = 0.5,
    ) -> list[tuple[int, int]]:
        """Speech in `audio` as (start, end) sample ranges, following Silero's `get_speech_timestamps`.

        Pauses shorter than `min_silence` seconds stay inside a range. Ranges shorter than
        `min_speech` are dropped; the rest are widened by `pad` seconds and merged where they meet.
        """
        quiet = max(threshold - 0.15, 0.01)
        min_silence_windows = min_silence * SAMPLE_RATE / _WINDOW
        found: list[tuple[int, int]] = []  # in windows
        start = silence = None
        for i, probability in enumerate(self.probabilities(audio)):
            if probability >= threshold:
                silence = None
                if start is None:
                    start = i
            elif probability < quiet and start is not None:
                if silence is None:
                    silence = i
                if i - silence >= min_silence_windows:
                    found.append((start, silence))
                    start = silence = None
        if start is not None:
            found.append((start, silence if silence is not None else -(-len(audio) // _WINDOW)))

        pad_samples = round(pad * SAMPLE_RATE)
        ranges: list[tuple[int, int]] = []
        for first, last in found:
            begin, end = first * _WINDOW, min(last * _WINDOW, len(audio))
            if end - begin < min_speech * SAMPLE_RATE:
                continue
            begin, end = max(begin - pad_samples, 0), min(end + pad_samples, len(audio))
            if ranges and begin <= ranges[-1][1]:
                ranges[-1] = (ranges[-1][0], end)
            else:
                ranges.append((begin, end))
        return ranges


def chunks(
    ffmpeg: Path, media: Path, duration: float, vad: SileroVad, chunk_secs: float, search_secs: float
) -> Iterator[tuple[float, float]]:
    """Consecutive (start, end) ranges covering [0, duration], each about `chunk_secs` long.

    Every cut is placed in a pause, so no word is split between two chunks. Cuts are found
    lazily, decoding only the audio within `search_secs` of each one.
    """
    start = 0.0
    while duration - start > chunk_secs + search_secs:
        end = pause_near(ffmpeg, media, vad, start + chunk_secs, search_secs)
        yield start, end
        start = end
    yield start, duration


def pause_near(ffmpeg: Path, media: Path, vad: SileroVad, target: float, search_secs: float) -> float:
    """The middle of the pause nearest to `target` seconds, or `target` itself when there's no pause nearby."""
    offset = max(target - search_secs, 0.0)
    audio = decode(ffmpeg, media, offset, target + search_secs)
    edges = [0, *(edge for speech in vad.speech(audio, min_silence=MIN_PAUSE_SECS) for edge in speech), len(audio)]
    middles = [
        offset + (begin + end) / 2 / SAMPLE_RATE
        for begin, end in zip(edges[::2], edges[1::2])
        if end - begin >= MIN_PAUSE_SECS * SAMPLE_RATE
    ]
    return round(min(middles, key=lambda middle: abs(middle - target), default=target), 3)
