"""A Narration read by a Voice (.scratch/text-to-speech/issues/01-narration-with-gemini.md and
02-progress-cancel-and-failures.md, 04-speed-style-and-estimate.md, 06-voice-samples.md,
09-mcp-generate-speech.md, docs/adr/0019).
Seam A: the HTTP API, MCP's dry run and the real ffmpeg, with FakeVoiceEngine (a second of tone per
sentence) in place of the cloud."""

import json
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app
from app import narration
from app.narration import sentences
from app.ports import Ports
from app.voices import GeminiSpeech, OpenAiSpeech, voice_engines
from fakes import FakeVoiceEngine
from test_events import events
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
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
def native() -> FakeVoiceEngine:
    """An engine that takes a Speed of its own (as OpenAI's) and no Style (as tts-1)."""
    return FakeVoiceEngine("native", takes_style=False, takes_speed=True)


@pytest.fixture
def client(settings, video_source, transcriber, llm, engine, quiet, asleep, native):
    """The app, its speech engines the fakes."""
    ports = Ports(video_source, transcriber, llm, voices=(engine, quiet, asleep, native))
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


def ending(client, narration_id: str) -> list[tuple[str, object]]:
    """The Narration's events but its progress: its outcome."""
    return [(name, data) for name, data in outcome(client, narration_id) if name != "progress"]


def narrated(client, text: str, **fields) -> dict:
    """The Media Library item a Narration of `text` made."""
    started = narrate(client, text, **fields)
    assert started.status_code == 202, started.text
    [(name, data)] = ending(client, started.json()["id"])
    assert name == "done", data
    return data


def until(condition, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


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
        ({"engine": "native", "style": "warm, unhurried"}, "Fake native takes no Style"),
    ],
)
def test_a_script_that_cant_be_narrated_is_refused(client, engine, fields, message):
    response = client.post("/api/narrations", json={"text": "Halo.", "engine": "fake", "voice": "ana", **fields})
    assert response.status_code == 422 and message in response.json()["detail"], response.text
    assert engine.reads == [] and client.get("/api/media").json() == []


@pytest.mark.parametrize("speed", [0.49, 2.01, 0])
def test_a_speed_outside_half_to_twice_is_refused(client, engine, speed):
    response = narrate(client, "Halo.", speed=speed)
    assert response.status_code == 422, response.text
    assert engine.reads == [] and client.get("/api/media").json() == []


def pitch(samples: np.ndarray, rate: int = 48_000) -> float:
    """The loudest frequency of the sound, in Hz."""
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    return float(np.fft.rfftfreq(len(samples), 1 / rate)[np.argmax(spectrum)])


@pytest.mark.parametrize("speed", [2, 0.5])
def test_an_engine_without_a_speed_is_retimed_its_pitch_kept_and_the_pauses_their_length(client, settings, engine, speed):
    item = narrated(client, "Satu. Dua. Tiga.", speed=speed)
    # Each tone 1/speed long; the two pauses of 0.3 s untouched.
    assert item["duration"] == pytest.approx(3 * TONE_SECS / speed + 2 * 0.3, abs=0.06)
    samples = samples_of(client, settings, item)
    spans = sounding(samples)
    assert [end - start for start, end in spans] == [pytest.approx(TONE_SECS / speed, abs=0.04)] * 3
    start, end = spans[0]
    assert pitch(samples[int(start * 48_000) : int(end * 48_000)]) == pytest.approx(660, abs=5)
    # Read at 1×: the engine is never asked a Speed.
    assert engine.speeds == [1.0] * 3


def test_an_engine_with_a_speed_reads_at_it_and_is_not_retimed(client, settings, native):
    item = narrated(client, "Satu. Dua.", engine="native", speed=2)
    assert native.speeds == [2.0, 2.0]
    # Its tones, read in half a second, kept so: not halved again.
    assert item["duration"] == pytest.approx(2 * TONE_SECS / 2 + 0.3, abs=0.06)


def test_the_style_is_sent_with_each_sentence_and_a_blank_one_is_none(client, engine, native):
    narrated(client, "Satu. Dua.", style="  warm, unhurried ")
    assert [style for _, _, style in engine.reads] == ["warm, unhurried"] * 2
    # A blank Style is none, so an engine that takes none takes it.
    narrated(client, "Satu.", engine="native", style="  ")
    assert [style for _, _, style in native.reads] == [None]


