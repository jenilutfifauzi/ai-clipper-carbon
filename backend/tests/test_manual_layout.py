"""The Manual Layout: the Source framed by hand with a Framing, for one Scene (a Layout Override) or
for the whole Candidate (.scratch/transform-crop/issues/04-manual-layout.md, ADR 0007).

Seam B on the planner, then Seam A through the API, the real ffmpeg and MCP.
"""

import numpy as np
import pytest

from app.candidates import Background, BackgroundKind, Crop, Framing, Layout, LayoutOverride, Transform
from app.pictures import cover_scale
from app.planner import FRAME, OUTPUT_HEIGHT, OUTPUT_WIDTH, Box, FrameFaces, Scene, SceneLayout, on_frame, picture_of, plan_render
from app.video_source import SourceMetadata
from test_mcp import HALO_KABAR, call, fails, manual
# The MCP client the MCP tests use.
from test_mcp import anyio_backend, mcp  # noqa: F401
from test_mcp import reviewed as mcp_reviewed
from test_planner import face, people, sampled
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SOURCE = SourceMetadata(duration=600, fps=25.0, width=1920, height=1080, codec="h264")
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
        plan = plan_render(100, 106, SOURCE, SCENES, seen, layout_overrides=[override])
        first, second = plan.scenes
        assert first.layout is SceneLayout.TRACK
        # The Source, placed by the override's Framing, still for the whole Scene, over its colour.
        assert second.layout is SceneLayout.MANUAL
        assert second.picture == picture_of(1920, 1080, BY_HAND.transform)
        assert (second.panels, second.colour, second.framing) == ([], "#123456", BY_HAND)
        assert (second.picture.width, second.picture.height, second.picture.centre) == (1620, 912, (500, 960))
    # Over its blur: the blurred cover of what its Crop keeps, under it.
    blurred = Framing(crop=Crop(right=0.5))
    [scene] = plan_render(100, 103, SOURCE, layout_overrides=[LayoutOverride(1.0, Layout.MANUAL, blurred)]).scenes
    [background] = scene.panels
    assert background.blur and (background.path[0].x, background.crop_width, background.crop_height) == (176, 608, 1080)
    assert scene.colour is None and scene.picture.crop == Box(0, 0, 960, 1080)


def test_a_candidate_layout_of_manual_applies_to_the_scenes_without_an_override():
    plan = plan_render(100, 106, SOURCE, SCENES, faces(), Layout.MANUAL, framing=BY_HAND, layout_overrides=[LayoutOverride(4.0, Layout.AUTO)])
    manual, chosen = plan.scenes
    assert (manual.layout, manual.framing) == (SceneLayout.MANUAL, BY_HAND)
    # Auto chooses by the faces, and never Manual.
    assert chosen.layout is SceneLayout.SPLIT
    assert [scene.layout for scene in plan_render(100, 106, SOURCE, SCENES, faces()).scenes] == ["track", "split"]


def test_a_track_scenes_framing_draws_its_first_crop():
    # A face left, in the middle and right of the frame, and none.
    for centre in (100, 400, 960, 1500, 1820, None):
        seen = sampled((3, None if centre is None else [face(centre)]))
        [scene] = plan_render(100, 103, SOURCE, [Scene(0, 3)], seen, Layout.TRACK).scenes
        [panel] = scene.panels
        start = panel.path[0]
        framing = scene.framing
        assert 0 <= framing.transform.x <= OUTPUT_WIDTH and framing.background.kind is BackgroundKind.BLUR
        drawn = on_frame(picture_of(1920, 1080, framing.transform, framing.crop))
        # The same part of the Source fills the frame, within a pixel.
        assert (drawn.width, drawn.height) == (OUTPUT_WIDTH, OUTPUT_HEIGHT), centre
        assert within_a_pixel(box(drawn.crop), (start.x, start.y, panel.crop_width, panel.crop_height)), (centre, drawn.crop, start)
    # Near the middle, it is the Source zoomed: nothing is cropped.
    [scene] = plan_render(100, 103, SOURCE, [Scene(0, 3)], sampled((3, [face(960)])), Layout.TRACK).scenes
    assert scene.framing.crop == Crop() and scene.framing.transform.scale == pytest.approx(cover_scale(1920, 1080, FRAME), abs=0.01)


def test_blur_offers_scale_1_over_its_blur_and_split_a_centred_cover():
    blur, split = plan_render(100, 106, SOURCE, SCENES, faces(), layout_overrides=[LayoutOverride(1.0, Layout.BLUR)]).scenes
    assert blur.framing == Framing()
    assert split.layout is SceneLayout.SPLIT
    assert split.framing == Framing(Transform(scale=cover_scale(1920, 1080, FRAME)))


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
    # A Scene of another Layout lists the Framing that draws its first frame, to start Manual from.
    plan = await call(mcp, "edit_candidate", **ids, changes={"layout_overrides": [], "layout": "blur"}, dry_run=True)
    [scene] = plan["scenes"]
    assert scene["layout"] == "blur" and scene["framing"]["transform"]["scale"] == 1
