"""The Manual Layout: the Source framed by hand with a Framing, for one Scene (a Layout Override) or
for the whole Candidate (.scratch/transform-crop/issues/04-manual-layout.md, ADR 0007).

Seam B on the planner, then Seam A through the API, the real ffmpeg and MCP.
"""

import json
import subprocess

import numpy as np
import pytest

from app.analysis import Analyzer
from app.candidates import Background, BackgroundKind, Crop, Framing, Layout, LayoutOverride, Transform
from app.pictures import cover_scale
from app.canvas import PORTRAIT as NINE_SIXTEEN
from app.planner import Box, FrameFaces, Scene, SceneLayout, on_frame, picture_of, plan_render
from app.video_source import SourceMetadata
from test_mcp import HALO_KABAR, call, fails, manual
# The MCP client the MCP tests use.
from test_mcp import anyio_backend, mcp  # noqa: F401
from test_mcp import reviewed as mcp_reviewed
from test_planner import face, people, sampled
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import face_then_two, from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SOURCE = SourceMetadata(duration=600, fps=25.0, width=1920, height=1080, codec="h264")
# 3:4: passed through, but where it is framed by hand.
PORTRAIT = SourceMetadata(duration=600, fps=25.0, width=1080, height=1440, codec="h264")
# By hand: half as large again as fitted, a little left of the middle, over a colour.
BY_HAND = Framing(Transform(x=500, scale=1.5), background=Background(BackgroundKind.COLOUR, "#123456"))
# Two Scenes: one face in the first (Track), two in the second (Split).
SCENES = [Scene(0, 3), Scene(3, 6)]


def faces() -> list[FrameFaces]:
    return sampled((3, [face(400)]), (3, people(2)))


def box(bounds: Box) -> tuple[int, int, int, int]:
    return bounds.x, bounds.y, bounds.width, bounds.height