def test_a_script_of_5000_characters_is_taken(client, engine):
    engine.hold()
    started = narrate(client, ("Halo semua. " * 500)[:5_000])
    assert started.status_code == 202, started.text
    # Not read through: its first sentence fails it.
    engine.fail_with("stop")
    engine.release()
    assert ending(client, started.json()["id"]) == [("failed", {"message": "stop"})]


def test_a_second_narration_while_one_is_being_made_is_refused_as_busy(client, engine, quiet):
    engine.hold()
    first = narrate(client, "Halo.")
    assert first.status_code == 202
    busy = client.post("/api/narrations", json={"text": "Lagi.", "engine": "quiet", "voice": "ana"})
    assert busy.status_code == 409 and "Another Narration is being made" in busy.json()["detail"]
    engine.release()
    [(name, _)] = ending(client, first.json()["id"])
    assert name == "done"
    assert narrate(client, "Sekarang boleh.").status_code == 202


def test_a_failed_read_ends_the_stream_with_its_message_and_adds_nothing(client, engine):
    engine.fail_with("Fake refused the key")
    started = narrate(client, "Halo. Apa kabar?")
    assert ending(client, started.json()["id"]) == [("failed", {"message": "Fake refused the key"})]
    assert client.get("/api/media").json() == []
    assert client.get("/api/narrations/nope/events").status_code == 404


def test_voices_lists_the_engines_and_the_default_for_a_jobs_language(client):
    voices = client.get("/api/voices", params={"language": "id"}).json()
    fake = voices["engines"][0]
    assert {key: fake[key] for key in ("id", "label", "service", "local", "ready", "takes_style")} == {
        "id": "fake", "label": "Fake fake", "service": "Fake", "local": False, "ready": True, "takes_style": True,
    }
    assert fake["voices"][0] == {"id": "ana", "name": "Ana", "detail": "Bright · female", "language": None}
    assert [engine["ready"] for engine in voices["engines"]] == [True, True, False, True]
    assert [engine["takes_style"] for engine in voices["engines"]] == [True, True, True, False]
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


@pytest.mark.parametrize(
    ("engines", "language", "default"),
    [
        # Indonesian: the first ready cloud engine, even with a local one ready.
        (("gemini", "openai", "local"), "id", "gemini"),
        (("asleep-cloud", "openai", "local"), "id", "openai"),
        # English: a ready local engine first, else the first ready cloud one.
        (("gemini", "openai", "local"), "en", "local"),
        (("gemini", "openai", "asleep-local"), "en", "gemini"),
        (("asleep-local",), "en", None),
    ],
)
def test_the_default_engine_follows_the_jobs_language(settings, video_source, transcriber, llm, engines, language, default):
    fakes = {
        "gemini": FakeVoiceEngine("gemini"),
        "openai": FakeVoiceEngine("openai"),
        "local": FakeVoiceEngine("local", local=True),
        "asleep-cloud": FakeVoiceEngine("asleep-cloud", ready=False),
        "asleep-local": FakeVoiceEngine("asleep-local", ready=False, local=True),
    }
    ports = Ports(video_source, transcriber, llm, voices=tuple(fakes[id] for id in engines))
    with TestClient(create_app(settings, ports)) as client:
        assert client.get("/api/voices", params={"language": language}).json()["default"] == default


TTS = ("TTS_BASE_URL", "TTS_API_KEY", "TTS_MODEL", "TTS_VOICES")


@pytest.mark.parametrize("missing", ["TTS_BASE_URL", "TTS_API_KEY", "TTS_MODEL"])
def test_openai_compatible_speech_is_offered_only_with_its_three_settings(tmp_path, monkeypatch, missing):
    for key in ("LLM_PROVIDER", "GEMINI_API_KEY", *TTS):
        monkeypatch.delenv(key, raising=False)
    env_file = tmp_path / ".env"
    complete = {"TTS_BASE_URL": "https://api.openai.com/v1", "TTS_API_KEY": "sk-speech", "TTS_MODEL": "gpt-4o-mini-tts"}
    env_file.write_text("".join(f"{key}={value}\n" for key, value in complete.items()) + "GEMINI_API_KEY=gemini-secret\n")
    gemini, openai = voice_engines(load_settings(env_file=env_file))
    assert isinstance(gemini, GeminiSpeech) and isinstance(openai, OpenAiSpeech) and openai.ready()
    assert (openai.id, openai.service, openai.local) == ("openai", "OpenAI", False)

    env_file.write_text("".join(f"{key}={value}\n" for key, value in complete.items() if key != missing))
    assert voice_engines(load_settings(env_file=env_file)) == []


