"""Keyed volume (.scratch/keyframes/issues/03-keyed-volume.md): a Music Clip's volume, and an
Overlay video's sound, with Keyframes. Seam K on the linear steps a keyed volume is rendered by,
Seam B on the planner's gain track, then Seam A through the API, MCP and the real ffmpeg."""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.candidates import EASE_IN, EASE_IN_OUT, Ease, Keyframe, MusicClip, Overlay
from app.keyframes import linear_steps, value_at
from app.planner import MediaInfo, audio_events, overlay_events, overlay_sound
from test_keyframes import clip_of, stills  # noqa: F401
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SONG = "ef" * 16
CLIP = "ab" * 16
SONGS = {SONG: MediaInfo(0, 0, 30.0, True)}
DIP = [Keyframe(1.0, 1.0), Keyframe(2.0, 0.25, EASE_IN)]


# Seam K: the steps a keyed volume is rendered by


@pytest.mark.parametrize("ease", [EASE_IN, EASE_IN_OUT, Ease(0.34, 1.56, 0.64, 1)], ids=["in", "in_out", "overshoot"])
def test_an_eased_span_is_24_linear_steps_within_0_6_percent_of_its_change(ease):
    keys = [Keyframe(0.5, 1.0), Keyframe(1.5, 0.25, ease), Keyframe(3.0, 1.75)]
    steps = linear_steps(keys)
    # The eased span in 24 steps, the linear one in one; the ends are the Keyframes'.
    assert len(steps) == 1 + 24 + 1
    assert (steps[0], steps[-1]) == ((0.5, 1.0), (3.0, 1.75))

    def stepped(time: float) -> float:
        times, values = zip(*steps)
        return float(np.interp(time, times, values))

    for time in np.linspace(0, 3.5, 2001):
        assert abs(stepped(time) - value_at(keys, time, 0)) <= 0.006 * 0.75, time
    assert linear_steps([Keyframe(1.0, 0.5)]) == [(1.0, 0.5)]


# Seam B: the planner


def test_a_music_clips_volume_keyframes_are_its_sound_events_gain_track_in_its_own_seconds():
    clip = MusicClip("m", SONG, 3.0, 4.0, volume=0.5, fade_in=0.5, fade_out=1.0, keys={"volume": DIP})
    [event] = audio_events([clip], 10, SONGS)
    # Seconds from the event's start, as the Keyframes are from the Music Clip's.
    assert (event.id, event.start, event.gain) == ("m", 3.0, DIP)
    [still] = audio_events([MusicClip("m", SONG, 3.0, 4.0, volume=0.5)], 10, SONGS)
    assert still.gain == []
    # How loud the track is heard, through its fades: test_gain.py's shared cases ("keyed and faded").


def test_an_overlay_videos_volume_keyframes_are_its_sounds_gain_track_and_not_its_motion():
    items = {CLIP: MediaInfo(640, 360, 10.0, True)}
    # Muted but for its Keyframes, which bring it up.
    overlay = Overlay("o", CLIP, 2.0, 3.0, keys={"volume": DIP})
    [sound] = overlay_sound([overlay], 10, items)
    assert (sound.id, sound.start, sound.end, sound.gain) == ("o", 2.0, 5.0, DIP)
    [event] = overlay_events([overlay], 10, items)
    assert event.picture.motion == {}
    assert overlay_sound([Overlay("o", CLIP, 2.0, 3.0)], 10, items) == []


# Seam A: the API and MCP


@pytest.fixture(scope="session")
def songs(tmp_path_factory) -> dict[str, bytes]:
    """5 s of an 880 Hz tone, and a 3 s video of a 1500 Hz one."""
    folder = tmp_path_factory.mktemp("keyed-volume")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "tone": make(folder / "tone.wav", *lavfi, "sine=frequency=880:sample_rate=44100:duration=5"),
        "talk": make(folder / "talk.mp4", *lavfi, "color=c=green:size=320x180:rate=30:duration=3", *lavfi,
                     "sine=frequency=1500:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
    }


