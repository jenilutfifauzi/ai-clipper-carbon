"""Kokoro reading on this Mac (.scratch/text-to-speech/issues/08-kokoro-engine.md, docs/adr/0019): its
English Voices, ready only with its model, Speed sent to it natively, its loaded engine kept until the
model is removed, and an English Job defaulting to it once ready (Seam A, the HTTP API). sherpa-onnx is
faked but in the real-synthesis test, which reads with the model KOKORO_TEST_MODEL points to (its
unpacked folder) and is skipped without it."""

import os
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.kokoro import KOKORO_FOLDER, KOKORO_VOICES, KokoroModel, KokoroSpeech
from app.main import create_app
from app.ports import Ports
from app.voices import SpeechError
from fakes import FakeVoiceEngine
from test_narration import ending


@dataclass
class Audio:
    samples: list[float]
    sample_rate: int


@dataclass
class FakeTts:
    """sherpa-onnx's OfflineTts as Kokoro's engine: a read is `secs / speed` of a 0.5 tone, recorded."""

    folder: Path
    sample_rate: int = 24_000
    secs: float = 1.0
    reads: list[tuple[str, int, float]] = field(default_factory=list)

    def generate(self, text: str, sid: int = 0, speed: float = 1.0) -> Audio:
        self.reads.append((text, sid, speed))
        frames = int(self.sample_rate * self.secs / speed)
        return Audio(list(0.5 * np.sin(np.arange(frames) * 0.1)), self.sample_rate)


class Loader:
    """Loads a FakeTts for a model folder, counting the loads; slowly, to show a load happens once."""

    def __init__(self, delay: float = 0.0) -> None:
        self.loaded: list[FakeTts] = []
        self.delay = delay

    def __call__(self, folder: Path) -> FakeTts:
        time.sleep(self.delay)
        tts = FakeTts(folder)
        self.loaded.append(tts)
        return tts


def install(model: KokoroModel) -> None:
    """The model's folder as an unpacked archive leaves it (its files' contents faked)."""
    model.folder.mkdir(parents=True)
    for name in ("model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt"):
        (model.folder / name).write_bytes(b"x")
    (model.folder / "espeak-ng-data").mkdir()


@pytest.fixture
def loader() -> Loader:
    return Loader()


@pytest.fixture
def model(tmp_path, loader) -> KokoroModel:
    return KokoroModel(tmp_path / "models", load=loader)


def test_kokoro_lists_only_english_voices_and_is_not_ready_without_its_model(model):
    kokoro = KokoroSpeech(model)
    assert (kokoro.id, kokoro.local, kokoro.service, kokoro.takes_style, kokoro.takes_speed) == ("kokoro", True, None, False, True)
    assert not kokoro.ready()
    voices = kokoro.voices()
    assert len(voices) == 28
    assert {voice.id[:3] for voice in voices} == {"af_", "am_", "bf_", "bm_"}
    assert {voice.language for voice in voices} == {"en"}
    by_id = {voice.id: voice for voice in voices}
    assert (by_id["af_heart"].name, by_id["af_heart"].detail) == ("Heart", "American · female")
    assert (by_id["am_michael"].name, by_id["am_michael"].detail) == ("Michael", "American · male")
    assert (by_id["bf_emma"].name, by_id["bf_emma"].detail) == ("Emma", "British · female")
    assert (by_id["bm_george"].name, by_id["bm_george"].detail) == ("George", "British · male")
    install(model)
    assert kokoro.ready()


def test_kokoro_isnt_ready_without_sherpa_onnx(tmp_path, monkeypatch):
    # The app starts without sherpa-onnx; Kokoro just can't read.
    monkeypatch.setitem(sys.modules, "sherpa_onnx", None)
    model = KokoroModel(tmp_path / "models")
    install(model)
    kokoro = KokoroSpeech(model)
    assert not kokoro.ready()
    with pytest.raises(SpeechError, match="sherpa-onnx"):
        kokoro.read("Hello.", "af_heart")


def test_a_read_goes_to_the_voices_speaker_at_its_speed_as_16_bit_pcm_at_the_engines_rate(model, loader):
    install(model)
    kokoro = KokoroSpeech(model)
    pcm = kokoro.read("Hello there.", "bm_george", style="ignored", speed=1.5)
    [tts] = loader.loaded
    assert tts.folder == model.folder
    assert tts.reads == [("Hello there.", KOKORO_VOICES["bm_george"], 1.5)]
    assert KOKORO_VOICES["af_heart"] == 3 and KOKORO_VOICES["bm_george"] == 26
    assert pcm.rate == 24_000 and pcm.samples.dtype == np.int16
    assert pcm.secs == pytest.approx(1 / 1.5, abs=1e-3)
    assert 16_000 < np.abs(pcm.samples).max() <= 16_384


def test_an_unknown_voice_or_a_missing_model_is_a_speech_error(model):
    kokoro = KokoroSpeech(model)
    with pytest.raises(SpeechError, match="download"):
        kokoro.read("Hello.", "af_heart")
    install(model)
    with pytest.raises(SpeechError, match="zf_xiaobei"):
        kokoro.read("Hello.", "zf_xiaobei")


