"""Seam B: the Render Planner on synthetic input, without video.

Later tickets add their cases here: crop paths from face tracks (13), layouts per scene (14),
caption events (15) and the hook event (16).
"""

import pytest
from pydantic import TypeAdapter

from app.planner import Box, CropPoint, RenderPlan, SceneLayout, plan_render
from app.video_source import SourceMetadata


def source(width: int, height: int, fps: float = 25) -> SourceMetadata:
    return SourceMetadata(duration=3600, fps=fps, width=width, height=height, codec="h264")


def only_panel(plan: RenderPlan):
    [scene] = plan.scenes
    [panel] = scene.panels
    return scene, panel


def test_a_landscape_source_gets_one_static_full_height_crop_from_the_centre():
    plan = plan_render(612.35, 655.8, source(1920, 1080, fps=29.97))

    assert (plan.start, plan.end, plan.duration) == (612.35, 655.8, pytest.approx(43.45))
    assert (plan.width, plan.height, plan.source_width, plan.source_height, plan.fps) == (1080, 1920, 1920, 1080, 29.97)
    scene, panel = only_panel(plan)
    # One scene over the whole Clip, on the Clip's own timeline.
    assert (scene.start, scene.end, scene.layout) == (0.0, 43.45, SceneLayout.TRACK)
    assert panel.area == Box(0, 0, 1080, 1920)
    assert (panel.crop_width, panel.crop_height) == (608, 1080)  # 1080 x 9/16 = 607.5, kept even
    assert panel.path == [CropPoint(0.0, 656, 0)]  # centred: 656 + 304 = 960
    assert (plan.captions, plan.hook) == ([], None)


@pytest.mark.parametrize(("width", "height"), [(1281, 721), (853, 480), (641, 359), (1080, 1080), (321, 181)])
def test_odd_and_unusual_sizes_still_give_an_even_centred_9_16_crop_inside_the_frame(width, height):
    _, panel = only_panel(plan_render(10, 40, source(width, height)))
    [at] = panel.path

    assert all(value % 2 == 0 for value in (panel.crop_width, panel.crop_height, at.x, at.y))
    assert 0 <= at.x and at.x + panel.crop_width <= width
    assert 0 <= at.y and at.y + panel.crop_height <= height
    assert height - panel.crop_height <= 1  # full height, less an odd last row
    assert panel.crop_width / panel.crop_height == pytest.approx(9 / 16, abs=2 / panel.crop_height)
    assert at.x + panel.crop_width / 2 == pytest.approx(width / 2, abs=1)


@pytest.mark.parametrize(
    ("width", "height", "area"),
    [
        (1080, 1920, Box(0, 0, 1080, 1920)),
        (720, 1280, Box(0, 0, 1080, 1920)),  # scaled up to fill
        (1080, 1440, Box(0, 240, 1080, 1440)),  # 3:4: as wide as the frame, centred
        (721, 1281, Box(0, 0, 1080, 1920)),  # odd sizes: the last column and row are left out
        (480, 1080, Box(112, 0, 854, 1920)),  # narrower than 9:16: as tall as the frame, centred
    ],
)
def test_a_portrait_source_is_passed_through_whole(width, height, area):
    scene, panel = only_panel(plan_render(0, 30, source(width, height)))

    assert scene.layout is SceneLayout.PASSTHROUGH
    assert (panel.crop_width, panel.crop_height) == (width - width % 2, height - height % 2)
    assert panel.path == [CropPoint(0.0, 0, 0)]
    assert panel.area == area


def test_the_plan_is_saved_and_read_back_as_json():
    plan = plan_render(5, 35.5, source(1920, 1080))
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


@pytest.mark.parametrize(("start", "end"), [(10, 10), (10, 5), (-1, 5)])
def test_a_clip_must_run_forwards(start, end):
    with pytest.raises(ValueError):
        plan_render(start, end, source(1920, 1080))
