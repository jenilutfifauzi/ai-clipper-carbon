"""The Clean switches (.scratch/audio-effects/issues/06-clean-switches.md, ADR 0017): Reduce noise,
Enhance voice and Normalize loudness, catalogue entries of the Clean group. Seam A: the API with the
real ffmpeg, and the sound it answers with (Save sound as WAV, the Effected copy, the render)."""

import io
import json
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

import app.renderer
from app.config import load_settings
from test_effected_copies import asked, words_of
from test_item_sound import RATE, length, level, sound_url
from test_keyframes import clip_of
from test_media_library import make, upload
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's): a 440 Hz tone.
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch

TONE = 880
SECS = 3.0


@pytest.fixture(scope="session")
def songs(tmp_path_factory) -> dict[str, bytes]:
    """3 s songs: a TONE Hz tone over a bed of white noise; a quiet tone and a loud one; silence."""
    folder = tmp_path_factory.mktemp("clean-songs")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "noisy": make(
            folder / "noisy.wav", *lavfi, f"sine=frequency={TONE}:duration={SECS}", *lavfi,
            f"anoisesrc=color=white:amplitude=0.02:duration={SECS}:seed=7",
            "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0", "-ar", "48000",
        ),
        "quiet": make(folder / "quiet.wav", *lavfi, f"aevalsrc=0.01*sin(2*PI*{TONE}*t):s=48000:d={SECS}"),
        "loud": make(folder / "loud.wav", *lavfi, f"aevalsrc=0.8*sin(2*PI*{TONE}*t):s=48000:d={SECS}"),
        "silent": make(folder / "silent.wav", *lavfi, "anullsrc=r=48000:cl=mono", "-t", str(SECS)),
    }


def wav_of(client, job: dict, candidate: dict, kind: str, item: str, draft: dict | None = None) -> bytes:
    response = client.post(sound_url(job, candidate, kind, item), json=draft)
    assert response.status_code == 200, response.text
    return response.content


def samples_of(wav_bytes: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(wav_bytes)) as heard:
        frames = heard.readframes(heard.getnframes())
    return np.frombuffer(frames, dtype="<i2").reshape(-1, 2).astype(float).mean(axis=1) / 32768


