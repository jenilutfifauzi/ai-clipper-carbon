"""A sped media Segment (.scratch/speed/issues/02-sped-media-segment.md): Seam B on the planner and
the sound's speed chain, then Seam A through the API, MCP and the real ffmpeg: a video's Segment
played at a Speed, picture and sound, its pitch kept or changed, its volume Keyframes in Timeline
seconds."""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.candidates import Framing, KeyProperty
from app.pictures import cover_scale
from app.canvas import PORTRAIT
from app.planner import SegmentInput, plan_render
from app.renderer import tempo_stages
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_media_segments import SOURCE
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import SOURCE_SECS, add, preview, probe, reviewed
from test_review import candidate_url, patch

VIDEO = "ab" * 16
# The counter video at 30 fps (the Media Library's rate), its luma STEP more each frame, and its tone.
FPS, STEP, TONE = 30, 3, 1000
COVER = {"transform": {"scale": cover_scale(640, 360, PORTRAIT.size)}}


@pytest.fixture(scope="session")
def counter(tmp_path_factory) -> bytes:
    """A 2.5 s 640x360 video at FPS whose picture brightens by STEP each frame (a frame counter),
    with a 1 kHz tone."""
    lavfi = ("-f", "lavfi", "-i")
    return make(
        tmp_path_factory.mktemp("counter") / "counter.mp4",
        *lavfi, f"color=c=black:size=640x360:rate={FPS}:duration=2.5,format=yuv420p,geq=lum='16+N*{STEP}':cb=128:cr=128",
        *lavfi, f"sine=frequency={TONE}:duration=2.5",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac", "-shortest",
    )


@pytest.fixture(scope="session")
def source_at_30(tmp_path_factory) -> Path:
    """The Source Seam A renders from: a test pattern with a 440 Hz tone, at the counter's rate."""
    lavfi = ("-f", "lavfi", "-i")
    path = tmp_path_factory.mktemp("source") / "source.mp4"
    make(path, *lavfi, f"testsrc2=size=320x180:rate={FPS}", *lavfi, "sine=frequency=440", "-t", str(SOURCE_SECS), "-c:v", "libx264", "-c:a", "aac")
    return path


@pytest.fixture(autouse=True)
def from_source_at_30(video_source, source_at_30) -> None:
    """Clips at the counter's rate, so that each of their frames is one of its frames."""
    video_source.video = source_at_30


# Seam B: the planner and the sound's speed chain


def test_a_sped_media_segment_lasts_its_range_divided_by_its_speed_and_the_next_follows_it():
    planned = plan_render(
        10, 12, SOURCE,
        main_track=[
            SegmentInput(0, 3, media=VIDEO, width=640, height=360, framing=Framing(), speed=2, pitch=True, id="v"),
            SegmentInput(10, 12, id="e"),
        ], canvas=PORTRAIT,
    )
    sped, episode = planned.segments
    assert (sped.start, sped.end, sped.source_start, sped.source_end, sped.speed, sped.pitch) == (0, 1.5, 0, 3, 2, True)
    assert (episode.start, episode.end) == (1.5, 3.5)
    assert planned.scenes[0].end == 1.5


@pytest.mark.parametrize(
    ("speed", "stages"),
    [(1.5, [1.5]), (4, [2, 2]), (0.25, [0.5, 0.5]), (16, [2, 2, 2, 2]), (0.0625, [0.5, 0.5, 0.5, 0.5]), (3, [2, 1.5])],
)
def test_atempo_stages_each_within_half_and_twice_make_the_speed(speed, stages):
    assert tempo_stages(speed) == pytest.approx(stages)


# Seam A: the API and MCP


