import subprocess
import wave
from pathlib import Path

import mlx_whisper
import numpy as np
import pytest

from app.config import load_settings

SENTENCE = "The quick brown fox jumps over the lazy dog."


def speak(text: str, path: Path) -> None:
    subprocess.run(
        ["say", "-v", "Samantha", "-o", str(path), "--file-format=WAVE", "--data-format=LEI16@16000", text],
        check=True,
    )


def read_pcm16(path: Path) -> np.ndarray:
    with wave.open(str(path)) as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (16000, 1, 2)
        frames = wav.readframes(wav.getnframes())
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768


@pytest.mark.whisper
def test_transcribes_speech_with_word_timestamps(tmp_path):
    wav_path = tmp_path / "speech.wav"
    speak(SENTENCE, wav_path)

    # Samples rather than a path, so mlx-whisper doesn't run whatever `ffmpeg` is on PATH.
    result = mlx_whisper.transcribe(
        read_pcm16(wav_path),
        path_or_hf_repo=load_settings().whisper_model,
        language="en",
        word_timestamps=True,
        condition_on_previous_text=False,
    )

    words = [word for segment in result["segments"] for word in segment["words"]]
    text = "".join(word["word"] for word in words).lower()
    assert "fox" in text and "lazy dog" in text
    assert all(0 <= word["start"] <= word["end"] for word in words)
    assert [word["start"] for word in words] == sorted(word["start"] for word in words)
    assert words[-1]["end"] > words[0]["start"]
