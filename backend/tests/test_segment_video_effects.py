"""Video Effects on Segments (.scratch/video-effects/issues/02-effects-on-segments.md, ADR 0014): a
Segment's stack over its whole frame, after its Grade and before the joins. Seam B on the planner and
candidate_plan, then Seam A through the API, MCP and the real ffmpeg: what is drawn, where it stops,
and what is refused."""

import subprocess
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Candidate, Segment, manual_candidate
from app.canvas import PORTRAIT
from app.config import CameraTuning, RenderTuning
from app.planner import SegmentInput, plan_render
from app.renderer import Renderer
from app.rendering import candidate_plan
from app.scaled_plan import scaled_plan
from app.styles import PresetStore
from app.video_effects import VideoEffect
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import upload
from test_media_segments import SOURCE
from test_overlay_grades import colours  # noqa: F401
from test_render import add, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import colour_video, frame_at  # noqa: F401
from test_segments import ramp_video, ranges  # noqa: F401

BLUR = VideoEffect("gaussian-blur", {"radius": 6})
OFF = VideoEffect("gaussian-blur", {"radius": 6}, enabled=False)


# Seam B: the planner


def test_a_segments_enabled_effects_reach_its_plan_at_the_frames_own_size():
    planned = plan_render(10, 31, SOURCE, main_track=[
        SegmentInput(10, 12, video_effects=[BLUR]),
        SegmentInput(20, 23, video_effects=[OFF]),
        SegmentInput(25, 25, hold=1.0, video_effects=[BLUR]),
        SegmentInput(30, 31),
    ], canvas=PORTRAIT)
    # A Segment's frame is 1080x1920 at scale 1: its sizes are as given. A Freeze frame takes them too.
    assert [segment.video_effects for segment in planned.segments] == [[BLUR], [], [BLUR], []]


def test_a_candidates_segments_bring_their_stacks_to_the_plan_and_a_smaller_render_scales_them(tmp_path):
    candidate = replace(manual_candidate("c1", 10, 26), segments=[Segment("a", 10, 12, video_effects=[BLUR]), Segment("b", 20, 22)])
    planned = candidate_plan(candidate, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [segment.video_effects for segment in planned.segments] == [[BLUR], []]
    # At 720p, two thirds.
    assert scaled_plan(planned, (720, 1280)).segments[0].video_effects == [VideoEffect("gaussian-blur", {"radius": 4.0})]


def test_a_candidate_saved_before_effects_reads_its_segments_with_none():
    stored = asdict(replace(manual_candidate("c1", 10, 26), segments=[Segment("a", 10, 12), Segment("b", 20, 22)]))
    for segment in stored["segments"]:
        del segment["video_effects"]
    candidate = TypeAdapter(Candidate).validate_python(stored)
    assert [segment.video_effects for segment in candidate.segments] == [[], []]


def test_a_segments_stack_is_checked_with_its_defaults_filled():
    assert Segment("a", 10, 12, video_effects=[VideoEffect("gaussian-blur")]).video_effects == [VideoEffect("gaussian-blur", {"radius": 10.0})]
    with pytest.raises(ValueError, match="Segment a's video_effects\\[1\\] \\(gaussian-blur\\) is already in its stack, at 0"):
        Segment("a", 10, 12, video_effects=[BLUR, OFF])


def audio_filters(*segments: SegmentInput) -> str:
    """The filtergraph the renderer writes for a Clip of `segments` of the Source."""
    plan = plan_render(10, 31, SOURCE, main_track=list(segments), canvas=PORTRAIT)
    out = Path("/out")
    command = Renderer(Path("/usr/bin/ffmpeg"), RenderTuning())._command(
        Path("/jobs/source.mp4"), plan, None, "libx264", out / "v.mp4", out / "p.jpg", out / "s.ass", None, {}
    )
    return command[command.index("-filter_complex") + 1]


def test_a_segment_with_effects_is_not_plain_for_the_concat_fast_path():
    plain = "[0:a:0][1:a:0]concat=n=2:v=0:a=1[src]"
    assert plain in audio_filters(SegmentInput(10, 12), SegmentInput(20, 22))
    blurred = audio_filters(SegmentInput(10, 12, video_effects=[BLUR]), SegmentInput(20, 22))
    assert plain not in blurred and "gblur=sigma=6.000" in blurred


# Seam A: the API and the real ffmpeg


def edge_step(frame: np.ndarray) -> float:
    """The largest step in red minus green across the grey-to-red edge of a picture fitted across the
    frame (about x 540), along the rows 880 to 1040."""
    band = frame[880:1040, 380:700].astype(float)
    redness = (band[..., 0] - band[..., 1]).mean(axis=0)
    return float(np.abs(np.diff(redness)).max())


def test_a_blurred_source_segment_softens_its_frame_and_stops_at_its_edge(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    candidate = patch(client, job, candidate, layout="blur", segments=[first, second])
    blurred = [first | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 20}}]}, second]
    planned = preview(client, job, candidate, {"segments": blurred})["plan"]
    [one, two] = [(segment["start"] + segment["end"]) / 2 for segment in planned["segments"]]
    sharp = edge_step(frame_at(client, settings, job, candidate, one))
    soft = edge_step(frame_at(client, settings, job, candidate, one, segments=blurred))
    assert sharp > 40 and soft < sharp / 4, (sharp, soft)
    # The next Segment is as sharp as it was.
    after = edge_step(frame_at(client, settings, job, candidate, two, segments=blurred))
    assert after > sharp * 0.8, (sharp, after)