def test_speed_and_pitch_are_saved_and_a_speed_out_of_range_or_too_short_long_or_stranding_a_keyframe_is_refused(client, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    sped = {"id": "v", "start": 0, "end": 2, "media": video["id"], "framing": {}, "speed": 2, "pitch": True}
    saved = patch(client, job, candidate, segments=[sped, episode])
    assert (saved["segments"][0]["speed"], saved["segments"][0]["pitch"]) == (2, True)
    assert (saved["segments"][1]["speed"], saved["segments"][1]["pitch"]) == (1, False)
    planned = preview(client, job, saved)["plan"]
    assert planned["segments"][0]["end"] == 1

    zoom = {"scale": [{"at": 0, "value": 1}, {"at": 1.5, "value": 2}]}
    for segments, message in (
        ([sped | {"speed": 0.06}, episode], "greater than or equal to 0.0625"),
        ([sped | {"speed": 17}, episode], "less than or equal to 16"),
        # 1 s of its video at 16× lasts 0.0625 s in the Clip.
        ([sped | {"end": 1, "speed": 16}, episode], "A video's Segment lasts 0.1 s at least"),
        # Six of 2 s at 1/16 last 192 s.
        ([*({**sped, "id": f"v{i}", "speed": 0.0625} for i in range(6)), episode], "A clip can last at most 180 s"),
        # Its Keyframe at 1.5 s, past its 1 s at 2×.
        ([sped | {"keys": zoom}, episode], "Segment v's scale Keyframe at 1.5 s is past its length of 1 s; send its keys too"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": segments})
        assert response.status_code == 422 and message in response.text, (message, response.text)


@pytest.mark.anyio
async def test_the_agent_speeds_a_segment_up_with_its_keys_and_moves_a_text_layer_after_its_timeline_span(mcp, counter, tmp_path):
    path = tmp_path / "counter.mp4"
    path.write_bytes(counter)
    item = await call(mcp, "add_asset", kind="media", path=str(path))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    episode = {"id": "e", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    zoom = {"scale": [{"at": 0, "value": 1}, {"at": 1.5, "value": 2}]}
    video = {"id": "v", "start": 0, "end": 2, "media": item["id"], "framing": {}, "keys": zoom}
    # Over the episode, from its start.
    after = {"id": "t", "text": "Next", "start": 2, "secs": 1}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [video, episode], "text_layers": [after]})

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "speed": 2}])
    assert "Segment v's scale Keyframe at 1.5 s is past its length of 1 s; send its keys too" in message, message
    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "speed": 20}])
    assert "less than or equal to 16" in message, message
    # Its keys sent with it, at old / new speed: the zoom ends on the same frame of its video.
    halved = {"scale": [{"at": 0, "value": 1}, {"at": 0.75, "value": 2}]}
    saved = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "speed": 2, "pitch": True, "keys": halved}])
    shown = saved["segments"][1]

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    sped, played = plan["segments"]
    assert sped == {"id": "v", "media": item["id"], "start": 0, "end": 1, "source_start": 0, "source_end": 2, "speed": 2, "pitch": True,
                    "words_status": "none"}  # a video without sound has no Media Words
    assert played == {
        "id": "e", "start": 1, "end": round(1 + shown["end"] - shown["start"], 2),
        "source_start": round(shown["start"], 2), "source_end": round(shown["end"], 2), "words_status": "transcript",
    }
    assert plan["scenes"][0]["keys"]["scale"][1]["at"] == 0.75
    # The Text Layer over the episode is moved to where it starts now, a second earlier.
    await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "t", "start": played["start"]}])
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    assert plan["text_layers"][0]["start"] == played["start"]


# Seam A: the real ffmpeg


def centre_luma(settings, video: Path) -> np.ndarray:
    """The mean luma of a patch in the middle of each of the Clip's frames."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-i", str(video),
        "-vf", "crop=200:200:440:860,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-",
    ]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.uint8).astype(float)


def frames(start: float, end: float, fps: float) -> np.ndarray:
    """The Clip's frames from `start` to `end` seconds into it, a frame in from each end."""
    return np.arange(round(start * fps) + 1, round(end * fps) - 1)


