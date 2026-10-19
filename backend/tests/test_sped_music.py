"""Speed, pitch and Reverse on Music Clips (.scratch/audio-mixing/issues/07-music-clip-speed-pitch-reverse.md):
Seam B on the planner and the copies it plays from, then Seam A through the API, MCP and the real
ffmpeg. A Music Clip keeps its start and secs on the Timeline and plays secs × speed of its song from
its offset, its pitch kept unless `pitch`, backwards from a Retimed copy of the song with `reverse`,
as a video Overlay's sound does."""

from dataclasses import replace
from pathlib import Path

import pytest

from app.candidates import MusicClip
from app.config import load_settings
from app.planner import MediaInfo, audio_events
from app.retimed import CopySize, Retime, copies_used
from app.segment_time import SegmentTime
from test_evaluation import candidate as plain_candidate
from test_keyed_volume import tone_level
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, render, rendered, reviewed
from test_retimed_copies import SWEEP, sweep_at
from test_review import candidate_url, patch
from test_sped_media_segments import from_source_at_30, source_at_30  # noqa: F401

SONG = "ef" * 16
SONGS = {SONG: MediaInfo(0, 0, 10.0, True)}
# The tone song's, an octave above the Source's 440 Hz.
TONE = 880


def clip(**fields) -> MusicClip:
    return MusicClip(**{"id": "m", "media": SONG, "start": 1.0, "secs": 4.0, "offset": 2.0, **fields})


# Seam B: the planner, and the copies it plays from


def test_a_sped_music_clip_keeps_its_place_and_reads_its_secs_times_its_speed():
    [event] = audio_events([clip(speed=2, pitch=True)], 20, SONGS)
    assert (event.start, event.end, event.offset, event.speed, event.pitch, event.reverse) == (1, 5, 2, 2, True, False)
    assert event.time == SegmentTime(2, 10, 2)
    # At 0.5×, its 4 s read 2 s of the song.
    assert audio_events([clip(speed=0.5)], 20, SONGS)[0].time == SegmentTime(2, 4, 0.5)
    # At 1×, as before.
    [still] = audio_events([clip()], 20, SONGS)
    assert (still.end, still.offset, still.speed, still.reverse) == (5, 2, 1, False)


def test_a_sped_music_clip_is_cut_where_its_song_ends_at_its_speed_and_by_the_clips_end():
    # 8 s of the song are left from 2 s: 4 s at 2×, 16 s at 0.5×.
    assert audio_events([clip(secs=6, speed=2)], 20, SONGS)[0].end == 5.0
    assert audio_events([clip(secs=19, speed=0.5)], 30, SONGS)[0].end == 17.0
    # Cut by the Clip at 3 s: 2 s of it heard, 4 s of the song read.
    [cut] = audio_events([clip(speed=2)], 3, SONGS)
    assert (cut.end, cut.time) == (3, SegmentTime(2, 6, 2))


def test_a_reversed_music_clip_cut_by_the_clips_end_plays_the_end_of_its_part_so_it_begins_later():
    [whole] = audio_events([clip(speed=2, reverse=True)], 20, SONGS)
    assert (whole.offset, whole.reverse, whole.time) == (2, True, SegmentTime(2, 10, 2, True))
    # 2 s heard at 2× of its 2..10 s backwards: from 10 back to 6.
    [cut] = audio_events([clip(speed=2, reverse=True)], 3, SONGS)
    assert (cut.start, cut.end, cut.offset, cut.time) == (1, 3, 6, SegmentTime(6, 10, 2, True))


def test_a_music_clip_in_reverse_or_past_4x_plays_from_copies_of_its_song():
    candidate = replace(
        plain_candidate(0, 30),
        music=[clip(id="r", reverse=True), clip(id="f", start=6, speed=8, offset=0, secs=1), clip(id="p", start=8, secs=1, speed=2)],
    )
    used = copies_used([candidate], {SONG: 10.0})
    assert used[SONG] == [
        (CopySize.FULL, Retime(2, 6)), (CopySize.PREVIEW, Retime(2, 6)),
        (CopySize.PREVIEW, Retime(0, 8, False, 8)),
    ]