def within_a_pixel(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
    return all(abs(x - y) <= 1 for x, y in zip(a, b, strict=True))


# Seam B


def test_a_manual_override_plans_its_picture_over_its_background_and_needs_no_faces():
    override = LayoutOverride(4.0, Layout.MANUAL, BY_HAND)
    for seen in (faces(), None):
        plan = plan_render(100, 106, SOURCE, SCENES, seen, layout_overrides=[override], canvas=NINE_SIXTEEN)
        first, second = plan.scenes
        assert first.layout is SceneLayout.TRACK
        # The Source, placed by the override's Framing, still for the whole Scene, over its colour.
        assert second.layout is SceneLayout.MANUAL
        assert second.picture == picture_of(1920, 1080, BY_HAND.transform, canvas=NINE_SIXTEEN)
        assert (second.panels, second.colour, second.framing) == ([], "#123456", BY_HAND)
        assert (second.picture.width, second.picture.height, second.picture.centre) == (1620, 912, (500, 960))
    # Over its blur: the blurred cover of what its Crop keeps, under it.
    blurred = Framing(crop=Crop(right=0.5))
    [scene] = plan_render(100, 103, SOURCE, layout_overrides=[LayoutOverride(1.0, Layout.MANUAL, blurred)], canvas=NINE_SIXTEEN).scenes
    [background] = scene.panels
    assert background.blur and (background.path[0].x, background.crop_width, background.crop_height) == (176, 608, 1080)
    assert scene.colour is None and scene.picture.crop == Box(0, 0, 960, 1080)


def test_a_candidate_layout_of_manual_applies_to_the_scenes_without_an_override():
    plan = plan_render(100, 106, SOURCE, SCENES, faces(), Layout.MANUAL, framing=BY_HAND, layout_overrides=[LayoutOverride(4.0, Layout.AUTO)], canvas=NINE_SIXTEEN)
    manual, chosen = plan.scenes
    assert (manual.layout, manual.framing) == (SceneLayout.MANUAL, BY_HAND)
    # Auto chooses by the faces, and never Manual.
    assert chosen.layout is SceneLayout.SPLIT
    assert [scene.layout for scene in plan_render(100, 106, SOURCE, SCENES, faces(), canvas=NINE_SIXTEEN).scenes] == ["track", "split"]


def test_a_portrait_source_is_framed_by_hand_where_manual_and_passed_through_elsewhere():
    # The Candidate's Layout of Manual: its Framing, over its colour.
    [scene] = plan_render(100, 106, PORTRAIT, layout=Layout.MANUAL, framing=BY_HAND, canvas=NINE_SIXTEEN).scenes
    assert (scene.layout, scene.framing, scene.colour) == (SceneLayout.MANUAL, BY_HAND, "#123456")
    assert scene.picture == picture_of(1080, 1440, BY_HAND.transform, canvas=NINE_SIXTEEN)
    # A Manual override frames its Scene; the other is passed through, as under an automatic Layout.
    passed, by_hand = plan_render(100, 106, PORTRAIT, SCENES, layout_overrides=[LayoutOverride(4.0, Layout.MANUAL, BY_HAND)], canvas=NINE_SIXTEEN).scenes
    assert (passed.layout, passed.start, passed.end) == (SceneLayout.PASSTHROUGH, 0, 3)
    assert [panel.area for panel in passed.panels] == [Box(0, 240, 1080, 1440)]
    assert (by_hand.layout, by_hand.start, by_hand.end, by_hand.framing) == (SceneLayout.MANUAL, 3, 6, BY_HAND)
    # Automatic Layouts pass it through whole, as one Scene, which starts Manual from scale 1 over black.
    for layout in (Layout.AUTO, Layout.TRACK):
        [scene] = plan_render(100, 106, PORTRAIT, SCENES, layout=layout, layout_overrides=[LayoutOverride(4.0, Layout.BLUR)], canvas=NINE_SIXTEEN).scenes
        assert (scene.layout, scene.start, scene.end) == (SceneLayout.PASSTHROUGH, 0, 6)
        assert scene.framing == Framing(background=Background(BackgroundKind.COLOUR, "#000000"))
        assert box(picture_of(1080, 1440, scene.framing.transform, canvas=NINE_SIXTEEN).bounds) == (0, 240, 1080, 1440)


def test_a_track_scenes_framing_draws_its_first_crop():
    # A face left, in the middle and right of the frame, and none.
    for centre in (100, 400, 960, 1500, 1820, None):
        seen = sampled((3, None if centre is None else [face(centre)]))
        [scene] = plan_render(100, 103, SOURCE, [Scene(0, 3)], seen, Layout.TRACK, canvas=NINE_SIXTEEN).scenes
        [panel] = scene.panels
        start = panel.path[0]
        framing = scene.framing
        assert 0 <= framing.transform.x <= NINE_SIXTEEN.width and framing.background.kind is BackgroundKind.BLUR
        drawn = on_frame(picture_of(1920, 1080, framing.transform, framing.crop, canvas=NINE_SIXTEEN), frame=NINE_SIXTEEN.size)
        # The same part of the Source fills the frame, within a pixel.
        assert (drawn.width, drawn.height) == (NINE_SIXTEEN.width, NINE_SIXTEEN.height), centre
        assert within_a_pixel(box(drawn.crop), (start.x, start.y, panel.crop_width, panel.crop_height)), (centre, drawn.crop, start)
    # Near the middle, it is the Source zoomed: nothing is cropped.
    [scene] = plan_render(100, 103, SOURCE, [Scene(0, 3)], sampled((3, [face(960)])), Layout.TRACK, canvas=NINE_SIXTEEN).scenes
    assert scene.framing.crop == Crop() and scene.framing.transform.scale == pytest.approx(cover_scale(1920, 1080, NINE_SIXTEEN.size), abs=0.01)


def test_blur_offers_scale_1_over_its_blur_and_split_a_centred_cover():
    blur, split = plan_render(100, 106, SOURCE, SCENES, faces(), layout_overrides=[LayoutOverride(1.0, Layout.BLUR)], canvas=NINE_SIXTEEN).scenes
    assert blur.framing == Framing()
    assert split.layout is SceneLayout.SPLIT
    assert split.framing == Framing(Transform(scale=cover_scale(1920, 1080, NINE_SIXTEEN.size)))


# Seam A


def test_a_manual_layout_needs_its_framing_and_only_it_has_one(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya", selected=False)
    at = candidate["start"] + 0.5
    framing = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#00ff00"}}
    saved = patch(client, job, candidate, layout_overrides=[{"at": at, "layout": "manual", "framing": framing}])
    [override] = saved["layout_overrides"]
    assert (override["framing"]["transform"]["scale"], override["framing"]["background"]["colour"]) == (0.5, "#00FF00")
    for bad, said in (
        ({"layout_overrides": [{"at": at, "layout": "manual"}]}, "framing"),
        ({"layout_overrides": [{"at": at, "layout": "track", "framing": framing}]}, "framing"),
        ({"layout": "manual"}, "framing"),
        ({"layout": "blur", "framing": framing}, "framing"),
    ):
        response = client.patch(candidate_url(job, saved), json=bad)
        assert response.status_code == 422 and said in response.text, (bad, response.text)

    # The Candidate's own: with Manual, and dropped once its Layout is another.
    saved = patch(client, job, saved, layout="manual", framing=framing)
    assert (saved["layout"], saved["framing"]["transform"]["scale"]) == ("manual", 0.5)
    saved = patch(client, job, saved, hook_text="Tetap")
    assert saved["framing"]["transform"]["scale"] == 0.5
    saved = patch(client, job, saved, layout="track")
    assert (saved["layout"], saved["framing"]) == ("track", None)


def test_a_manual_scene_at_scale_1_over_a_colour_shows_the_colour_above_and_below_the_source(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(client, job, candidate, layout="manual", framing={"background": {"kind": "colour", "colour": "#00FF00"}})
    # Planned before any analysis, as one still Scene.
    [scene] = preview(client, job, candidate)["plan"]["scenes"]
    assert (scene["layout"], scene["picture"]["bounds"]) == ("manual", {"x": 0, "y": 656, "width": 1080, "height": 608})
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 0.5)
    green = np.array([0, 255, 0])

    def colour_share(rows: slice) -> float:
        return float((np.abs(frame[rows] - green).max(axis=2) < 40).mean())

    # The 16:9 Source fitted across the frame, y 656 to 1264, the colour above and below it (and
    # below the captions, at y 1296 to 1496).
    assert colour_share(slice(0, 640)) > 0.99 and colour_share(slice(1280, 1290)) > 0.99 and colour_share(slice(1510, 1920)) > 0.99
    assert colour_share(slice(700, 1220)) < 0.5  # the test pattern has some green of its own


def test_a_colour_background_is_rendered_as_that_colour_exactly(client, settings):
    # Black stays black: the colour is drawn whatever the range the frames are in (a Clip is full range).
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    patch(client, job, candidate, layout="manual", framing={"background": {"kind": "colour", "colour": "#000000"}})
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 0.5)
    assert int(frame[0:640].max()) <= 6 and int(frame[1510:1920].max()) <= 6


def test_a_portrait_source_framed_by_hand_is_rendered_so(client, settings, video_source, tmp_path):
    video_source.video = tmp_path / "portrait.mp4"
    command = [
        str(settings.ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=360x480:rate=30", "-f", "lavfi", "-i", "sine=frequency=220",
        "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(video_source.video),
    ]
    subprocess.run(command, check=True)
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # Half as large as it fits, over green.
    framing = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#00FF00"}}
    candidate = patch(client, job, candidate, layout="manual", framing=framing)
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    assert {scene["layout"] for scene in plan["scenes"]} == {"manual"}
    assert plan["scenes"][0]["picture"]["bounds"] == {"x": 270, "y": 600, "width": 540, "height": 720}
    frame = full_frame(settings, job_dir / clip["output"]["video"], 0.5)
    green = np.array([0, 255, 0])
    # Green where it was passed through before: either side of the picture, and above it.
    for rows, columns in ((slice(620, 1300), slice(0, 250)), (slice(620, 1300), slice(830, 1080)), (slice(0, 580), slice(None))):
        assert (np.abs(frame[rows, columns] - green).max(axis=2) < 40).mean() > 0.99, (rows, columns)


def test_an_all_manual_candidate_is_rendered_and_prepared_without_looking_for_faces(
    client, settings, video_source, face_then_two, monkeypatch
):
    def no_faces(*args, **kwargs):
        raise AssertionError("faces were looked for")

    monkeypatch.setattr(Analyzer, "detect_faces", no_faces)
    video_source.video = face_then_two
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    green = {"background": {"kind": "colour", "colour": "#00FF00"}}
    halved = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#0000FF"}}
    # The two people's Scene (from 3 s into the Source) has its own Framing.
    candidate = patch(
        client, job, candidate, layout="manual", framing=green, layout_overrides=[{"at": 4.5, "layout": "manual", "framing": halved}]
    )
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    # Its Scenes are found, so that the override frames its own.
    job_dir = settings.data_dir / "jobs" / job["id"]
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    assert [(scene["layout"], scene["picture"]["width"]) for scene in plan["scenes"]] == [("manual", 1080), ("manual", 540)]
    # The preview plans from what the render found, and nothing is left to prepare.
    shown = preview(client, job, candidate)
    assert shown["analysed"] is True and shown["plan"] == plan
    assert client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/prepare").json()["status"] == "review"
    # A Scene framed by its faces needs them.
    candidate = patch(client, job, candidate, layout_overrides=[{"at": 4.5, "layout": "track"}])
    assert preview(client, job, candidate)["analysed"] is False


@pytest.mark.anyio
async def test_the_candidates_framing_is_merged_field_by_field(mcp):
    job = await mcp_reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    await call(mcp, "edit_candidate", **ids, changes={"layout": "manual", "framing": {"transform": {"scale": 2}}})
    await call(mcp, "merge_candidate_items", **ids, framing={"transform": {"rotation": 90}})
    merged = await call(mcp, "merge_candidate_items", **ids, framing={"background": {"kind": "colour", "colour": "#112233"}})
    framing = merged["framing"]
    assert (framing["transform"]["scale"], framing["transform"]["rotation"]) == (2, 90)
    assert framing["background"] == {"kind": "colour", "colour": "#112233", "image": None}
    # Only the Manual Layout has one.
    await call(mcp, "edit_candidate", **ids, changes={"layout": "blur"})
    assert "framing" in await fails(mcp, "merge_candidate_items", **ids, framing={"transform": {"scale": 2}})


@pytest.mark.anyio
async def test_the_dry_run_lists_each_scenes_layout_and_framing_and_an_overrides_framing_merges_field_by_field(mcp):
    job = await mcp_reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    at = candidate["start"] + 0.5

    await call(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "layout": "manual", "framing": {"transform": {"scale": 2}}}])
    merged = await call(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "framing": {"transform": {"rotation": 90}}}])
    [override] = merged["layout_overrides"]
    assert (override["framing"]["transform"]["scale"], override["framing"]["transform"]["rotation"]) == (2, 90)
    assert "framing" in await fails(mcp, "merge_candidate_items", **ids, layout_overrides=[{"at": at, "layout": "track"}])

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [scene] = plan["scenes"]
    assert scene["layout"] == "manual"
    assert scene["framing"] == override["framing"]
    # Its picture as resolved: the 640x360 Source twice as large as it fits, 2160x1216, turned a quarter.
    assert (scene["bounds"], scene["rotation"], scene["opacity"]) == ({"x": -68, "y": -120, "width": 1216, "height": 2160}, 90, 1)
    assert scene["crop"] == {"x": 0, "y": 0, "width": 640, "height": 360}
    # A Scene of another Layout lists the Framing that draws its first frame, to start Manual from.
    plan = await call(mcp, "edit_candidate", **ids, changes={"layout_overrides": [], "layout": "blur"}, dry_run=True)
    [scene] = plan["scenes"]
    assert scene["layout"] == "blur" and scene["framing"]["transform"]["scale"] == 1
    # Panels, not a picture, draw a Scene of an automatic Layout.
    assert "bounds" not in scene
