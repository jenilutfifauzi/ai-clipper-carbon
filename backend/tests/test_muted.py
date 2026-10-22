"""Muted (.scratch/audio-mixing/issues/02-muted-agent-render-preview.md, docs/adr/0016): a Segment,
a Music Clip or a video Overlay switched silent, keeping its volume and Keyframes. Seam B on the
model and the planner, then Seam A through the API, MCP and the real ffmpeg."""

from dataclasses import replace

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Candidate, Keyframe, MusicClip, Overlay, Segment
from app.canvas import PORTRAIT
from app.config import CameraTuning
from app.planner import MediaInfo, audio_events, gain_at, overlay_sound
from app.rendering import candidate_plan
from app.styles import PresetStore
from test_keyed_volume import songs, tone_level  # noqa: F401
from test_keyframes import clip_of
from test_media_library import upload
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, make, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_music import loudness_by_window
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch
from test_segments import SOURCE
from test_segments import manual as manual_candidate

SONG = "ef" * 16
CLIP = "ab" * 16
ITEMS = {SONG: MediaInfo(0, 0, 30.0, True), CLIP: MediaInfo(640, 360, 10.0, True)}
DIP = [Keyframe(1.0, 1.0), Keyframe(2.0, 0.25)]


# Seam B: the model and the planner


def test_a_stored_candidate_reads_as_unmuted():
    candidate = manual_candidate(
        segments=[Segment("a", 10, 12), Segment("b", 20, 22)],
        music=[MusicClip("m", 0.0, 2.0, media=SONG)],
        overlays=[Overlay("o", CLIP, 0.0, 2.0, volume=1.0)],
    )
    adapter = TypeAdapter(Candidate)
    stored = adapter.dump_python(candidate, mode="json")
    for kind in ("segments", "music", "overlays"):
        for item in stored[kind]:
            del item["muted"]
    read = adapter.validate_python(stored)
    assert [item.muted for item in read.segments + read.music + read.overlays] == [False] * 4
    assert read == candidate


def test_a_muted_segment_is_planned_muted_at_its_volume(tmp_path):
    candidate = manual_candidate(segments=[Segment("a", 10, 12), Segment("b", 20, 22, volume=0.5, muted=True), Segment("c", 14, 15)])
    planned = candidate_plan(candidate, SOURCE, None, [None] * 3, PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [(segment.id, segment.muted) for segment in planned.segments] == [("a", False), ("b", True), ("c", False)]
    assert planned.segments[1].volume == 0.5


def test_a_muted_music_clip_and_overlay_keep_their_volume_and_keys_and_are_heard_at_gain_0():
    [music] = audio_events([MusicClip("m", 1.0, 3.0, media=SONG, volume=0.5, fade_in=0.5, keys={"volume": DIP}, muted=True)], 10, ITEMS)
    # An Overlay at volume 1, Muted, as the editor makes a new one.
    [sound] = overlay_sound([Overlay("o", CLIP, 2.0, 3.0, volume=1.0, muted=True)], 10, ITEMS, canvas=PORTRAIT)
    assert (music.muted, music.volume, music.gain, music.fade_in) == (True, 0.5, DIP, 0.5)
    assert (sound.id, sound.muted, sound.volume) == ("o", True, 1.0)
    for time in np.linspace(0, 6, 61):
        assert gain_at(music, time) == 0 and gain_at(sound, time) == 0
    # Unmuted, they are heard as they were.
    assert gain_at(replace(music, muted=False), 2.0) == 1.0 and gain_at(replace(sound, muted=False), 3.0) == 1.0


# Seam A: the API and MCP


def test_muted_is_saved_and_one_muted_segment_is_kept_as_its_segment(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    whole = {"id": "a", "start": candidate["start"], "end": candidate["end"]}
    muted = patch(client, job, candidate, segments=[{**whole, "volume": 0.5, "muted": True}])
    # Not folded into the plain range, which can't be Muted.
    assert [(segment["id"], segment["volume"], segment["muted"]) for segment in muted["segments"]] == [("a", 0.5, True)]
    assert preview(client, job, muted)["plan"]["segments"][0]["muted"] is True
    assert patch(client, job, muted, segments=[whole])["segments"] == []


@pytest.mark.anyio
async def test_the_agent_mutes_and_unmutes_items_and_the_dry_run_marks_them(mcp, tmp_path):
    song = tmp_path / "song.wav"
    make(song, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    item = await call(mcp, "add_asset", kind="media", path=str(song))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [
        {"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]},
    ]})
    merged = await call(
        mcp, "merge_candidate_items", **ids,
        segments=[{"id": "b", "muted": True}], music=[{"id": "m", "media": item["id"], "start": 0.5, "secs": 1, "volume": 0.7, "muted": True}],
    )
    assert [segment.get("muted") for segment in merged["segments"]] == [False, True]
    assert (merged["music"][0]["muted"], merged["music"][0]["volume"]) == (True, 0.7)

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert [segment.get("muted") for segment in plan["segments"]] == [None, True]
    assert [(sound["id"], sound.get("muted")) for sound in plan["sounds"]] == [("a", None), ("b", True), ("m", True)]

    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "b", "muted": False}], music=[{"id": "m", "muted": False}])
    assert (merged["segments"][1]["muted"], merged["music"][0]["muted"], merged["music"][0]["volume"]) == (False, False, 0.7)
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert all("muted" not in item for item in plan["segments"] + plan["sounds"])