# Seam A: the API and MCP


@pytest.fixture(scope="session")
def songs(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s song of an 880 Hz tone, and a 2.5 s one of a rising tone (the counter's sweep)."""
    folder = tmp_path_factory.mktemp("sped-music")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "tone": make(folder / "tone.wav", *lavfi, f"sine=frequency={TONE}:sample_rate=48000:duration=2"),
        "sweep": make(folder / "sweep.wav", *lavfi, f"aevalsrc='sin(2*PI*({SWEEP[0]}*t+{SWEEP[1] / 2}*t*t))':d=2.5:s=48000"),
    }


def test_speed_pitch_and_reverse_are_saved_and_a_read_past_the_song_or_a_stranded_keyframe_is_refused(client, songs):
    tone = upload(client, songs["tone"], "tone.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    sped = {"id": "m", "media": tone["id"], "start": 0.5, "secs": 0.75, "offset": 0.5, "speed": 2, "pitch": True, "reverse": True}
    saved = patch(client, job, candidate, music=[sped])
    assert {key: saved["music"][0][key] for key in ("speed", "pitch", "reverse")} == {"speed": 2, "pitch": True, "reverse": True}
    [event] = preview(client, job, saved)["plan"]["audio"]
    assert {key: event[key] for key in ("start", "end", "offset", "speed", "pitch", "reverse")} == {
        "start": 0.5, "end": 1.25, "offset": 0.5, "speed": 2, "pitch": True, "reverse": True,
    }
    stored = patch(client, job, saved, music=[{**sped, "speed": 1, "pitch": False, "reverse": False}])["music"][0]
    assert (stored["speed"], stored["pitch"], stored["reverse"]) == (1, False, False)

    keyed = {**sped, "speed": 1, "keys": {"volume": [{"at": 0, "value": 1}, {"at": 0.7, "value": 0.5}]}}
    for music, message in (
        # 0.5 + 1 × 2 = 2.5 s of a 2 s song.
        ([{**sped, "secs": 1}], "Music Clip m runs past the end of its song (2 s) at 2x"),
        ([{**sped, "speed": 17}], "less than or equal to 16"),
        ([{**sped, "speed": 0.05}], "greater than or equal to 0.0625"),
        # At 2× its 0.75 s would be 0.375 s: the Keyframe at 0.7 s is stranded unless sent at 0.35 s.
        ([{**keyed, "speed": 2, "secs": 0.375}], "Music Clip m's volume Keyframe at 0.7 s is past its length of 0.375 s"),
    ):
        response = client.patch(candidate_url(job, saved), json={"music": music})
        assert response.status_code == 422 and message in response.text, (message, response.text)
    # Its 0.75 s at 2× read the song to its end.
    assert patch(client, job, saved, music=[{**sped, "offset": 0.5}])["music"][0]["offset"] == 0.5


@pytest.mark.anyio
async def test_the_agent_speeds_and_reverses_a_music_clip_and_the_dry_run_shows_what_of_its_song_it_reads(client, mcp, songs, tmp_path):
    (tmp_path / "sweep.wav").write_bytes(songs["sweep"])
    song = await call(mcp, "add_asset", kind="media", path=str(tmp_path / "sweep.wav"))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    dip = {"volume": [{"at": 0, "value": 1}, {"at": 0.9, "value": 0.5}]}
    await call(mcp, "edit_candidate", **ids, changes={"music": [{"id": "m", "media": song["id"], "start": 0, "secs": 1, "offset": 0.5, "keys": dip}]})

    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "speed": 17}])
    assert "16" in message, message
    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "speed": 2, "secs": 0.5}])
    assert "Music Clip m's volume Keyframe at 0.9 s is past its length of 0.5 s; send its keys too" in message, message
    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "speed": 4}])
    assert "Music Clip m runs past the end of its song (2.5 s) at 4x" in message, message
    halved = {"volume": [{"at": 0, "value": 1}, {"at": 0.45, "value": 0.5}]}
    saved = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "speed": 2, "pitch": True, "reverse": True, "secs": 0.5, "keys": halved}])
    assert {key: saved["music"][0][key] for key in ("speed", "pitch", "reverse", "secs")} == {"speed": 2, "pitch": True, "reverse": True, "secs": 0.5}

    [sound] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["sounds"]
    assert {key: sound[key] for key in ("id", "start", "end", "source_start", "source_end", "speed", "pitch", "reverse", "copy")} == {
        "id": "m", "start": 0, "end": 0.5, "source_start": 0.5, "source_end": 1.5, "speed": 2, "pitch": True, "reverse": True,
        "copy": "made by the render",
    }
    client.app.state.media.retimed(song["id"]).make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 2.5))
    [sound] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["sounds"]
    assert sound["copy"] == "ready"


