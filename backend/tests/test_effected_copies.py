"""Effected copies (.scratch/audio-effects/issues/03-effected-copies-in-the-preview.md, ADR 0017):
the file the preview plays an item's sound from while it has Audio Effects, made by the server from
the Candidate or a draft of its edits. Seam A: the API with the real ffmpeg, and the copy it serves."""

import io
import threading
import wave

import numpy as np
import pytest

import app.effected
from test_item_sound import RATE, SONG_TONE, length, level, saved_sound, song  # noqa: F401
from test_keyframes import stills  # noqa: F401
from test_media_library import upload
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's): a 440 Hz tone.
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch
from test_segment_fades import COVER, TONE, toned  # noqa: F401

# An octave up: what the copy has, and the item's own sound hasn't.
UP = [{"id": "pitch", "params": {"semitones": 12}}]


def effected_url(job: dict, candidate: dict, kind: str, item: str) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}/effected/{kind}/{item}"


def asked(client, job: dict, candidate: dict, kind: str, item: str, draft: dict | None = None) -> dict:
    """What the endpoint answers for the item: its copy's `url`, or none."""
    response = client.post(effected_url(job, candidate, kind, item), json=draft)
    assert response.status_code == 200, response.text
    return response.json()


def copy_samples(client, url: str) -> np.ndarray:
    """The copy at `url`, checked to be 48 kHz stereo 16-bit PCM, as its samples (mono, -1..1)."""
    response = client.get(url)
    assert response.status_code == 200, response.text
    with wave.open(io.BytesIO(response.content)) as heard:
        assert (heard.getnchannels(), heard.getsampwidth(), heard.getframerate()) == (2, 2, RATE)
        frames = heard.readframes(heard.getnframes())
    return np.frombuffer(frames, dtype="<i2").reshape(-1, 2).astype(float).mean(axis=1) / 32768


def words_of(job: dict) -> dict[str, dict]:
    return {word["text"]: word for word in job["transcript"]["words"]}


def items(client, job: dict, song: bytes, toned: bytes) -> dict[str, tuple[str, dict, int]]:  # noqa: F811
    """One item of each kind that sounds, by name: its kind, its fields (at volume 1, unfaded, no
    effects) and the tone it sounds."""
    tune = upload(client, song, "song.wav").json()
    video = upload(client, toned, "toned.mp4").json()
    words = words_of(job)
    return {
        "source segment": ("segment", {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}, 440),
        "media segment": ("segment", {"id": "v", "start": 0, "end": 1.5, "media": video["id"], "framing": COVER}, TONE),
        "music clip": ("music", {"id": "m", "media": tune["id"], "start": 0.25, "secs": 1.5, "speed": 1.5}, SONG_TONE),
        "overlay": ("overlay", {"id": "o", "media": video["id"], "start": 0.5, "secs": 1.5, "volume": 1}, TONE),
    }


KEYS = {"segment": "segments", "music": "music", "overlay": "overlays"}


def drafted(kind: str, saved: list[dict], item: str, **fields) -> dict:
    """A draft of edits with the items `saved` of `kind`, `item` changed by `fields`."""
    return {KEYS[kind]: [other | fields if other["id"] == item else other for other in saved]}


def saved_with(client, job: dict, candidate: dict, kind: str, item: dict) -> tuple[dict, list[dict]]:
    """The Candidate saved with `item`, after the Source's Segment `e` for a media Segment; and its items of `kind`."""
    words = words_of(job)
    saved = [item, {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}] if kind == "segment" and "media" in item else [item]
    return patch(client, job, candidate, **{KEYS[kind]: saved}), saved


@pytest.mark.parametrize("name", ["source segment", "media segment", "music clip", "overlay"])
def test_a_copy_is_the_items_sound_before_its_volume_through_the_drafts_effects(client, song, toned, name):  # noqa: F811
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    kind, item, tone = items(client, job, song, toned)[name]
    candidate, saved = saved_with(client, job, candidate, kind, item)
    # Saved without effects; the draft turns it down, fades it in (an Overlay has no fades) and pitches it up an octave.
    faded = {} if kind == "overlay" else {"fade_in": 0.5}
    draft = drafted(kind, saved, item["id"], volume=0.5, **faded, audio_effects=UP)
    copy = copy_samples(client, asked(client, job, candidate, kind, item["id"], draft)["url"])
    # As the render hears it at volume 1, unfaded: Save sound as WAV of that draft.
    whole = saved_sound(client, job, candidate, kind, item["id"], drafted(kind, saved, item["id"], audio_effects=UP))
    assert length(copy) == pytest.approx(length(whole), abs=0.01)
    for at in (0.1, length(whole) / 2, length(whole) - 0.2):
        assert 20 * np.log10(level(copy, 2 * tone, at) / level(whole, 2 * tone, at)) == pytest.approx(0, abs=1), at
        assert level(copy, tone, at) < 0.1 * level(copy, 2 * tone, at), at