def test_the_engine_is_loaded_once_on_first_read_and_kept_until_the_model_is_removed(tmp_path):
    loader = Loader(delay=0.1)
    model = KokoroModel(tmp_path / "models", load=loader)
    install(model)
    kokoro = KokoroSpeech(model)
    assert kokoro.ready() and loader.loaded == []
    threads = [threading.Thread(target=kokoro.read, args=("Hi.", "af_heart")) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    kokoro.read("Again.", "af_bella")
    assert len(loader.loaded) == 1 and len(loader.loaded[0].reads) == 5

    model.remove()
    assert not kokoro.ready()
    with pytest.raises(SpeechError):
        kokoro.read("Gone.", "af_heart")
    install(model)
    kokoro.read("Back.", "af_heart")
    assert len(loader.loaded) == 2 and loader.loaded[1].reads == [("Back.", 3, 1.0)]


# Seam A: through the HTTP API, Kokoro offered beside a fake cloud engine.


@pytest.fixture
def cloud() -> FakeVoiceEngine:
    return FakeVoiceEngine("fake")


@pytest.fixture
def app(settings, video_source, transcriber, llm, cloud, loader):
    model = KokoroModel(settings.data_dir / "models", load=loader)
    ports = Ports(video_source, transcriber, llm, voices=(cloud,), kokoro=model)
    with TestClient(create_app(settings, ports)) as client:
        try:
            yield client, model
        finally:
            cloud.release()
            video_source.release()
            transcriber.release()
            transcriber.stop()


def test_an_english_job_defaults_to_kokoro_once_ready_and_its_narration_is_read_on_this_mac(app, loader):
    client, model = app
    voices = client.get("/api/voices", params={"language": "en"}).json()
    kokoro = voices["engines"][-1]
    assert kokoro["id"] == "kokoro" and kokoro["ready"] is False and kokoro["takes_style"] is False
    assert {voice["language"] for voice in kokoro["voices"]} == {"en"}
    assert voices["default"] == "fake"

    install(model)
    voices = client.get("/api/voices", params={"language": "en"}).json()
    assert voices["engines"][-1]["ready"] is True
    assert voices["default"] == "kokoro"
    # An Indonesian Job keeps the cloud engine.
    assert client.get("/api/voices", params={"language": "id"}).json()["default"] == "fake"

    started = client.post("/api/narrations", json={"text": "Hello there. Bye.", "engine": "kokoro", "voice": "af_heart", "speed": 2})
    assert started.status_code == 202, started.text
    [(name, data)] = ending(client, started.json()["id"])
    assert name == "done", data
    [tts] = loader.loaded
    assert tts.reads == [("Hello there.", 3, 2.0), ("Bye.", 3, 2.0)]
    # Kokoro takes no Style.
    refused = client.post("/api/narrations", json={"text": "Hi.", "engine": "kokoro", "voice": "af_heart", "style": "warm"})
    assert refused.status_code == 422 and refused.json()["detail"] == "Kokoro takes no Style"

    assert client.delete("/api/voices/kokoro").status_code == 204
    voices = client.get("/api/voices", params={"language": "en"}).json()
    assert voices["engines"][-1]["ready"] is False and voices["default"] == "fake"
    install(model)
    started = client.post("/api/narrations", json={"text": "Again.", "engine": "kokoro", "voice": "af_heart"})
    ending(client, started.json()["id"])
    # The removal unloaded the engine: reading again loads it anew.
    assert len(loader.loaded) == 2


# Real synthesis, with the model KOKORO_TEST_MODEL points to.


@pytest.mark.skipif(not os.environ.get("KOKORO_TEST_MODEL"), reason="KOKORO_TEST_MODEL (Kokoro's unpacked model folder) isn't set")
def test_real_kokoro_reads_an_english_sentence_and_speed_2_is_shorter():
    folder = Path(os.environ["KOKORO_TEST_MODEL"])
    assert folder.name == KOKORO_FOLDER and folder.is_dir()
    kokoro = KokoroSpeech(KokoroModel(folder.parent))
    assert kokoro.ready()
    sentence = "The quick brown fox jumps over the lazy dog."
    normal = kokoro.read(sentence, "af_heart")
    fast = kokoro.read(sentence, "af_heart", speed=2.0)
    british = kokoro.read(sentence, "bm_george")
    print(f"rate {normal.rate} Hz, 1x {normal.secs:.2f} s, 2x {fast.secs:.2f} s, bm_george {british.secs:.2f} s")
    assert normal.rate == 24_000
    assert 1.0 < normal.secs < 8.0
    rms = np.sqrt(np.mean(normal.samples.astype(np.float64) ** 2)) / 32768
    assert rms > 0.01
    assert np.sqrt(np.mean(british.samples.astype(np.float64) ** 2)) / 32768 > 0.01
    assert fast.secs < normal.secs * 0.75
