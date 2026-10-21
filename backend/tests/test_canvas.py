"""The Canvas (docs/adr/0022): each aspect's frame in output pixels, its Safe Area and the mapping
from the Reference Space. Pure (Seam B)."""

import pytest

from app.canvas import CANVASES, PORTRAIT, REFERENCE, Aspect, Box, canvas_for
from app.planner import plan_render
from app.video_source import SourceMetadata


def test_each_aspect_has_a_short_side_of_1080() -> None:
    assert {aspect: canvas_for(aspect).size for aspect in Aspect} == {
        Aspect.PORTRAIT: (1080, 1920),
        Aspect.FEED: (1080, 1350),
        Aspect.SQUARE: (1080, 1080),
        Aspect.LANDSCAPE: (1920, 1080),
    }
    assert canvas_for("16:9") is CANVASES[Aspect.LANDSCAPE]
    assert PORTRAIT is canvas_for(Aspect.PORTRAIT) and PORTRAIT.size == REFERENCE


def test_an_unknown_aspect_is_refused() -> None:
    with pytest.raises(ValueError):
        canvas_for("4:3")


def test_the_portrait_safe_area_is_clear_of_the_platforms_buttons() -> None:
    assert PORTRAIT.safe_area == Box(0, 232, 950, 1304)


@pytest.mark.parametrize("aspect", [Aspect.FEED, Aspect.SQUARE, Aspect.LANDSCAPE])
def test_the_other_safe_areas_keep_a_twentieth_clear_at_each_edge(aspect: Aspect) -> None:
    canvas = canvas_for(aspect)
    safe = canvas.safe_area
    assert (safe.x, safe.y) == (round(canvas.width / 20), round(canvas.height / 20))
    assert (safe.x + safe.width, safe.y + safe.height) == (canvas.width - safe.x, canvas.height - safe.y)


def test_portrait_caption_places_are_todays() -> None:
    assert PORTRAIT.seam_captions == Box(130, 860, 820, 200)
    assert PORTRAIT.lower_captions == Box(130, 1296, 820, 200)
    assert PORTRAIT.top_captions == Box(130, 430, 820, 200)
    assert PORTRAIT.split_height == 960


def test_a_place_in_the_reference_space_maps_in_proportion() -> None:
    assert PORTRAIT.from_reference(270, 480) == (270, 480)
    assert canvas_for(Aspect.LANDSCAPE).from_reference(270, 480) == (480, 270)
    assert canvas_for(Aspect.FEED).from_reference(1080, 1920) == (1080, 1350)


def test_a_plan_is_made_on_its_canvas_with_its_safe_area() -> None:
    source = SourceMetadata(duration=3600, fps=25, width=1920, height=1080, codec="h264")
    portrait = plan_render(0, 10, source)
    assert (portrait.width, portrait.height, portrait.safe_area) == (1080, 1920, PORTRAIT.safe_area)
    landscape = canvas_for(Aspect.LANDSCAPE)
    plan = plan_render(0, 10, source, canvas=landscape)
    assert (plan.width, plan.height, plan.safe_area) == (1920, 1080, landscape.safe_area)
    [scene] = plan.scenes
    assert all(panel.area.x + panel.area.width <= 1920 and panel.area.y + panel.area.height <= 1080 for panel in scene.panels)
