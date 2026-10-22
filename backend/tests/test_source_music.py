"""Music Clips of the Source's sound (.scratch/audio-mixing/issues/08-music-clip-of-the-source.md):
Seam B on the planner and the copies it plays from, then Seam A through the API, MCP and the real
ffmpeg. A Music Clip without `media` plays a range of the episode's sound, `offset` being a time on
the Source's timeline, anywhere on the Timeline, at its Speed, scaled by the Clip's own sound
(`source_volume`) as a Segment of the Source is."""

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.candidates import MusicClip
from app.canvas import PORTRAIT
from app.planner import MediaInfo, audio_events, plan_render
from app.retimed import CopySize, Retime, copies_used
from app.segment_time import SegmentTime
from test_evaluation import candidate as plain_candidate
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import SOURCE_SECS, add, preview, reviewed
from test_review import candidate_url, patch
from test_segments import SOURCE

SONG = "ef" * 16
SONGS = {SONG: MediaInfo(0, 0, 10.0, True)}
# The Source of the renders' sound: a tone rising from 200 Hz by 300 Hz a second, so that what is
# heard says which moment of the episode it is; and the media Segment's steady tone over it.
SWEEP = (200, 300)
STEADY = 3000


def sweep_at(t: float) -> float:
    return SWEEP[0] + SWEEP[1] * t


def of_source(**fields) -> MusicClip:
    return MusicClip(**{"id": "s", "start": 1.0, "secs": 2.0, "offset": 10.0, **fields})


# Seam B: the planner, and the copies it plays from


def test_a_music_clip_without_media_plays_the_sources_sound_from_its_offset_on_the_sources_timeline():
    [episode, song] = audio_events([of_source(), MusicClip("m", 1.0, 2.0, media=SONG, offset=2.0)], 20, SONGS, source=600)
    assert (episode.media, episode.source, episode.start, episode.end, episode.offset) == (None, True, 1, 3, 10)
    assert episode.time == SegmentTime(10, 12)
    assert (song.media, song.source) == (SONG, False)


def test_a_music_clip_of_the_source_is_cut_where_the_source_ends_and_placed_at_its_speed_as_a_songs():
    # 1 s of the episode is left after 599 s: half a second at 2×.
    assert audio_events([of_source(offset=599)], 20, {}, source=600)[0].end == 2.0
    assert audio_events([of_source(offset=599, speed=2)], 20, {}, source=600)[0].end == 1.5
    [sped] = audio_events([of_source(speed=2)], 20, {}, source=600)
    assert (sped.end, sped.time) == (3, SegmentTime(10, 14, 2))
    # Cut by the Clip at 2 s in Reverse: the end of its part plays first, so it begins later.
    [cut] = audio_events([of_source(speed=2, reverse=True)], 2, {}, source=600)
    assert (cut.end, cut.offset, cut.time) == (2, 12, SegmentTime(12, 14, 2, True))
    # The planner cuts it at the Source's end too.
    planned = plan_render(10, 14, SOURCE, music=[of_source(offset=599, secs=3)], canvas=PORTRAIT)
    assert [(event.start, event.end, event.source) for event in planned.audio] == [(1, 2, True)]


def test_a_music_clip_of_the_source_in_reverse_plays_from_copies_of_the_source_and_names_no_media_item():
    candidate = replace(plain_candidate(0, 30), music=[of_source(reverse=True), MusicClip("m", 4.0, 1.0, media=SONG)])
    assert copies_used([candidate], {SONG: 10.0})[None][-2:] == [(CopySize.FULL, Retime(10, 12)), (CopySize.PREVIEW, Retime(10, 12))]
    assert candidate.media_ids() == {SONG}


# Seam A: the API and MCP