def test_a_media_segment_at_2x_plays_in_half_the_time_and_shows_every_other_frame_keyed_or_not(client, settings, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    # Keyed, its picture is drawn by a frame process from its own decode of the video.
    still = {"scale": [{"at": 0, "value": COVER["transform"]["scale"]}, {"at": 1, "value": COVER["transform"]["scale"]}]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "once", "start": 0, "end": 1, "media": video["id"], "framing": COVER},
        {"id": "twice", "start": 0, "end": 2, "media": video["id"], "framing": COVER, "speed": 2},
        {"id": "keyed", "start": 0, "end": 2, "media": video["id"], "framing": COVER, "speed": 2, "keys": still},
        {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]},
    ])
    planned = preview(client, job, candidate)["plan"]
    once, twice, keyed, episode = planned["segments"]
    assert (once["end"], twice["start"], twice["end"], keyed["end"]) == (1, 1, 2, 3)
    assert planned["fps"] == FPS
    clip = clip_of(client, settings, job, candidate)
    assert float(probe(settings, clip)["format"]["duration"]) == pytest.approx(episode["end"], abs=0.1)

    lumas = centre_luma(settings, clip)
    # At 1×, the counter's next frame each frame; at 2×, the one after, from its first frame on.
    normal = np.diff(lumas[frames(0, 1, FPS)]).mean()
    for start in (1, 2):
        sped = np.diff(lumas[frames(start, start + 1, FPS)])
        assert len(sped) > 20 and (np.abs(sped - 2 * normal) <= normal / 2).all(), (start, normal, sped)
        assert lumas[start * FPS + 1] == pytest.approx(lumas[2], abs=1.5), (start, lumas[start * FPS : start * FPS + 2], lumas[2])


def test_at_half_speed_the_pitch_is_kept_or_falls_with_it(client, settings, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "kept", "start": 0, "end": 1, "media": video["id"], "framing": COVER, "speed": 0.5},
        {"id": "tape", "start": 0, "end": 1, "media": video["id"], "framing": COVER, "speed": 0.5, "pitch": True},
        {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]},
    ])
    kept, tape, _ = preview(client, job, candidate)["plan"]["segments"]
    assert (kept["end"], tape["end"]) == (2, 4)
    clip = clip_of(client, settings, job, candidate)
    for at in (0.6, 1.2):
        assert tone_level(settings, clip, TONE, at) > 10 * tone_level(settings, clip, TONE / 2, at), at
        assert tone_level(settings, clip, TONE / 2, at + 2) > 10 * tone_level(settings, clip, TONE, at + 2), at


@pytest.mark.parametrize(("speed", "span"), [(1.5, 1.5), (4, 2), (0.25, 0.5)])
def test_the_soundtrack_is_as_long_as_the_picture_at_a_speed(client, settings, counter, speed, span):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "v", "start": 0, "end": span, "media": video["id"], "framing": COVER, "speed": speed},
        {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]},
    ])
    sped, episode = preview(client, job, candidate)["plan"]["segments"]
    assert sped["end"] == pytest.approx(span / speed, abs=0.001)
    clip = clip_of(client, settings, job, candidate)
    streams = {stream["codec_type"]: float(stream["duration"]) for stream in probe(settings, clip)["streams"]}
    assert streams["video"] == pytest.approx(episode["end"], abs=0.08)
    assert streams["audio"] == pytest.approx(streams["video"], abs=0.08), streams
    # The sped tone, then the episode's own 440 Hz one where the Timeline puts it.
    for at, heard, other in ((sped["end"] - 0.2, TONE, 440), (sped["end"] + 0.2, 440, TONE), (episode["end"] - 0.2, 440, TONE)):
        assert tone_level(settings, clip, heard, at) > 10 * tone_level(settings, clip, other, at), at


def test_volume_keyframes_on_a_2x_media_segment_are_heard_at_their_timeline_seconds(client, settings, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    # Silent from 0.55 s into it on the Timeline: 1.1 s into its video.
    cut = {KeyProperty.VOLUME.value: [{"at": 0.5, "value": 1}, {"at": 0.55, "value": 0}]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "v", "start": 0, "end": 2, "media": video["id"], "framing": COVER, "speed": 2, "keys": cut},
        {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]},
    ])
    clip = clip_of(client, settings, job, candidate)
    full = tone_level(settings, clip, TONE, 0.15)
    assert tone_level(settings, clip, TONE, 0.4) == pytest.approx(full, rel=0.2)
    assert tone_level(settings, clip, TONE, 0.75) < full * 0.05
