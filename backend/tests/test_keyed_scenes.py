"""Keyed Manual Scenes (.scratch/keyframes/issues/05-keyed-manual-scene.md): Seam B on the planner,
then Seam A through the API, MCP and the real ffmpeg: a Manual Layout Override's Framing that moves,
its Keyframes in seconds from its Scene's start on the Source's timeline, so that every Segment
showing the Scene shows the same motion at the same moments of the Source."""

import subprocess

import numpy as np
import pytest

from app.candidates import Background, BackgroundKind, Framing, Keyframe, KeyProperty, Layout, LayoutOverride, Transform
from app.config import load_settings
from app.keyframes import value_at
from app.pictures import cover_scale
from app.canvas import PORTRAIT
from app.planner import Scene, SceneLayout, SegmentInput, plan_render
from test_keyframes import clip_of
from test_manual_layout import SOURCE
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, full_frame, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

OVER_BLUE = Framing(Transform(scale=0.5), background=Background(BackgroundKind.COLOUR, "#0000FF"))
OVER_BLUE_JSON = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#0000FF"}}
# From x 300 to 800 over the Scene's first 4 s.
PAN = {KeyProperty.X: [Keyframe(0, 300), Keyframe(4, 800)]}


def by_hand(at: float, keys: dict = PAN, framing: Framing = OVER_BLUE) -> LayoutOverride:
    return LayoutOverride(at, Layout.MANUAL, framing, keys)


# Seam B: the planner


def test_a_manual_scenes_keyframes_come_out_in_timeline_time_in_every_segment_that_shows_its_scene():
    # The Source from 10 s to 20 s, cut at 12 s: the override (at 15 s) frames the shot from 12 s.
    whole = SegmentInput(10, 20, scenes=[Scene(0, 2), Scene(2, 10)], layout_overrides=[by_hand(5)])
    # Starting 2 s into that shot, and shown twice.
    later = SegmentInput(14, 18, scenes=[Scene(0, 4)], layout_overrides=[by_hand(1)])
    planned = plan_render(10, 20, SOURCE, main_track=[whole, later, whole], canvas=PORTRAIT)
    [_, first, middle, _, again] = planned.scenes
    assert {first.layout, middle.layout, again.layout} == {SceneLayout.MANUAL}
    # In Timeline time, from where the shot starts: 2 s in, 10 s less 2, and 14 s plus 2.
    xs = lambda scene: [(key.at, key.value) for key in scene.picture.motion[KeyProperty.X]]  # noqa: E731
    assert xs(first) == [(2, 300), (6, 800)]
    assert xs(again) == [(16, 300), (20, 800)]
    # The later Segment shows the motion from 2 s into it, its Keyframe before it kept in the track.
    assert (middle.start, middle.keys_from, xs(middle)) == (10, 8, [(8, 300), (12, 800)])
    assert value_at(middle.picture.motion[KeyProperty.X], middle.start, 0) == 550
    # Its Background is still drawn: the picture doesn't cover the frame.
    assert middle.colour == "#0000FF"


def test_a_manual_scene_covering_the_frame_throughout_has_no_background_and_its_keyframes_past_its_end_are_ignored():
    cover = cover_scale(1920, 1080, PORTRAIT.size)
    push = {KeyProperty.SCALE: [Keyframe(0, cover + 0.1), Keyframe(2, cover + 0.5), Keyframe(9, 1)]}
    [scene] = plan_render(100, 103, SOURCE, layout_overrides=[by_hand(1, push, Framing())], canvas=PORTRAIT).scenes
    # The 3 s Scene never reaches its Keyframe at 9 s, which is left out of its track.
    assert [key.at for key in scene.picture.motion[KeyProperty.SCALE]] == [0, 2]
    assert scene.ignored == {KeyProperty.SCALE: [Keyframe(9, 1)]}
    assert (scene.panels, scene.colour) == ([], None)
    # The Candidate's own Manual Framing and an unkeyed override stay still.
    for planned in (plan_render(100, 103, SOURCE, layout=Layout.MANUAL, framing=OVER_BLUE, canvas=PORTRAIT), plan_render(100, 103, SOURCE, layout_overrides=[by_hand(1, {})], canvas=PORTRAIT)):
        [still] = planned.scenes
        assert still.layout is SceneLayout.MANUAL and not still.picture.motion


# Seam A: the API and MCP


def test_keyframes_on_a_manual_override_are_kept_and_on_any_other_or_the_candidates_framing_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya", selected=False)
    at = candidate["start"] + 0.5
    framing = {"transform": {"scale": 0.5}}
    # Its Scene's length isn't known here: any `at` from 0 is kept.
    pan = {"x": [{"at": 0, "value": 300}, {"at": 30, "value": 800, "ease": "ease_out"}]}
    saved = patch(client, job, candidate, layout_overrides=[{"at": at, "layout": "manual", "framing": framing, "keys": pan}])
    assert saved["layout_overrides"][0]["keys"]["x"][1] == {"at": 30, "value": 800, "ease": [0, 0, 0.58, 1]}

    manual_with = lambda keys: {"layout_overrides": [{"at": at, "layout": "manual", "framing": framing, "keys": keys}]}  # noqa: E731
    for change, message in (
        ({"layout_overrides": [{"at": at, "layout": "track", "keys": pan}]}, "has no Keyframes: only a Manual one's framing can be keyed"),
        (manual_with({"volume": [{"at": 0, "value": 1}]}), "has no volume Keyframes"),
        (manual_with({"x": [{"at": -1, "value": 1}]}), "greater than or equal to 0"),
        ({"layout": "manual", "framing": framing | {"keys": pan}}, "The Candidate's own framing has no Keyframes"),
    ):
        response = client.patch(candidate_url(job, saved), json=change)
        assert response.status_code == 422 and message in response.text, (change, response.text)


