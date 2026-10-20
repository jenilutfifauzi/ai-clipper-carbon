"""Save sound as WAV (.scratch/audio-mixing/issues/12-save-sound-as-wav.md): a Segment's, a Music
Clip's or a video Overlay's sound alone, as it is heard in the Clip, from a draft of the Candidate's
edits. Seam A: the API with the real ffmpeg, and the WAV it answers with."""

import io
import wave

import numpy as np
import pytest

from test_keyframes import stills  # noqa: F401
from test_media_library import make, upload
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's): a 440 Hz tone.
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch
from test_segment_fades import COVER, TONE, heard_db, toned  # noqa: F401

RATE = 48_000
# The song's tone, apart from the Source's 440 Hz.
SONG_TONE = 880


def sound_url(job: dict, candidate: dict, kind: str, item: str) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}/sound/{kind}/{item}"


def saved_sound(client, job: dict, candidate: dict, kind: str, item: str, draft: dict | None = None) -> np.ndarray:
    """The item's WAV, checked to be 48 kHz stereo 16-bit PCM, as its samples (mono, -1..1)."""
    response = client.post(sound_url(job, candidate, kind, item), json=draft)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["content-disposition"].startswith("attachment;")
    with wave.open(io.BytesIO(response.content)) as heard:
        assert (heard.getnchannels(), heard.getsampwidth(), heard.getframerate(), heard.getcomptype()) == (2, 2, RATE, "NONE")
        frames = heard.readframes(heard.getnframes())
    return np.frombuffer(frames, dtype="<i2").reshape(-1, 2).astype(float).mean(axis=1) / 32768


def level(samples: np.ndarray, frequency: float, start: float, secs: float = 0.05) -> float:
    """The amplitude of `frequency` over `secs` from `start`."""
    first, count = round(start * RATE), round(secs * RATE)
    window = samples[first : first + count]
    phase = np.exp(-2j * np.pi * frequency * np.arange(len(window)) / RATE)
    return 2 * abs((window * phase).sum()) / max(len(window), 1)


def length(samples: np.ndarray) -> float:
    return len(samples) / RATE


@pytest.fixture(scope="session")
def song(tmp_path_factory) -> bytes:
    """A 4 s song of a steady SONG_TONE Hz tone."""
    return make(tmp_path_factory.mktemp("song") / "song.wav", "-f", "lavfi", "-i", f"sine=frequency={SONG_TONE}:duration=4")


def test_a_source_segments_wav_is_as_long_as_it_with_its_fade_in_and_heard_though_muted(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    start, end = words["halo"]["start"], words["soal"]["end"]
    candidate = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "fade_in": 1, "muted": True}])
    samples = saved_sound(client, job, candidate, "segment", "e")
    # As long as it is on the Timeline, as saved (snapped to Words).
    [segment] = candidate["segments"]
    assert length(samples) == pytest.approx(segment["end"] - segment["start"], abs=0.03)
    full = level(samples, 440, 1.5)
    # Not silent, though Muted: the item as heard but for that.
    assert full > 0.05

    def faded(time: float) -> float:
        return min(time / 1, 1.0)

    for at in (0.225, 0.475, 0.725):
        heard = 20 * np.log10(level(samples, 440, at) / full)
        assert heard == pytest.approx(heard_db(faded, at) - heard_db(faded, 1.5), abs=0.5), at


