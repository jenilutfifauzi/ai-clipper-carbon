import multiprocessing
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

from app.config import TranscriptionTuning, load_settings
from app.transcriber import TranscriptionStalled, Watchdog, WhisperTranscriber

# The speech is made with the Mac's `say`, and the model compared with is mlx-whisper.
if sys.platform != "darwin":
    pytest.skip("needs macOS: `say` and mlx-whisper", allow_module_level=True)

import mlx_whisper  # noqa: E402

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


@pytest.fixture
def two_sentences(tmp_path) -> tuple[Path, float]:
    """2 s of silence, the sentence, 3 s of silence, the sentence again. Returns the path and the
    distance between the two sentences' starts."""
    speak(SENTENCE, tmp_path / "sentence.wav")
    sentence = read_pcm16(tmp_path / "sentence.wav")
    silence = np.zeros(16000, dtype=np.float32)
    audio = np.concatenate([silence, silence, sentence, silence, silence, silence, sentence, silence])
    path = tmp_path / "two-sentences.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((audio * 32767).astype("<i2").tobytes())
    return path, len(sentence) / 16000 + 3


@pytest.mark.whisper
def test_whisper_transcriber_returns_words_on_the_source_timeline(two_sentences):
    path, sentence_distance = two_sentences
    transcriber = WhisperTranscriber(load_settings())
    try:
        transcript = transcriber.transcribe(path, "en", start=1.0)
    finally:
        transcriber.stop()

    assert (transcript.language, transcript.source) == ("en", "whisper")
    text = " ".join(word.text for word in transcript.words).lower()
    assert text.count("fox") == 2 and text.count("lazy") == 2
    # On the file's timeline, not the range's: the first sentence starts 2 s into the file.
    assert transcript.words[0].start == pytest.approx(2.0, abs=0.5)
    # VAD cut most of the 3 s pause before Whisper heard it; the times put it back.
    foxes = [word for word in transcript.words if "fox" in word.text.lower()]
    assert foxes[1].start - foxes[0].start == pytest.approx(sentence_distance, abs=0.3)
    assert all(1.0 <= word.start <= word.end for word in transcript.words)
    assert " ".join(segment.text for segment in transcript.segments) == " ".join(w.text for w in transcript.words)
    assert not multiprocessing.active_children()


@pytest.mark.whisper
def test_watchdog_kills_a_worker_past_its_budget_and_a_new_worker_succeeds(two_sentences):
    path, _ = two_sentences
    transcriber = WhisperTranscriber(load_settings())
    try:
        # Too short to even load the model: both attempts are killed.
        with pytest.raises(TranscriptionStalled, match="stalled twice"):
            Watchdog(transcriber, TranscriptionTuning(budget_secs=1, budget_factor=0)).transcribe(path, "en", 0, 11)
        assert not multiprocessing.active_children()

        transcript = Watchdog(transcriber, TranscriptionTuning()).transcribe(path, "en", 0, 11)
        assert "fox" in " ".join(word.text for word in transcript.words).lower()
    finally:
        transcriber.stop()
    assert not multiprocessing.active_children()


# Last: mlx-whisper keeps this model loaded in the test process, next to any worker's copy.
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
