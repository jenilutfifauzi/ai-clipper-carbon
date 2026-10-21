"""A Narration read by a Voice (.scratch/text-to-speech/issues/01-narration-with-gemini.md, docs/adr/0019).
Seam A: the HTTP API, MCP's dry run and the real ffmpeg, with FakeVoiceEngine (a second of tone per
sentence) in place of the cloud."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app
from app.narration import sentences
from app.ports import Ports
from app.voices import GeminiSpeech, voice_engines
from fakes import FakeVoiceEngine
from test_events import events
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import make

TONE_SECS = 1.0


@pytest.fixture
def engine() -> FakeVoiceEngine:
    return FakeVoiceEngine("fake", level=0.5)


@pytest.fixture
def quiet() -> FakeVoiceEngine:
    """A second engine, its tones 12 dB quieter."""
    return FakeVoiceEngine("quiet", level=0.5 / 4)


@pytest.fixture
def asleep() -> FakeVoiceEngine:
    """An engine that isn't ready (as Kokoro before its model is downloaded)."""
    return FakeVoiceEngine("asleep", ready=False, local=True)


@pytest.fixture
def client(settings, video_source, transcriber, llm, engine, quiet, asleep):
    """The app, its speech engines the fakes."""
    ports = Ports(video_source, transcriber, llm, voices=(engine, quiet, asleep))
    with TestClient(create_app(settings, ports)) as client:
        try:
            yield client
        finally:
            engine.release()
            video_source.release()
            transcriber.release()
            transcriber.stop()


def narrate(client, text: str, **fields):
    return client.post("/api/narrations", json={"text": text, "engine": "fake", "voice": "ana", **fields})


def outcome(client, narration_id: str) -> list[tuple[str, object]]:
    with client.stream("GET", f"/api/narrations/{narration_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        return list(events(response.iter_lines()))


def narrated(client, text: str, **fields) -> dict:
    """The Media Library item a Narration of `text` made."""
    started = narrate(client, text, **fields)
    assert started.status_code == 202, started.text
    [(name, data)] = outcome(client, started.json()["id"])
    assert name == "done", data
    return data


def samples_of(client, settings, item: dict) -> np.ndarray:
    """The item's sound, as the browser hears it: 48 kHz mono floats."""
    data = client.get(f"/api/media/{item['id']}").content
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"]
    return np.frombuffer(subprocess.run(command, input=data, capture_output=True, check=True).stdout, dtype="<f4")


def sounding(samples: np.ndarray, rate: int = 48_000) -> list[tuple[float, float]]:
    """The spans, in seconds, where the sound isn't silent (10 ms windows)."""
    window = rate // 100
    loud = [np.sqrt(np.mean(samples[i : i + window] ** 2)) > 0.01 for i in range(0, len(samples) - window + 1, window)]
    spans, start = [], None
    for i, on in enumerate([*loud, False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            spans.append((start / 100, i / 100))
            start = None
    return spans


def loudness(client, settings, item: dict, tmp_path: Path) -> float:
    path = tmp_path / f"{item['id']}.m4a"
    path.write_bytes(client.get(f"/api/media/{item['id']}").content)
    command = [str(settings.ffmpeg_bin), "-hide_banner", "-nostats", "-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    output = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    return float(json.loads(output[output.rindex("{") : output.rindex("}") + 1])["input_i"])


def test_a_three_sentence_script_becomes_one_audio_item_named_for_its_voice_with_peaks(client, engine):
    item = narrated(client, "Halo semua. Apa kabar hari ini? Terima kasih banyak!")
    assert (item["kind"], item["has_audio"]) == ("audio", True)
    assert item["name"].startswith("Narration Ana ")
    # Three seconds of tone and two pauses of 0.3 s.
    assert item["duration"] == pytest.approx(3 * TONE_SECS + 2 * 0.3, abs=0.05)
    assert [media["id"] for media in client.get("/api/media").json()] == [item["id"]]
    peaks = client.get(f"/api/media/{item['id']}/peaks/v1/0.peaks")
    assert peaks.status_code == 200 and len(peaks.content) > 6
    assert [voice for _, voice, _ in engine.reads] == ["ana"] * 3


@pytest.mark.parametrize("pauses", [0, 0.3, 1.5])
def test_the_pause_is_the_silence_between_tones_with_none_before_the_first_or_after_the_last(client, settings, pauses):
    item = narrated(client, "Satu. Dua. Tiga.", pauses=pauses)
    samples = samples_of(client, settings, item)
    spans = sounding(samples)
    if pauses == 0:
        # Back to back, the three tones are one sound.
        assert spans == [(pytest.approx(0, abs=0.02), pytest.approx(3, abs=0.03))]
    else:
        assert len(spans) == 3, spans
        gaps = [later[0] - earlier[1] for earlier, later in zip(spans, spans[1:])]
        assert gaps == [pytest.approx(pauses, abs=0.03)] * 2
        assert [end - start for start, end in spans] == [pytest.approx(TONE_SECS, abs=0.03)] * 3
    assert spans[0][0] == pytest.approx(0, abs=0.02)
    assert len(samples) / 48_000 - spans[-1][1] == pytest.approx(0, abs=0.03)


def test_the_script_is_split_at_sentence_marks_and_lines_each_read_alone_with_its_mark(client, engine):
    text = "Halo semua. Apa kabar? Seru sekali! Tunggu…\n\n\n  Baris baru tanpa titik\n...\n- -\nHarganya 3.5 juta."
    expected = ["Halo semua.", "Apa kabar?", "Seru sekali!", "Tunggu…", "Baris baru tanpa titik", "Harganya 3.5 juta."]
    assert sentences(text) == expected
    narrated(client, text, pauses=0)
    assert [read for read, _, _ in engine.reads] == expected


def test_two_engines_at_different_levels_come_out_equally_loud(client, settings, tmp_path, engine, quiet):
    first = narrated(client, "Halo semua. Apa kabar?")
    second = narrated(client, "Halo semua. Apa kabar?", engine="quiet")
    levels = [loudness(client, settings, item, tmp_path) for item in (first, second)]
    assert levels[0] == pytest.approx(-16, abs=1)
    assert levels[0] == pytest.approx(levels[1], abs=1)


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"text": "   "}, "Type a script to narrate"),
        ({"text": "a" * 5_001}, "A script can be 5,000 characters at most"),
        ({"voice": "zoe"}, "Fake fake has no Voice 'zoe'"),
        ({"engine": "nobody"}, "No speech engine 'nobody' is set up"),
        ({"engine": "asleep"}, "Fake asleep isn't ready"),
        ({"text": "... !!"}, "The script has no words to read"),
    ],
)
def test_a_script_that_cant_be_narrated_is_refused(client, engine, fields, message):
    response = client.post("/api/narrations", json={"text": "Halo.", "engine": "fake", "voice": "ana", **fields})
    assert response.status_code == 422 and message in response.json()["detail"], response.text
    assert engine.reads == [] and client.get("/api/media").json() == []