# Seam A: the real ffmpeg


def test_muted_items_are_silent_in_the_render_and_heard_again_unmuted(client, settings, songs):  # noqa: F811
    """The Source's 440 Hz tone in three Segments, the middle one Muted; a song's 880 Hz tone with
    volume Keyframes and a video Overlay's 1500 Hz one at volume 1, both Muted. Then all unmuted."""
    tone = upload(client, songs["tone"], "tone.wav").json()
    talk = upload(client, songs["talk"], "talk.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    segments = [
        {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"]},
        {"id": "b", "start": words["kita"]["start"], "end": words["soal"]["end"], "muted": True},
        {"id": "c", "start": words["Podcast"]["start"], "end": words["ya"]["end"]},
    ]
    # From full to a quarter between 1 s and 2 s into the Clip.
    dip = [{"at": 1, "value": 1}, {"at": 2, "value": 0.25}]
    music = {"id": "m", "media": tone["id"], "start": 0.0, "secs": 3.0, "keys": {"volume": dip}, "muted": True}
    overlay = {"id": "o", "media": talk["id"], "start": 0.0, "secs": 2.0, "volume": 1, "muted": True}
    candidate = patch(client, job, candidate, segments=segments, music=[music], overlays=[overlay])
    _, muted, _ = preview(client, job, candidate)["plan"]["segments"]
    video = clip_of(client, settings, job, candidate)

    # Silent for exactly the Muted Segment's span on the Timeline (each window 0.05 s), heard either side.
    levels = loudness_by_window(settings, video, 0.05)
    first, last = round(muted["start"] / 0.05), round(muted["end"] / 0.05)
    assert levels[first + 1 : last - 1].max() < levels.max() * 0.02
    assert levels[first - 4 : first - 1].min() > levels.max() * 0.3
    assert levels[last + 1 : last + 4].min() > levels.max() * 0.3
    # Neither the song nor the Overlay's sound is heard, keyed or at volume 1.
    source = tone_level(settings, video, 440, 0.3)
    for frequency in (880, 1500):
        assert tone_level(settings, video, frequency, 0.3) < source * 0.01, frequency

    unmuted = patch(
        client, job, candidate,
        segments=[{**segment, "muted": False} for segment in segments],
        music=[{**music, "muted": False}], overlays=[{**overlay, "muted": False}],
    )
    video = clip_of(client, settings, job, unmuted)
    levels = loudness_by_window(settings, video, 0.05)
    assert levels[first + 1 : last - 1].min() > levels.max() * 0.3
    # The song follows its Keyframes again (a quarter, 12 dB down, once dipped); the Overlay is heard.
    full, dipped = tone_level(settings, video, 880, 0.5), tone_level(settings, video, 880, 2.5)
    assert 20 * np.log10(dipped / full) == pytest.approx(20 * np.log10(0.25), abs=0.5)
    assert tone_level(settings, video, 1500, 0.5) > source * 0.3