def test_the_wav_is_of_the_unsaved_draft_and_a_clip_not_cut_is_its_one_segment(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    saved = saved_sound(client, job, candidate, "segment", "main")
    assert length(saved) == pytest.approx(candidate["end"] - candidate["start"], abs=0.03)
    # The Clip's own sound halved in the draft, not saved: the WAV is of the draft.
    drafted = saved_sound(client, job, candidate, "segment", "main", {"source_volume": 0.5})
    assert 20 * np.log10(level(drafted, 440, 1) / level(saved, 440, 1)) == pytest.approx(-6.02, abs=0.3)


def test_a_music_clips_wav_is_at_its_speed_and_one_of_the_source_at_the_clips_own_sound(client, song):
    item = upload(client, song, "song.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    sped = {"id": "m", "media": item["id"], "start": 0.5, "secs": 1, "offset": 0.5, "speed": 2}
    backwards = {"id": "r", "media": item["id"], "start": 0, "secs": 1.5, "offset": 1, "reverse": True}
    episode = {"id": "s", "start": 1, "secs": 2, "offset": 1}
    candidate = patch(client, job, candidate, music=[sped, backwards, episode])

    # At 2×: 2 s of the song in 1 s, its pitch kept.
    fast = saved_sound(client, job, candidate, "music", "m")
    assert length(fast) == pytest.approx(1, abs=0.03)
    assert level(fast, SONG_TONE, 0.5) > 0.05
    # In Reverse, from a Retimed copy of the song.
    assert length(saved_sound(client, job, candidate, "music", "r")) == pytest.approx(1.5, abs=0.03)

    # The episode's sound, at the Clip's own volume: halved with it, and with its own volume (unsaved).
    whole = saved_sound(client, job, candidate, "music", "s")
    assert length(whole) == pytest.approx(2, abs=0.03)
    for draft in ({"source_volume": 0.5}, {"music": [sped, backwards, episode | {"volume": 0.5}]}):
        halved = saved_sound(client, job, candidate, "music", "s", draft)
        assert 20 * np.log10(level(halved, 440, 1) / level(whole, 440, 1)) == pytest.approx(-6.02, abs=0.3), draft


def test_a_ducked_music_clips_wav_is_as_loud_as_with_duck_off(client, song):
    """Ducking is left out (.scratch/audio-mixing/issues/10): under the Clip's Words, a song ducked
    at -20 dB is saved as loud as when it isn't."""
    item = upload(client, song, "song.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    under = {"id": "m", "media": item["id"], "start": 0, "secs": 2}
    candidate = patch(client, job, candidate, music=[under | {"duck": -20}])
    # The plan ducks it under the Words.
    planned = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan").json()["plan"]
    assert planned["audio"][0]["duck"] == -20 and planned["audio"][0]["speech_spans"]
    ducked = saved_sound(client, job, candidate, "music", "m")
    unducked = saved_sound(client, job, candidate, "music", "m", {"music": [under | {"duck": None}]})
    for at in (0.5, 1.0, 1.5):
        assert 20 * np.log10(level(ducked, SONG_TONE, at) / level(unducked, SONG_TONE, at)) == pytest.approx(0, abs=0.1), at


def test_a_muted_video_overlays_wav_is_its_sound_while_it_shows(client, toned):
    item = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    overlay = {"id": "o", "media": item["id"], "start": 0.5, "secs": 1.5, "volume": 1, "muted": True}
    candidate = patch(client, job, candidate, overlays=[overlay])
    samples = saved_sound(client, job, candidate, "overlay", "o")
    assert length(samples) == pytest.approx(1.5, abs=0.03)
    assert level(samples, TONE, 0.75) > 0.05


def test_a_freeze_frame_an_image_a_silent_overlay_and_an_unknown_item_are_refused(client, toned, stills):  # noqa: F811
    image = upload(client, stills["blue"], "blue.png").json()
    video = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    head = {"id": "head", "start": words["halo"]["start"], "end": words["semua"]["end"]}
    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    overlays = [
        {"id": "i", "media": image["id"], "start": 0, "secs": 1},
        # A stored Overlay's sound: turned down to nothing.
        {"id": "quiet", "media": video["id"], "start": 0, "secs": 1, "volume": 0},
    ]
    candidate = patch(client, job, candidate, segments=[head, still], overlays=overlays)

    for kind, item, status, said in (
        ("segment", "still", 422, "Freeze frame"),
        ("overlay", "i", 422, "image"),
        ("overlay", "quiet", 422, "no sound"),
        ("segment", "gone", 404, "no Segment gone"),
        ("music", "head", 404, "no Music Clip head"),
        ("shape", "head", 422, ""),
    ):
        response = client.post(sound_url(job, candidate, kind, item))
        assert response.status_code == status and said in response.text, (kind, item, response.text)
    # An item only the draft has is found; one the draft removed isn't.
    drafted = {"segments": [head], "overlays": []}
    assert client.post(sound_url(job, candidate, "segment", "still"), json=drafted).status_code == 404
    assert client.post(sound_url(job, candidate, "overlay", "i"), json=drafted).status_code == 404


def test_a_music_clips_and_an_overlays_wav_is_heard_through_their_audio_effects(client, song, toned):
    """An octave up through Pitch (.scratch/audio-effects/issues/02): the song's SONG_TONE and the
    video's TONE are saved at twice their pitch, as long as before; and as they are with it off."""
    tune = upload(client, song, "song.wav").json()
    video = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    up = [{"id": "pitch", "params": {"semitones": 12}}]
    music = {"id": "m", "media": tune["id"], "start": 0.5, "secs": 1.5, "audio_effects": up}
    overlay = {"id": "o", "media": video["id"], "start": 0.5, "secs": 1.5, "volume": 1, "audio_effects": up}
    candidate = patch(client, job, candidate, music=[music], overlays=[overlay])
    for kind, item, tone in (("music", "m", SONG_TONE), ("overlay", "o", TONE)):
        samples = saved_sound(client, job, candidate, kind, item)
        assert length(samples) == pytest.approx(1.5, abs=0.03)
        assert level(samples, 2 * tone, 0.75) > 0.05, kind
        assert level(samples, tone, 0.75) < 0.1 * level(samples, 2 * tone, 0.75), kind
    off = saved_sound(client, job, candidate, "music", "m", {"music": [music | {"audio_effects": [up[0] | {"enabled": False}]}]})
    assert level(off, SONG_TONE, 0.75) > 10 * level(off, 2 * SONG_TONE, 0.75)