def test_a_script_of_5000_characters_is_taken(client, engine):
    engine.hold()
    started = narrate(client, ("Halo semua. " * 500)[:5_000])
    assert started.status_code == 202, started.text
    # Not read through: its first sentence fails it.
    engine.fail_with("stop")
    engine.release()
    assert outcome(client, started.json()["id"]) == [("failed", {"message": "stop"})]


def test_a_second_narration_while_one_is_being_made_is_refused_as_busy(client, engine, quiet):
    engine.hold()
    first = narrate(client, "Halo.")
    assert first.status_code == 202
    busy = client.post("/api/narrations", json={"text": "Lagi.", "engine": "quiet", "voice": "ana"})
    assert busy.status_code == 409 and "Another Narration is being made" in busy.json()["detail"]
    engine.release()
    [(name, _)] = outcome(client, first.json()["id"])
    assert name == "done"
    assert narrate(client, "Sekarang boleh.").status_code == 202


def test_a_failed_read_ends_the_stream_with_its_message_and_adds_nothing(client, engine):
    engine.fail_with("Fake refused the key")
    started = narrate(client, "Halo. Apa kabar?")
    assert outcome(client, started.json()["id"]) == [("failed", {"message": "Fake refused the key"})]
    assert client.get("/api/media").json() == []
    assert client.get("/api/narrations/nope/events").status_code == 404


def test_voices_lists_the_engines_and_the_default_for_a_jobs_language(client):
    voices = client.get("/api/voices", params={"language": "id"}).json()
    fake = voices["engines"][0]
    assert {key: fake[key] for key in ("id", "label", "service", "local", "ready", "takes_style")} == {
        "id": "fake", "label": "Fake fake", "service": "Fake", "local": False, "ready": True, "takes_style": True,
    }
    assert fake["voices"][0] == {"id": "ana", "name": "Ana", "detail": "Bright · female", "language": None}
    assert [engine["ready"] for engine in voices["engines"]] == [True, True, False]
    assert voices["default"] == "fake"


def test_gemini_tts_is_offered_with_its_key_whatever_the_llm_provider_and_not_without_it(tmp_path, monkeypatch):
    for key in ("LLM_PROVIDER", "GEMINI_API_KEY", "TTS_GEMINI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_PROVIDER=openai\nLLM_API_KEY=sk-secret\nGEMINI_API_KEY=gemini-secret\n")
    [gemini] = voice_engines(load_settings(env_file=env_file))
    assert isinstance(gemini, GeminiSpeech) and gemini.ready()
    assert (gemini.id, gemini.label, gemini.service, gemini.local, gemini.takes_style) == ("gemini", "Gemini", "Gemini", False, True)
    assert "Kore" in [voice.id for voice in gemini.voices()]
    env_file.write_text("LLM_PROVIDER=gemini\n")
    assert voice_engines(load_settings(env_file=env_file)) == []


@pytest.mark.anyio
async def test_a_narration_laid_as_speech_ducks_a_song_in_the_dry_run(mcp, client, tmp_path):
    narration = narrated(client, "Halo semua.")
    song_file = tmp_path / "song.wav"
    make(song_file, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    song = await call(mcp, "add_asset", kind="media", path=str(song_file))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    # The episode Muted, so that its Words aren't speech: only the Narration's span is.
    segments = [{"id": "e", "start": candidate["start"], "end": candidate["end"], "muted": True}]
    music = [
        {"id": "m", "media": song["id"], "start": 0.0, "secs": 1.5, "duck": -12},
        {"id": "n", "media": narration["id"], "start": 0.4, "secs": 0.6, "speech": True},
    ]
    await call(mcp, "edit_candidate", **ids, changes={"segments": segments})
    plan = await call(mcp, "edit_candidate", **ids, changes={"music": music}, dry_run=True)
    sounds = {sound["id"]: sound for sound in plan["sounds"]}
    assert sounds["n"].get("speech") is True and "duck" not in sounds["n"]
    assert sounds["m"]["speech_spans"] == [[0.4, 1.0]]