def test_a_song_has_retimed_copies_asked_by_the_preview(client, songs):
    sweep = upload(client, songs["sweep"], "sweep.wav").json()
    asked = client.post(f"/api/media/{sweep['id']}/retimed", json={"start": 0.5, "end": 2, "reverse": True})
    assert asked.status_code == 200, asked.text
    copies = client.app.state.media.retimed(sweep["id"])
    made = copies.make(load_settings().ffmpeg_bin, CopySize.PREVIEW, Retime(0.5, 2))
    assert made.path.is_file()


# Seam A: the real ffmpeg


def clip_path(client, settings, job: dict, candidate: dict) -> Path:
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    return settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]


def test_a_music_clip_at_2x_lasts_half_as_long_and_keeps_its_pitch_or_rises_an_octave(client, settings, songs):
    tone = upload(client, songs["tone"], "tone.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(client, job, candidate, music=[
        # The whole 2 s song in 1 s; then its first second in half a second, an octave up.
        {"id": "kept", "media": tone["id"], "start": 0.5, "secs": 1, "speed": 2},
        {"id": "tape", "media": tone["id"], "start": 2.5, "secs": 0.5, "speed": 2, "pitch": True},
    ])
    audio = preview(client, job, candidate)["plan"]["audio"]
    assert [(event["start"], event["end"]) for event in audio] == [(0.5, 1.5), (2.5, 3)]
    path = clip_path(client, settings, job, candidate)
    for at in (0.6, 1.35):
        assert tone_level(settings, path, TONE, at) > 10 * tone_level(settings, path, 2 * TONE, at), at
    # Nothing of it after its second.
    assert tone_level(settings, path, TONE, 1.7) < 0.1 * tone_level(settings, path, TONE, 1.3)
    for at in (2.6, 2.85):
        assert tone_level(settings, path, 2 * TONE, at) > 10 * tone_level(settings, path, TONE, at), at


def test_a_reversed_music_clip_plays_its_sweep_backwards_from_a_retimed_copy_of_the_song(client, settings, songs):
    sweep = upload(client, songs["sweep"], "sweep.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(client, job, candidate, music=[{"id": "m", "media": sweep["id"], "start": 0.5, "secs": 2, "reverse": True}])
    path = clip_path(client, settings, job, candidate)
    assert [path.name for path in (settings.data_dir / "media" / f"{sweep['id']}.retimed").iterdir()] == ["reversed-full-0-2000.mp4"]
    # At `at`, the tone of 2 − (at − 0.5) s into the song, not its mirror.
    for at in (0.7, 2.0):
        source = 2 - (at - 0.5)
        assert tone_level(settings, path, sweep_at(source), at) > 5 * tone_level(settings, path, sweep_at(2 - source), at), at