@pytest.mark.anyio
async def test_the_agent_keys_a_manual_scene_and_the_dry_run_lists_its_keyframes_past_its_scenes_end_as_ignored(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    at = candidate["start"] + 0.5
    pan = {"x": [{"at": 0, "value": 300}, {"at": 1, "value": 800, "ease": "ease_in"}, {"at": 20, "value": 100}]}
    await call(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "layout": "manual", "framing": {}, "keys": pan}])
    # Merged by property, as an Overlay's are.
    merged = await call(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "keys": {"opacity": [{"at": 0, "value": 0.5}]}}])
    assert set(merged["layout_overrides"][0]["keys"]) == {"x", "opacity"}
    # Neither the Candidate's own Framing nor another Layout has any.
    await call(mcp, "edit_candidate", **ids, changes={"layout": "manual", "framing": {}})
    assert "The Candidate's own framing has no Keyframes" in await fails(mcp, "merge_candidate_items", **ids, framing={"keys": pan})
    message = await fails(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "layout": "blur", "framing": None}])
    assert "has no Keyframes: only a Manual one's framing can be keyed" in message, message

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [scene] = plan["scenes"]
    # The one Scene starts the Clip: its Keyframes at their `at`, but for the one past its end.
    assert scene["keys"] == {
        "x": [{"at": 0, "value": 300, "ease": "linear"}, {"at": 1, "value": 800, "ease": "ease_in"}],
        "opacity": [{"at": 0, "value": 0.5, "ease": "linear"}],
    }
    assert scene["ignored"] == {"x": [{"at": 20, "value": 100, "ease": "linear"}]}
    assert [view["at"] for view in scene["bounds_at_keys"]] == [0, 1]


# Seam A: the real ffmpeg


RED = np.array([255, 0, 0])


@pytest.fixture(scope="session")
def red_source(tmp_path_factory):
    path = tmp_path_factory.mktemp("red") / "red.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
    ]
    subprocess.run(command, check=True)
    return path


def red_middle(frame: np.ndarray) -> float:
    """Where the red Source is across the frame's middle row: at scale 0.5, 640x360 is 540 px wide."""
    across = np.nonzero(np.abs(frame[960] - RED).max(axis=1) <= 60)[0]
    assert abs(len(across) - 540) <= 4, len(across)
    return float(across.mean())


def keyed_x(keys: list[dict], at: float) -> float:
    return value_at([Keyframe(key["at"], key["value"]) for key in keys], at, 0)


def test_a_manual_scene_keyed_in_x_draws_the_source_where_its_keyframes_put_it(client, settings, video_source, red_source):
    video_source.video = red_source
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    pan = [{"at": 0, "value": 300}, {"at": 3, "value": 800}]
    override = {"at": words["kabar"]["start"], "layout": "manual", "framing": OVER_BLUE_JSON, "keys": {"x": pan}}
    candidate = patch(client, job, candidate, layout_overrides=[override])
    [scene] = preview(client, job, candidate)["plan"]["scenes"]
    assert scene["picture"]["motion"]["x"] and scene["keys_from"] == 0
    video = clip_of(client, settings, job, candidate)
    # The Clip is at the Source's 25 fps: frames at 0.52 s and 2.52 s, the blue Background above it.
    for at in (0.52, 2.52):
        frame = full_frame(settings, video, at)
        assert abs(red_middle(frame) - keyed_x(pan, at)) <= 2, (at, red_middle(frame), keyed_x(pan, at))
        assert np.abs(frame[200, 540] - [0, 0, 255]).max() < 40


def test_a_segment_starting_part_way_into_a_keyed_manual_scene_shows_its_motion_from_there(client, settings, video_source, red_source):
    video_source.video = red_source
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    pan = [{"at": 0, "value": 300}, {"at": 4, "value": 800}]
    override = {"at": words["soal"]["start"], "layout": "manual", "framing": OVER_BLUE_JSON, "keys": {"x": pan}}
    # The whole range, then again from "kita": both show the override's Scene.
    whole = {"id": "a", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    later = {"id": "b", "start": words["kita"]["start"], "end": words["ya"]["end"]}
    candidate = patch(client, job, candidate, segments=[whole, later], layout_overrides=[override])
    planned = preview(client, job, candidate)["plan"]
    [first, second] = planned["scenes"]
    [a, b] = planned["segments"]
    # In the second Segment, its Keyframes count from where the first starts the Scene.
    assert first["keys_from"] == 0
    assert second["keys_from"] == pytest.approx(b["start"] - (b["source_start"] - a["source_start"]), abs=1e-3)
    video = clip_of(client, settings, job, candidate)
    for at, scene in ((0.52, first), (b["start"] + 0.32, second)):
        frame = full_frame(settings, video, at)
        shown = keyed_x(pan, at - scene["keys_from"])
        assert abs(red_middle(frame) - shown) <= 2, (at, red_middle(frame), shown)