def test_a_copy_is_made_once_per_key_and_asked_together_it_is_made_by_one_ffmpeg_run(client, settings, monkeypatch):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = words_of(job)
    item = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"], "audio_effects": UP}
    candidate = patch(client, job, candidate, segments=[item])
    url = asked(client, job, candidate, "segment", "e")["url"]
    copy = settings.data_dir / "jobs" / job["id"] / url.split(f"/media/{job['id']}/", 1)[1]
    made = copy.stat().st_mtime_ns
    # Its volume, fades and place in the Clip aren't in the key: the same file, not made again.
    for draft in (None, {"segments": [item | {"volume": 0.3, "fade_out": 0.5}]}, {"source_volume": 0.5}):
        assert asked(client, job, candidate, "segment", "e", draft)["url"] == url, draft
    assert copy.stat().st_mtime_ns == made
    # Another setting of its effect is another copy.
    other = asked(client, job, candidate, "segment", "e", {"segments": [item | {"audio_effects": [{"id": "pitch", "params": {"semitones": 7}}]}]})
    assert other["url"] != url

    # Asked for three times at once, a new copy is made by one run, and all three get it.
    runs = []
    making = app.effected.sound_of

    def counted(*args, **kwargs):
        runs.append(args)
        return making(*args, **kwargs)

    monkeypatch.setattr(app.effected, "sound_of", counted)
    echoed = {"segments": [item | {"audio_effects": [{"id": "echo"}]}]}
    answers = []
    threads = [threading.Thread(target=lambda: answers.append(asked(client, job, candidate, "segment", "e", echoed))) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(runs) == 1
    assert len({answer["url"] for answer in answers}) == 1 and len(answers) == 3


def test_a_muted_item_a_freeze_frame_an_image_and_an_item_without_an_effect_on_have_no_copy(client, toned, stills):  # noqa: F811
    image = upload(client, stills["blue"], "blue.png").json()
    video = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = words_of(job)
    head = {"id": "head", "start": words["halo"]["start"], "end": words["semua"]["end"]}
    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    overlays = [
        {"id": "i", "media": image["id"], "start": 0, "secs": 1},
        {"id": "plain", "media": video["id"], "start": 0, "secs": 1, "volume": 1},
        {"id": "off", "media": video["id"], "start": 0, "secs": 1, "volume": 1, "audio_effects": [UP[0] | {"enabled": False}]},
        {"id": "muted", "media": video["id"], "start": 0, "secs": 1, "volume": 1, "muted": True, "audio_effects": UP},
    ]
    candidate = patch(client, job, candidate, segments=[head, still], overlays=overlays)
    for kind, item in (("segment", "still"), ("segment", "head"), ("overlay", "i"), ("overlay", "plain"), ("overlay", "off"), ("overlay", "muted")):
        answer = asked(client, job, candidate, kind, item)
        assert answer["url"] is None and answer["why"], (kind, item, answer)
    # Unmuted, it has one; an item the Candidate hasn't is unknown.
    assert asked(client, job, candidate, "overlay", "muted", {"overlays": [overlays[3] | {"muted": False}]})["url"]
    assert client.post(effected_url(job, candidate, "segment", "gone")).status_code == 404


def test_after_a_save_the_copies_no_candidate_uses_are_removed(client, settings):
    job = reviewed(client)
    first, second = add(client, job, "halo", "soal"), add(client, job, "halo", "kabar")
    words = words_of(job)
    item = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"], "audio_effects": UP}
    first = patch(client, job, first, segments=[item])
    other = {"id": "f", "start": words["halo"]["start"], "end": words["kabar"]["end"], "audio_effects": [{"id": "echo"}]}
    second = patch(client, job, second, segments=[other])
    folder = settings.data_dir / "jobs" / job["id"] / "effected"

    def file(answer: dict):
        return folder / answer["url"].rsplit("/", 1)[1]

    kept, others = file(asked(client, job, first, "segment", "e")), file(asked(client, job, second, "segment", "f"))
    # Tried in a draft, never saved.
    tried = file(asked(client, job, first, "segment", "e", {"segments": [item | {"audio_effects": [{"id": "telephone"}]}]}))
    assert kept.is_file() and others.is_file() and tried.is_file()
    patch(client, job, first, hook_text="Coba")
    assert kept.is_file() and others.is_file()
    assert not tried.exists()
    # Its effects saved off, the first Candidate's copy goes too; the other's stays.
    patch(client, job, first, segments=[item | {"audio_effects": []}])
    assert not kept.exists() and others.is_file()


@pytest.mark.parametrize("save", ["add a Candidate", "restore a Revision"])
def test_every_save_of_a_candidate_removes_the_copies_no_candidate_uses(client, settings, save):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = words_of(job)
    item = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"], "audio_effects": UP}
    candidate = patch(client, job, candidate, segments=[item])
    folder = settings.data_dir / "jobs" / job["id"] / "effected"
    kept = folder / asked(client, job, candidate, "segment", "e")["url"].rsplit("/", 1)[1]
    draft = {"segments": [item | {"audio_effects": [{"id": "telephone"}]}]}
    tried = folder / asked(client, job, candidate, "segment", "e", draft)["url"].rsplit("/", 1)[1]
    assert kept.is_file() and tried.is_file()
    if save == "add a Candidate":
        add(client, job, "halo", "kabar", selected=False)
    else:
        url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/revisions/{candidate['revision']}/restore"
        response = client.post(url, json={})
        assert response.status_code == 200, response.text
    assert kept.is_file()
    assert not tried.exists()