def test_tts_voices_replaces_the_openai_compatible_voice_list(tmp_path, monkeypatch):
    for key in ("GEMINI_API_KEY", *TTS):
        monkeypatch.delenv(key, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("TTS_BASE_URL=http://localhost:8880/v1\nTTS_API_KEY=none\nTTS_MODEL=kokoro\nTTS_VOICES=af_bella,am_adam\n")
    [openai] = voice_engines(load_settings(env_file=env_file))
    assert [voice.id for voice in openai.voices()] == ["af_bella", "am_adam"]
    assert openai.service == "localhost"


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


def test_the_events_stream_tells_the_stages_and_each_sentence_read_then_done(client):
    started = narrate(client, "Satu. Dua. Tiga.")
    told = outcome(client, started.json()["id"])
    assert [(name, data) for name, data in told if name == "progress"] == [
        ("progress", {"stage": "Loading the voice", "done": 0, "of": 3}),
        ("progress", {"stage": "Reading", "done": 0, "of": 3}),
        ("progress", {"stage": "Reading", "done": 1, "of": 3}),
        ("progress", {"stage": "Reading", "done": 2, "of": 3}),
        ("progress", {"stage": "Reading", "done": 3, "of": 3}),
        ("progress", {"stage": "Levelling", "done": 3, "of": 3}),
        ("progress", {"stage": "Saving", "done": 3, "of": 3}),
    ]
    name, item = told[-1]
    assert name == "done" and item["name"].startswith("Narration Ana ")


def test_a_cancel_mid_way_stops_before_the_next_sentence_and_leaves_no_item_nor_file(client, engine, settings):
    # The first sentence is read, the second held while the cancel comes.
    engine.hold(after=1)
    started = narrate(client, "Satu. Dua. Tiga. Empat.")
    narration_id = started.json()["id"]
    until(lambda: len(engine.reads) == 2)
    assert client.delete(f"/api/narrations/{narration_id}").status_code == 204
    engine.release()
    assert ending(client, narration_id) == [("cancelled", {})]
    assert [read for read, _, _ in engine.reads] == ["Satu.", "Dua."]
    assert client.get("/api/media").json() == []
    until(lambda: not any((settings.data_dir / narration.NARRATIONS_DIR).iterdir()))
    assert not [path for path in (settings.data_dir / "media").rglob("*") if path.is_file()]
    # The runner is free again; a finished one can't be cancelled, an unknown one isn't found.
    second = narrate(client, "Lagi.")
    assert second.status_code == 202
    ending(client, second.json()["id"])
    assert client.delete(f"/api/narrations/{second.json()['id']}").status_code == 409
    assert client.delete("/api/narrations/nope").status_code == 404


def test_a_transient_failure_on_a_sentence_is_retried_once_and_succeeds(client, engine):
    engine.fail_with("Fake is busy (429)", times=1, after=1, transient=True, retry_after=0.0)
    item = narrated(client, "Satu. Dua. Tiga.")
    assert [read for read, _, _ in engine.reads] == ["Satu.", "Dua.", "Dua.", "Tiga."]
    assert item["duration"] == pytest.approx(3 * TONE_SECS + 2 * 0.3, abs=0.05)


def test_without_a_retry_after_the_retry_comes_after_a_short_fixed_wait(client, engine, monkeypatch):
    monkeypatch.setattr(narration, "RETRY_WAIT_SECS", 0.2)
    engine.fail_with("Fake is busy (503)", times=1, transient=True, retry_after=None)
    began = time.monotonic()
    narrated(client, "Satu.")
    assert time.monotonic() - began >= 0.2
    assert len(engine.reads) == 2


@pytest.mark.parametrize(
    ("failure", "reads"),
    [
        ({"times": 2, "transient": True}, ["Satu.", "Dua.", "Dua."]),
        ({"times": 1, "transient": False}, ["Satu.", "Dua."]),
    ],
)
def test_a_second_failure_or_a_lasting_one_fails_with_the_engines_message_and_leaves_nothing(client, engine, settings, failure, reads):
    engine.fail_with("Fake TTS failed (500): boom", after=1, retry_after=0.0, **failure)
    started = narrate(client, "Satu. Dua. Tiga.")
    assert ending(client, started.json()["id"]) == [("failed", {"message": "Fake TTS failed (500): boom"})]
    assert [read for read, _, _ in engine.reads] == reads
    assert client.get("/api/media").json() == []
    until(lambda: not any((settings.data_dir / narration.NARRATIONS_DIR).iterdir()))


def test_a_narration_whose_stream_nobody_reads_still_adds_its_item(client):
    started = narrate(client, "Halo semua. Apa kabar?")
    assert started.status_code == 202
    until(lambda: len(client.get("/api/media").json()) == 1)
    [item] = client.get("/api/media").json()
    assert item["name"].startswith("Narration Ana ")
    # Opened late, its stream still tells it.
    [(name, told)] = ending(client, started.json()["id"])
    assert (name, told["id"]) == ("done", item["id"])


def sample(client, voice: str = "ana", lang: str | None = "id", engine: str = "fake"):
    return client.get(f"/api/voices/{engine}/{voice}/sample", params={} if lang is None else {"lang": lang})


def test_the_first_sample_reads_the_languages_sentence_once_and_the_second_is_kept(client, settings, tmp_path, engine):
    first = sample(client)
    assert first.status_code == 200, first.text
    assert first.headers["content-type"] == "audio/wav"
    # Read at 1× and with no Style, one sentence at a time, in Indonesian.
    assert engine.reads == [(sentence, "ana", None) for sentence in sentences(narration.SAMPLE_TEXTS["id"])]
    assert set(engine.speeds) == {1.0}
    path = tmp_path / "sample.wav"
    path.write_bytes(first.content)
    # Levelled as a Narration is.
    command = [str(settings.ffmpeg_bin), "-hide_banner", "-nostats", "-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    output = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    assert float(json.loads(output[output.rindex("{") : output.rindex("}") + 1])["input_i"]) == pytest.approx(narration.LUFS, abs=1.5)
    reads = len(engine.reads)
    second = sample(client)
    assert second.status_code == 200 and second.content == first.content
    assert len(engine.reads) == reads
    assert list((settings.data_dir / narration.VOICE_SAMPLES_DIR).rglob("*.wav"))
    # Nothing was added to the Media Library.
    assert client.get("/api/media").json() == []


def test_a_different_language_or_voice_makes_a_new_sample_and_a_language_without_a_sentence_reads_english(client, engine):
    assert sample(client, lang="id").status_code == 200
    assert sample(client, lang="en").status_code == 200
    assert sample(client, voice="budi", lang="id").status_code == 200
    english = sentences(narration.SAMPLE_TEXTS["en"])
    indonesian = sentences(narration.SAMPLE_TEXTS["id"])
    assert engine.reads == [
        *[(s, "ana", None) for s in indonesian],
        *[(s, "ana", None) for s in english],
        *[(s, "budi", None) for s in indonesian],
    ]
    reads = len(engine.reads)
    # French has no sentence of its own: the English sample, kept already.
    assert sample(client, lang="fr").status_code == 200
    assert sample(client, lang=None).status_code == 200
    assert len(engine.reads) == reads


def test_a_sample_while_a_narration_is_being_made_is_busy_and_a_narration_while_a_sample_is_read_too(client, engine):
    engine.hold()
    first = narrate(client, "Halo.")
    assert first.status_code == 202
    busy = sample(client)
    assert busy.status_code == 409 and "A Narration is being made" in busy.json()["detail"]
    engine.release()
    [(name, _)] = ending(client, first.json()["id"])
    assert name == "done"

    engine.hold(after=len(engine.reads))
    reads = len(engine.reads)
    answer = {}
    reading = threading.Thread(target=lambda: answer.update(response=sample(client, voice="budi")))
    reading.start()
    until(lambda: len(engine.reads) > reads)
    assert narrate(client, "Lagi.").status_code == 409
    engine.release()
    reading.join(timeout=10)
    assert answer["response"].status_code == 200


@pytest.mark.parametrize(
    ("engine_id", "voice", "message"),
    [("asleep", "ana", "isn't ready"), ("fake", "nobody", "has no Voice"), ("nope", "ana", "No speech engine")],
)
def test_a_sample_for_an_engine_that_isnt_ready_or_an_unknown_voice_is_refused(client, engine, engine_id, voice, message):
    refused = sample(client, voice=voice, engine=engine_id)
    assert refused.status_code == 422 and message in refused.json()["detail"]
    assert engine.reads == []


def test_a_failed_sample_is_502_with_the_engines_message_and_nothing_is_kept(client, settings, engine):
    engine.fail_with("Fake ran out of quota")
    failed = sample(client)
    assert failed.status_code == 502 and "Fake ran out of quota" in failed.json()["detail"]
    assert not list((settings.data_dir / narration.VOICE_SAMPLES_DIR).rglob("*.wav"))
    engine.fail_with(None)
    assert sample(client).status_code == 200


# 09: Narrations through MCP


@pytest.mark.anyio
async def test_list_assets_voices_lists_the_ready_engines_their_voices_and_the_default(mcp):
    listed = await call(mcp, "list_assets", kind="voices")
    assert set(listed) == {"voices"}
    voices = listed["voices"]
    assert set(voices) == {"engines", "default"}
    assert [engine["id"] for engine in voices["engines"]] == ["fake", "quiet", "native"]
    assert voices["engines"][0] == {
        "id": "fake", "label": "Fake fake", "service": "Fake", "local": False, "takes_style": True,
        "voices": [
            {"id": "ana", "name": "Ana", "detail": "Bright · female", "language": None},
            {"id": "budi", "name": "Budi", "detail": "Calm · male", "language": None},
        ],
    }
    assert voices["engines"][2]["takes_style"] is False
    assert voices["default"] == "fake"
    assert (await call(mcp, "list_assets", kind="voices", language="en"))["voices"]["default"] == "fake"


@pytest.mark.anyio
async def test_generate_speech_returns_the_items_id_name_and_duration_and_it_is_in_the_media_library(mcp, engine):
    made = await call(mcp, "generate_speech", text="Halo semua. Apa kabar?", engine="fake", voice="ana", style="hangat", pauses=0.5)
    assert set(made) == {"id", "name", "duration"}
    assert made["name"].startswith("Narration Ana ")
    assert made["duration"] == pytest.approx(2 * TONE_SECS + 0.5, abs=0.1)
    assert engine.reads == [("Halo semua.", "ana", "hangat"), ("Apa kabar?", "ana", "hangat")]
    [item] = (await call(mcp, "list_assets", kind="media"))["media"]
    assert item["id"] == made["id"] and item["kind"] == "audio"


@pytest.mark.anyio
async def test_generate_speech_fails_with_the_runners_messages(mcp, client, engine):
    too_long = await fails(mcp, "generate_speech", text="a" * 5_001, engine="fake", voice="ana")
    assert "A script can be 5,000 characters at most" in too_long
    assert "Fake asleep isn't ready" in await fails(mcp, "generate_speech", text="Halo.", engine="asleep", voice="ana")
    engine.hold()
    first = narrate(client, "Halo.")
    assert first.status_code == 202
    assert "Another Narration is being made" in await fails(mcp, "generate_speech", text="Lagi.", engine="quiet", voice="ana")
    engine.release()
    assert [name for name, _ in ending(client, first.json()["id"])] == ["done"]
    engine.fail_with("Fake refused the key")
    assert "Fake refused the key" in await fails(mcp, "generate_speech", text="Halo.", engine="fake", voice="ana")
    assert len((await call(mcp, "list_assets", kind="media"))["media"]) == 1


@pytest.mark.anyio
async def test_merge_candidate_items_lays_a_generated_narration_as_speech_and_the_dry_run_ducks_a_song_under_it(mcp, tmp_path):
    made = await call(mcp, "generate_speech", text="Halo.", engine="fake", voice="ana")
    song_file = tmp_path / "song.wav"
    make(song_file, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    song = await call(mcp, "add_asset", kind="media", path=str(song_file))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    segments = [{"id": "e", "start": candidate["start"], "end": candidate["end"], "muted": True}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": segments})
    music = [
        {"id": "m", "media": song["id"], "start": 0.0, "secs": 1.5, "duck": -12},
        {"id": "n", "media": made["id"], "start": 0.2, "secs": made["duration"], "speech": True},
    ]
    saved = await call(mcp, "merge_candidate_items", **ids, music=music)
    assert {clip["id"]: clip["speech"] for clip in saved["music"]} == {"m": False, "n": True}
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    sounds = {sound["id"]: sound for sound in plan["sounds"]}
    assert sounds["n"].get("speech") is True and "duck" not in sounds["n"]
    assert sounds["m"]["speech_spans"] == [[0.2, round(0.2 + made["duration"], 2)]]