def lufs(wav_bytes: bytes) -> float:
    """The integrated loudness of a WAV, as loudnorm measures it."""
    command = [
        str(load_settings().ffmpeg_bin), "-hide_banner", "-nostats", "-v", "info", "-i", "-",
        "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]
    output = subprocess.run(command, input=wav_bytes, capture_output=True, check=True).stderr.decode()
    return float(json.loads(output[output.rindex("{") : output.rindex("}") + 1])["input_i"])


def noise_energy(samples: np.ndarray) -> float:
    """The energy of `samples` away from TONE Hz."""
    spectrum = np.abs(np.fft.rfft(samples)) ** 2
    frequencies = np.fft.rfftfreq(len(samples), 1 / RATE)
    return float(spectrum[np.abs(frequencies - TONE) > 50].sum())


def song_clip(client, job: dict, candidate: dict, song: bytes, effects: list[dict], name: str = "song.wav") -> dict:
    """The Candidate with one Music Clip `m` of `song`, 2.5 s of it from 0.25 s, through `effects`."""
    item = upload(client, song, name).json()
    clip = {"id": "m", "media": item["id"], "start": 0.0, "offset": 0.25, "secs": 2.5, "duck": None, "audio_effects": effects}
    return patch(client, job, candidate, music=[clip])


def test_reduce_noise_lowers_the_noise_bed_under_a_tone_and_keeps_the_tone(client, songs):
    job = reviewed(client)
    candidate = song_clip(client, job, add(client, job, "halo", "soal"), songs["noisy"], [])
    dry = samples_of(wav_of(client, job, candidate, "music", "m"))
    wet = samples_of(wav_of(client, job, candidate, "music", "m", {"music": [candidate["music"][0] | {"audio_effects": [{"id": "denoise"}]}]}))
    assert length(wet) == pytest.approx(length(dry), abs=0.01)
    # Past its first half second, where afftdn is still learning the noise.
    steady = slice(round(0.5 * RATE), None)
    assert noise_energy(wet[steady]) < 0.25 * noise_energy(dry[steady])
    for at in (0.75, 1.5, 2.2):
        assert 20 * np.log10(level(wet, TONE, at) / level(dry, TONE, at)) == pytest.approx(0, abs=1.5), at


@pytest.mark.parametrize("amount", [0, 60, 100])
def test_enhance_voice_runs_and_keeps_the_items_length(client, songs, amount):
    job = reviewed(client)
    candidate = song_clip(client, job, add(client, job, "halo", "soal"), songs["noisy"], [{"id": "enhance-voice", "params": {"amount": amount}}])
    heard = samples_of(wav_of(client, job, candidate, "music", "m"))
    assert length(heard) == pytest.approx(2.5, abs=0.01)
    assert level(heard, TONE, 1.5) > 0.05


@pytest.mark.parametrize("song, target", [("quiet", -23), ("loud", -23), ("quiet", -14), ("loud", -30)])
def test_normalize_brings_a_quiet_tone_and_a_loud_one_near_its_target_with_a_steady_gain(client, songs, song, target):
    job = reviewed(client)
    candidate = song_clip(client, job, add(client, job, "halo", "soal"), songs[song], [{"id": "normalize", "params": {"target": target}}])
    wav = wav_of(client, job, candidate, "music", "m")
    assert lufs(wav) == pytest.approx(target, abs=1)
    # One gain throughout: the tone's level is the same from its first moment to its last.
    heard = samples_of(wav)
    levels = [level(heard, TONE, at, 0.1) for at in np.arange(0.0, 2.4, 0.2)]
    assert 20 * np.log10(max(levels) / min(levels)) < 0.5, levels


def test_normalize_gives_a_silent_item_no_gain(client, songs):
    job = reviewed(client)
    candidate = song_clip(client, job, add(client, job, "halo", "soal"), songs["silent"], [{"id": "normalize"}])
    heard = samples_of(wav_of(client, job, candidate, "music", "m"))
    assert length(heard) == pytest.approx(2.5, abs=0.01)
    assert np.abs(heard).max() == 0


def test_normalize_measures_the_sound_up_to_its_place_in_the_stack(client, songs):
    """Distorted after Normalize is louder than the target; Normalize after Distorted is at it."""
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    normalize, distorted = {"id": "normalize"}, {"id": "distorted", "params": {"drive": 100}}
    candidate = song_clip(client, job, candidate, songs["quiet"], [normalize, distorted])
    after = wav_of(client, job, candidate, "music", "m")
    before = wav_of(client, job, candidate, "music", "m", {"music": [candidate["music"][0] | {"audio_effects": [distorted, normalize]}]})
    assert lufs(before) == pytest.approx(-23, abs=1)
    assert lufs(after) > -20


def test_the_effected_copy_is_at_the_target_and_the_render_reuses_its_measurement(client, settings, monkeypatch):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = words_of(job)
    item = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"], "audio_effects": [{"id": "normalize", "params": {"target": -18}}]}
    candidate = patch(client, job, candidate, segments=[item])
    url = asked(client, job, candidate, "segment", "e")["url"]
    copy = client.get(url).content
    assert lufs(copy) == pytest.approx(-18, abs=1)
    # Save sound as WAV hears it as the copy does.
    assert lufs(wav_of(client, job, candidate, "segment", "e")) == pytest.approx(lufs(copy), abs=0.2)

    measured = []
    measure = app.renderer.Renderer._loudness_of

    def counted(self, *args, **kwargs):
        measured.append(args)
        return measure(self, *args, **kwargs)

    monkeypatch.setattr(app.renderer.Renderer, "_loudness_of", counted)
    clip = clip_of(client, settings, job, candidate)
    assert Path(clip).is_file()
    assert measured == []
