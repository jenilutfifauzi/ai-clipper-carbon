"""Rescaling a Candidate's own positions when its Canvas Aspect changes (docs/adr/0022): centres keep
their fraction of the Canvas, Framings their scale relative to the cover scale, Overlays, Text Layers
and Shapes their drawn size, and everything stays on the new Canvas. Pure (Seam B)."""

from dataclasses import replace

import pytest

from app.candidates import (
    MAX_SCALE,
    CueEdit,
    Framing,
    Keyframe,
    KeyProperty,
    Layout,
    LayoutOverride,
    Overlay,
    Segment,
    Shape,
    ShapeStyle,
    TextLayer,
    Transform,
    manual_candidate,
)
from app.canvas import Aspect, canvas_for
from app.pictures import cover_scale, drawn_size
from app.planner import shape_event, text_event
from app.rescale import rescaled

PORTRAIT, LANDSCAPE = canvas_for(Aspect.PORTRAIT), canvas_for(Aspect.LANDSCAPE)
# A 16:9 Source and Media Library items: a wide picture and a 9:16 one.
SOURCE = (1920, 1080)
SIZES = {"wide": (320, 180), "tall": (1080, 1920), "broll": (1920, 1080)}


def candidate(**fields):
    return replace(manual_candidate("c", 10.0, 20.0), **fields)


def layer(x: float, y: float, **fields) -> TextLayer:
    return TextLayer("t", "Judul", 0, 2, transform=Transform(x=x, y=y), **fields)


def overlay(media: str, transform: Transform, **fields) -> Overlay:
    return Overlay("o", media, 0, 2, transform=transform, **fields)


def video(scale: float, **fields) -> Segment:
    return Segment("v", 0, 1, media="broll", framing=Framing(Transform(x=540, y=960, scale=scale)), **fields)


def to(given, aspect: Aspect = Aspect.LANDSCAPE):
    return rescaled(given, aspect, SIZES, SOURCE)


def test_a_centre_keeps_its_fraction_of_the_canvas() -> None:
    moved = to(candidate(text_layers=[layer(270, 480)]))
    assert moved.aspect is Aspect.LANDSCAPE
    assert (moved.text_layers[0].transform.x, moved.text_layers[0].transform.y) == (480, 270)


def test_a_filled_media_segment_stays_at_the_cover_scale_and_a_zoomed_one_as_zoomed() -> None:
    cover = cover_scale(*SIZES["broll"], PORTRAIT.size)
    moved = to(candidate(segments=[Segment("e", 10, 20), video(cover), replace(video(1.5 * cover), id="z")]))
    _, filled, zoomed = moved.segments
    assert filled.framing.transform.scale == pytest.approx(cover_scale(*SIZES["broll"], LANDSCAPE.size)) == pytest.approx(1)
    assert zoomed.framing.transform.scale == pytest.approx(1.5)
    assert (filled.framing.transform.x, filled.framing.transform.y) == (960, 540)


def test_the_sources_framings_keep_their_scale_relative_to_its_cover() -> None:
    cover = cover_scale(*SOURCE, PORTRAIT.size)
    framing = Framing(Transform(x=540, y=960, scale=2 * cover))
    keys = {KeyProperty.SCALE: [Keyframe(0, cover)]}
    moved = to(candidate(layout=Layout.MANUAL, framing=framing, layout_overrides=[LayoutOverride(12, Layout.MANUAL, framing, keys)]))
    assert moved.framing.transform.scale == pytest.approx(2)
    [override] = moved.layout_overrides
    assert override.framing.transform.scale == pytest.approx(2)
    assert override.keys[KeyProperty.SCALE][0].value == pytest.approx(1)


def test_an_overlays_drawn_size_in_pixels_is_kept() -> None:
    given = overlay("wide", Transform(x=540, y=960, scale=0.5))
    moved = to(candidate(overlays=[given])).overlays[0]
    assert drawn_size(*SIZES["wide"], given.transform, PORTRAIT.size) == (540, 304)
    assert drawn_size(*SIZES["wide"], moved.transform, LANDSCAPE.size) == (540, 304)