def test_a_blurred_media_segment_softens_its_frame(client, settings, video_source, colour_video, colours):
    video_source.video = colour_video
    item = upload(client, colours["video"], "halves.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [episode] = ranges(job, ("kita", "soal"))
    shown = {"id": "m", "start": 0.0, "end": 1.5, "media": item["id"], "framing": {}}
    candidate = patch(client, job, candidate, segments=[shown, episode])
    sharp = edge_step(frame_at(client, settings, job, candidate, 0.5))
    blurred = [shown | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 20}}]}, episode]
    soft = edge_step(frame_at(client, settings, job, candidate, 0.5, segments=blurred))
    assert sharp > 40 and soft < sharp / 4, (sharp, soft)


def lumas(settings, video: Path) -> np.ndarray:
    """Each frame's mean brightness, in order."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", "scale=54:96,format=gray", "-f", "rawvideo", "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(-1, 96 * 54).astype(float).mean(axis=1)


def test_a_blurred_segment_between_plain_ones_keeps_its_timing_at_a_join_and_under_a_transition(client, settings, video_source, ramp_video):
    # The ramp's frames are flat, so a blur leaves them as they are and only a frame out of its time differs.
    video_source.video = ramp_video
    job = reviewed(client)
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    blurred = [pieces[0], pieces[1] | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 12}}]}, pieces[2]]
    fade = [{"after": "s0", "kind": "fade", "secs": 0.4}]
    plain = patch(client, job, add(client, job, "halo", "ya"), layout="blur", segments=pieces, transitions=fade)
    effected = patch(client, job, add(client, job, "halo", "ya"), layout="blur", segments=blurred, transitions=fade)
    assert [s["end"] for s in preview(client, job, plain)["plan"]["segments"]] == [s["end"] for s in preview(client, job, effected)["plan"]["segments"]]
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=90)["clips"]}
    job_dir = settings.data_dir / "jobs" / job["id"]
    drawn = {}
    for candidate in (plain, effected):
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        drawn[candidate["id"]] = lumas(settings, job_dir / clip["output"]["video"])
    before, after = drawn[plain["id"]], drawn[effected["id"]]
    assert len(before) == len(after)
    # The joins (luma jumps with the Source's time) are on the same frames.
    assert np.abs(before - after).max() < 1.5, np.abs(before - after).max()


def test_a_stack_keeps_a_lone_segment_and_a_bad_one_is_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    whole = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}
    # One Segment of the Source as filmed, with a stack (even all off), is kept as its Segment.
    saved = patch(client, job, candidate, segments=[whole | {"video_effects": [{"id": "gaussian-blur", "enabled": False}]}])
    assert saved["segments"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 10}, "enabled": False}]
    assert patch(client, job, saved, segments=[whole])["segments"] == []
    response = client.patch(candidate_url(job, saved), json={"segments": [whole | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 0}}]}]})
    assert response.status_code == 422 and "Segment e's video_effects[0] (gaussian-blur) radius is 0; it is 1 to 50" in response.text


# MCP


@pytest.mark.anyio
async def test_the_agent_sets_a_segments_stack_sees_it_in_the_dry_run_and_is_refused_a_bad_one(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [
        {"id": "a", "start": 1.0, "end": 1.6, "volume": 0.5, "video_effects": [{"id": "gaussian-blur"}]},
        {"id": "b", "start": 0.1, "end": 0.9},
    ]})
    # A merge replaces a Segment's stack as a whole, its other fields kept.
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "video_effects": [{"id": "gaussian-blur", "params": {"radius": 30}}]}])
    assert merged["segments"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 30}, "enabled": True}]
    assert merged["segments"][0]["volume"] == 0.5

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    blurred, plain = plan["segments"]
    # At the frame's size, unscaled.
    assert blurred["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 30}}]
    assert "video_effects" not in plain

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "video_effects": [{"id": "swirl"}]}])
    assert "Segment a's video_effects[0]: there is no video effect 'swirl'" in message, message
    assert "A Segment's `video_effects`" in mcp.instructions