def test_volume_keyframes_are_kept_on_music_and_a_video_overlay_and_refused_on_an_image_or_out_of_range(client, songs, stills):
    tone = upload(client, songs["tone"], "tone.wav").json()
    talk = upload(client, songs["talk"], "talk.mp4").json()
    blue = upload(client, stills["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    dip = [{"at": 0, "value": 1}, {"at": 1, "value": 0.25, "ease": "ease_in"}]
    music = {"id": "m", "media": tone["id"], "start": 0.0, "secs": 2.0, "keys": {"volume": dip}}
    overlay = {"id": "o", "media": talk["id"], "start": 0.0, "secs": 2.0, "keys": {"volume": dip}}
    candidate = patch(client, job, candidate, music=[music], overlays=[overlay])
    stored = [{"at": 0, "value": 1, "ease": [0, 0, 1, 1]}, {"at": 1, "value": 0.25, "ease": [0.42, 0, 1, 1]}]
    assert candidate["music"][0]["keys"] == {"volume": stored} and candidate["overlays"][0]["keys"] == {"volume": stored}

    for change, message in (
        ({"overlays": [{**overlay, "media": blue["id"]}]}, "Overlay o has no volume Keyframes: an image has no sound"),
        ({"music": [{**music, "keys": {"volume": [{"at": 0, "value": 2.5}]}}]}, "Music Clip m's volume Keyframe at 0 s is 2.5; volume is 0 to 2"),
        ({"music": [{**music, "keys": {"scale": [{"at": 0, "value": 1}]}}]}, "Music Clip m has no scale Keyframes: its volume can be keyed"),
        ({"music": [{**music, "secs": 0.5}]}, "Music Clip m's volume Keyframe at 1 s is past its length of 0.5 s"),
    ):
        response = client.patch(candidate_url(job, candidate), json=change)
        assert response.status_code == 422 and message in response.text, (change, response.text)


@pytest.mark.anyio
async def test_the_agent_keys_a_songs_volume_by_property_and_dry_runs_it_in_timeline_time(mcp, tmp_path):
    song = tmp_path / "song.wav"
    make(song, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    item = await call(mcp, "add_asset", kind="media", path=str(song))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    dip = {"volume": [{"at": 0.2, "value": 1}, {"at": 0.8, "value": 0.3, "ease": "ease_out"}]}
    await call(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "media": item["id"], "start": 0.5, "secs": 1, "keys": dip}])
    # Merged by property, as an Overlay's are: a change of another field keeps them.
    merged = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "fade_in": 0.1}])
    assert merged["music"][0]["keys"]["volume"][1]["ease"] == [0, 0, 0.58, 1]
    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "secs": 0.7}])
    assert "Music Clip m's volume Keyframe at 0.8 s is past its length of 0.7 s; send its keys too" in message, message

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["sounds"] == [{
        "id": "m", "media": item["id"], "start": 0.5, "end": 1.5,
        "keys": {"volume": [{"at": 0.7, "value": 1, "ease": "linear"}, {"at": 1.3, "value": 0.3, "ease": "ease_out"}]},
    }]
    merged = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "keys": {"volume": []}}])
    assert merged["music"][0]["keys"] == {}
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert "sounds" not in plan


# Seam A: the real ffmpeg


def tone_level(settings, video: Path, frequency: float, start: float, secs: float = 0.05) -> float:
    """The amplitude of the Clip's sound at `frequency` over `secs` from `start`, in 8 kHz mono: a
    whole number of its cycles, so that other tones of the same kind don't leak into it."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]
    samples = np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.int16).astype(float)
    first, count = round(start * 8000), round(secs * 8000)
    window = samples[first : first + count]
    phase = np.exp(-2j * np.pi * frequency * np.arange(count) / 8000)
    return 2 * abs((window * phase).sum()) / count


def test_a_tone_keyed_from_1_to_a_quarter_is_as_loud_as_its_sampled_gain_with_its_fade_in(client, settings, video_source, plain_video, songs):
    """The Source's own 440 Hz tone stays as it is, so that the Clip's loudness hardly changes and is
    normalized linearly; the song's 880 Hz tone follows its Keyframes."""
    video_source.video = plain_video
    tone = upload(client, songs["tone"], "tone.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    assert candidate["end"] - candidate["start"] > 2.2
    dip = [{"at": 1, "value": 1}, {"at": 2, "value": 0.25, "ease": "ease_in"}]
    music = {"id": "m", "media": tone["id"], "start": 0.0, "secs": 2.2, "fade_in": 0.5, "keys": {"volume": dip}}
    candidate = patch(client, job, candidate, music=[music])
    video = clip_of(client, settings, job, candidate)

    keys = [Keyframe(1.0, 1.0), Keyframe(2.0, 0.25, EASE_IN)]

    def heard(start: float, secs: float = 0.05) -> float:
        """The gain the song is heard at over `secs` from `start`, as an RMS of its sampled values."""
        times = np.linspace(start, start + secs, 101)
        gains = [value_at(keys, time, 0) * min(time / 0.5, 1.0) for time in times]
        return float(np.sqrt(np.mean(np.square(gains))))

    full = tone_level(settings, video, 880, 0.7)
    for start in (1.475, 0.225, 1.8):
        level = tone_level(settings, video, 880, start)
        error = 20 * np.log10(level / full) - 20 * np.log10(heard(start) / heard(0.7))
        assert abs(error) <= 0.5, (start, level / full, heard(start))
    # At the midpoint the Ease is heard, not a straight line (0.625 there, 1.75 dB quieter).
    assert heard(1.475) == pytest.approx(0.76, abs=0.01)