def test_a_text_layers_and_a_shapes_drawn_size_is_kept() -> None:
    text = replace(layer(540, 960), transform=Transform(x=540, y=960, scale=1.5))
    shape = Shape("s", 0, 2, transform=Transform(x=540, y=960, scale=0.8), style=ShapeStyle(fill="#ff0000"))
    moved = to(candidate(text_layers=[text], shapes=[shape]))
    before = text_event(text, 10, PORTRAIT).picture, shape_event(shape, 10).picture
    after = text_event(moved.text_layers[0], 10, LANDSCAPE).picture, shape_event(moved.shapes[0], 10).picture
    assert [(p.width, p.height) for p in after] == [(p.width, p.height) for p in before]


def test_position_and_scale_keyframes_follow_their_items_rule() -> None:
    keys = {
        KeyProperty.X: [Keyframe(0, 270), Keyframe(1, 1080)],
        KeyProperty.Y: [Keyframe(0, 480)],
        KeyProperty.SCALE: [Keyframe(0, 0.5)],
        KeyProperty.OPACITY: [Keyframe(0, 0.4)],
    }
    moved = to(candidate(overlays=[overlay("wide", Transform(scale=0.5), keys=keys)], text_layers=[layer(540, 960, keys=keys)]))
    [keyed_overlay], [keyed_layer] = moved.overlays, moved.text_layers
    for item in (keyed_overlay, keyed_layer):
        assert [key.value for key in item.keys[KeyProperty.X]] == [480, 1920]
        assert [key.value for key in item.keys[KeyProperty.Y]] == [270]
        assert item.keys[KeyProperty.OPACITY] == keys[KeyProperty.OPACITY]
    # An Overlay's scale keeps its drawn size; a Text Layer's is its own size.
    assert keyed_overlay.keys[KeyProperty.SCALE][0].value == pytest.approx(0.5 * 1080 / 1920)
    assert keyed_layer.keys[KeyProperty.SCALE][0].value == 0.5


def test_cue_edits_move_with_the_canvas() -> None:
    moved = to(candidate(cue_edits=[CueEdit(at=12, x=270, y=480), CueEdit(at=13, scale=2)]))
    assert [(edit.x, edit.y, edit.scale) for edit in moved.cue_edits] == [(480, 270, None), (None, None, 2)]


def test_values_are_clamped_to_the_new_canvas() -> None:
    # A 9:16 picture filling a 9:16 frame is drawn at 6 × its size on 16:9 as 8 × (the most).
    tall = overlay("tall", Transform(x=540, y=960, scale=6))
    # A centre left past the frame (saved before it was kept on its Canvas).
    off = layer(1500, 2000)
    moved = to(candidate(overlays=[tall], text_layers=[off], cue_edits=[CueEdit(at=12, x=1080, y=1920)]))
    assert moved.overlays[0].transform.scale == MAX_SCALE
    assert (moved.text_layers[0].transform.x, moved.text_layers[0].transform.y) == (1920, 1080)
    assert (moved.cue_edits[0].x, moved.cue_edits[0].y) == (1920, 1080)


def test_9_16_to_16_9_and_back_is_within_rounding_for_interior_items() -> None:
    cover = cover_scale(*SIZES["broll"], PORTRAIT.size)
    given = candidate(
        segments=[Segment("e", 10, 20), video(1.2 * cover)],
        overlays=[overlay("wide", Transform(x=333, y=777, scale=0.7, rotation=15))],
        text_layers=[layer(123, 1456)],
        cue_edits=[CueEdit(at=12, x=401, y=1203)],
    )
    back = to(to(given), Aspect.PORTRAIT)
    assert back.aspect is Aspect.PORTRAIT
    for was, now in [
        (given.segments[1].framing.transform, back.segments[1].framing.transform),
        (given.overlays[0].transform, back.overlays[0].transform),
        (given.text_layers[0].transform, back.text_layers[0].transform),
    ]:
        assert (now.x, now.y, now.scale, now.rotation) == pytest.approx((was.x, was.y, was.scale, was.rotation), abs=0.01)
    assert abs(back.cue_edits[0].x - 401) <= 1 and abs(back.cue_edits[0].y - 1203) <= 1


def test_the_same_aspect_changes_nothing_and_a_missing_size_keeps_the_scale() -> None:
    given = candidate(text_layers=[layer(270, 480)], overlays=[overlay("gone", Transform(x=540, y=960, scale=0.5))])
    assert to(given, Aspect.PORTRAIT) == given
    moved = to(given)
    assert (moved.overlays[0].transform.x, moved.overlays[0].transform.y, moved.overlays[0].transform.scale) == (960, 540, 0.5)