def test_a_music_clip_without_media_is_saved_planned_as_the_sources_and_refused_past_its_end(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    episode = {"id": "s", "start": 0.5, "secs": 1, "offset": 4.0}
    saved = patch(client, job, candidate, music=[episode])
    assert saved["music"][0]["media"] is None
    [event] = preview(client, job, saved)["plan"]["audio"]
    assert {key: event[key] for key in ("media", "source", "start", "end", "offset")} == {
        "media": None, "source": True, "start": 0.5, "end": 1.5, "offset": 4.0,
    }
    for music, message in (
        ([{**episode, "offset": 5.5}], f"Music Clip s runs past the end of the episode ({SOURCE_SECS} s)"),
        ([{**episode, "speed": 2, "offset": 4.5}], f"Music Clip s runs past the end of the episode ({SOURCE_SECS} s) at 2x"),
    ):
        response = client.patch(candidate_url(job, saved), json={"music": music})
        assert response.status_code == 422 and message in response.text, (message, response.text)
        draft = client.post(f"/api/jobs/{job['id']}/candidates/{saved['id']}/preview-plan", json={"music": music})
        assert draft.status_code == 422 and message in draft.text, draft.text
    # Read to its end, in Reverse too.
    assert patch(client, job, saved, music=[{**episode, "offset": 5.0, "reverse": True}])["music"][0]["offset"] == 5.0


@pytest.mark.anyio
async def test_the_agent_adds_a_music_clip_of_the_source_and_the_dry_run_names_it_as_the_sources(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    secs = job["duration"]
    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "s", "start": 0, "secs": 1, "offset": secs - 0.5}])
    assert f"Music Clip s runs past the end of the episode ({secs:g} s)" in message, message
    saved = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "s", "start": 0.2, "secs": 0.5, "offset": 1.0, "speed": 2}])
    assert saved["music"][0]["media"] is None

    [sound] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["sounds"]
    assert {key: sound.get(key) for key in ("id", "media", "source", "start", "end", "source_start", "source_end", "speed")} == {
        "id": "s", "media": None, "source": True, "start": 0.2, "end": 0.7, "source_start": 1.0, "source_end": 2.0, "speed": 2,
    }
    # Listed when it plays as filmed too, unkeyed.
    await call(mcp, "merge_candidate_items", **ids, music=[{"id": "s", "speed": 1}])
    [sound] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["sounds"]
    assert (sound["id"], sound["source"]) == ("s", True)


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def sweeping(tmp_path_factory) -> Path:
    """The renders' Source, as long as test_render's and captioned alike: a test pattern whose sound
    is the SWEEP, at the same level as `steady`'s tone."""
    path = tmp_path_factory.mktemp("sweeping") / "source.mp4"
    lavfi = ("-f", "lavfi", "-i")
    make(
        path, *lavfi, "testsrc2=size=640x360:rate=25",
        *lavfi, f"aevalsrc='0.125*sin(2*PI*({SWEEP[0]}*t+{SWEEP[1] / 2}*t*t))':s=44100",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


@pytest.fixture(autouse=True)
def from_sweeping(video_source, sweeping) -> None:
    video_source.video = sweeping


@pytest.fixture(scope="session")
def steady(tmp_path_factory) -> bytes:
    """A 3 s video of a steady STEADY Hz tone, at the sweep's level."""
    lavfi = ("-f", "lavfi", "-i")
    return make(
        tmp_path_factory.mktemp("steady") / "steady.mp4", *lavfi, "color=c=green:size=320x180:rate=30:duration=3",
        *lavfi, f"sine=frequency={STEADY}:sample_rate=44100:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest",
    )


def test_music_clips_of_the_source_under_a_media_segment_play_their_stretch_of_the_episode_scaled_by_its_own_sound(client, settings, steady):
    """Under a 3 s media Segment of a steady tone, three Music Clips of the episode's 1..2 s: as
    filmed (keyed down to a half), at 2× (its pitch kept) and in Reverse, at half the Clip's own
    sound, which the media Segment's tone isn't, so that it is the measure in the same window."""
    video = upload(client, steady, "steady.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    segments = [
        {"id": "v", "media": video["id"], "start": 0, "end": 3, "framing": {}},
        {"id": "e", "start": candidate["start"], "end": candidate["end"]},
    ]
    music = [
        {"id": "f", "start": 0.2, "secs": 0.6, "offset": 1.0, "keys": {"volume": [{"at": 0.15, "value": 1}, {"at": 0.25, "value": 0.5}]}},
        {"id": "d", "start": 1.2, "secs": 0.5, "offset": 1.0, "speed": 2},
        {"id": "r", "start": 2.0, "secs": 0.8, "offset": 1.0, "reverse": True},
    ]
    candidate = patch(client, job, candidate, segments=segments, music=music, source_volume=0.5)
    path = clip_of(client, settings, job, candidate)

    def level(frequency: float, at: float) -> float:
        # A short window: the sweep moves 6 Hz over it.
        return tone_level(settings, path, frequency, at, secs=0.02)

    def heard(at: float, moment: float, gain: float = 1) -> None:
        """The episode's `moment` is heard at `at`, at `gain` times half the media Segment's tone."""
        ratio = level(sweep_at(moment), at) / level(STEADY, at)
        assert 20 * np.log10(ratio) == pytest.approx(20 * np.log10(0.5 * gain), abs=1.5), (at, moment, ratio)

    # As filmed: the episode's 1.0..1.6 s at 0.2..0.8 s, keyed to a half after its first 0.25 s,
    # and nothing of it before.
    heard(0.3, 1.1)
    heard(0.6, 1.4, gain=0.5)
    assert level(sweep_at(1.0), 0.05) < 0.1 * level(STEADY, 0.05)
    # At 2×: 1.0..2.0 s in half a second, its pitch kept.
    for at in (1.3, 1.55):
        heard(at, 1.0 + 2 * (at - 1.2))
    # In Reverse: 1.8 s back to 1.0 s, not the other way.
    for at in (2.15, 2.6):
        moment = 1.8 - (at - 2.0)
        heard(at, moment)
        assert level(sweep_at(moment), at) > 5 * level(sweep_at(2.8 - moment), at), at
