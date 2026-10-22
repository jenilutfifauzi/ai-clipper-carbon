"""Keyframes and in/out animations on Shapes (.scratch/shapes/issues/07-shape-motion.md, docs/adr/0008,
0011): a Shape's centre, scale, rotation and opacity keyed as a Text Layer's are, its picture made at
the largest scale it reaches, and Fade, Pop and Slide stacked on the keyed values.

Seam B on the model and the planner, Seam A renders with the real ffmpeg.
"""

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import EASE_OUT, Keyframe, KeyProperty, Shape
from app.canvas import PORTRAIT
from app.keyframes import value_at
from app.planner import bounds_at, picture_at, shape_event
from app.renderer import layer_at
from test_render import HEARD, add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

_SHAPE = TypeAdapter(Shape)
GREY = np.array([0x4A, 0x55, 0x60])
GREEN = np.array([0, 255, 0])
BLUE = np.array([0, 0, 255])


def shape(transform: dict | None = None, style: dict | None = None, **fields) -> Shape:
    given = {"id": "s1", "start": 1.0, "secs": 2.0, "transform": transform or {}, "style": style or {}, **fields}
    return _SHAPE.validate_python(given)


def test_a_shape_is_keyed_as_a_text_layer_is():
    keyed = shape(keys={"x": [{"at": 1, "value": 880, "ease": "ease_out"}, {"at": 0, "value": 5000}], "rotation": [{"at": 0.5, "value": 90}]})
    # Sorted, a centre brought onto the largest Canvas (its Candidate's brings it onto its own), an Ease by its name.
    assert keyed.keys[KeyProperty.X] == [Keyframe(0, 1920), Keyframe(1, 880, EASE_OUT)]
    assert keyed.keys[KeyProperty.ROTATION] == [Keyframe(0.5, 90)]
    assert shape().keys == {}
    # Only its Transform is keyed: no sound, nor past its length.
    with pytest.raises(ValidationError, match="no volume Keyframes"):
        shape(keys={"volume": [{"at": 0, "value": 1}]})
    with pytest.raises(ValidationError, match="Shape s1's scale Keyframe at 2.5 s is past its length of 2 s"):
        shape(secs=2, keys={"scale": [{"at": 2.5, "value": 2}]})
    with pytest.raises(ValidationError, match="opacity is 0 to 1"):
        shape(keys={"opacity": [{"at": 0, "value": 2}]})


def test_a_keyed_shapes_picture_moves_in_clip_time_and_its_bounds_follow():
    keys = {
        "x": [{"at": 0, "value": 200}, {"at": 1, "value": 880, "ease": "ease_out"}],
        "scale": [{"at": 0, "value": 1}, {"at": 2, "value": 2}],
        "rotation": [{"at": 0, "value": 0}, {"at": 1, "value": 90}],
    }
    event = shape_event(shape({"x": 540, "y": 900}, {"width": 300, "height": 100}, keys=keys), 10)
    still = shape_event(shape({"x": 540, "y": 900}, {"width": 300, "height": 100}), 10)
    # Its Keyframes in seconds into the Clip, sampled by the Overlay's rule.
    assert [key.at for key in event.picture.motion[KeyProperty.X]] == [1.0, 2.0]
    for at in (1.25, 1.5, 2.5):
        drawn = picture_at(event.picture, at, frame=PORTRAIT.size)
        assert drawn.centre[0] == pytest.approx(value_at([Keyframe(1, 200), Keyframe(2, 880, EASE_OUT)], at, 0))
        scale = 1 + (min(at, 3) - 1) / 2
        assert (drawn.width, drawn.height) == pytest.approx((event.layout.width * scale, event.layout.height * scale))
    # The same figure as the Shape unkeyed, made at the largest scale it reaches.
    assert (event.area, event.picture_key) == (still.area, still.picture_key)
    assert event.layout.scale == 2 and still.layout.scale == 1
    # After its last turn and at twice its size: its area stood on end, twice as large, about x 880.
    last = bounds_at(event, 3.0, frame=PORTRAIT.size)
    assert (last.width, last.height) == pytest.approx((200, 600), abs=2)
    assert last.x + last.width / 2 == pytest.approx(880, abs=1)


def test_pop_over_a_keyed_scale_peaks_at_the_product_of_the_two():
    keys = {"scale": [{"at": 0, "value": 2}, {"at": 2, "value": 3}], "opacity": [{"at": 0, "value": 0.8}]}
    popped = shape_event(shape(keys=keys, animation_in="pop", animation_out="fade", animation_ms=400), 10)
    # Its picture made for its largest keyed scale: Pop grows it to that, never past it.
    assert popped.layout.scale == 3
    keyed, drawn = picture_at(popped.picture, 1.2, frame=PORTRAIT.size), layer_at(popped, 1.2, frame=PORTRAIT.size)
    # Half way in: 85% of its keyed scale, half its keyed opacity, at its keyed place.
    assert (drawn.width, drawn.height) == pytest.approx((keyed.width * 0.85, keyed.height * 0.85))
    assert keyed.width == pytest.approx(popped.layout.width * 2.1)
    assert drawn.opacity == pytest.approx(0.8 * 0.5)
    assert drawn.centre == pytest.approx(keyed.centre)
    # Popped in, at its keyed scale; fading out, at half its keyed opacity.
    assert layer_at(popped, 1.4, frame=PORTRAIT.size) == picture_at(popped.picture, 1.4, frame=PORTRAIT.size)
    assert layer_at(popped, 2.8, frame=PORTRAIT.size).opacity == pytest.approx(0.8 * 0.5)


def test_a_split_keyed_shape_plays_its_motion_on_the_same_moments_in_both_halves():
    def keys(**each: list[tuple[float, float]]) -> dict:
        return {prop: [{"at": at, "value": value} for at, value in list_] for prop, list_ in each.items()}

    # From 1 s for 3 s, split 2 s in: each half keyed as the editor's split leaves it (a Keyframe at
    # the cut with the value there), from its own start.
    whole = shape_event(shape(start=1.0, secs=3.0, keys=keys(x=[(0, 200), (1, 880), (3, 540)], opacity=[(0.5, 1), (2.5, 0.2)])), 10)
    head = shape_event(shape(start=1.0, secs=2.0, keys=keys(x=[(0, 200), (1, 880), (2, 710)], opacity=[(0.5, 1), (2, 0.4)])), 10)
    tail = shape_event(shape(id="s2", start=3.0, secs=1.0, keys=keys(x=[(0, 710), (1, 540)], opacity=[(0, 0.4), (0.5, 0.2)])), 10)
    for at in np.linspace(1.0, 3.0, 9):
        assert layer_at(head, at, frame=PORTRAIT.size).centre == pytest.approx(layer_at(whole, at, frame=PORTRAIT.size).centre)
        assert layer_at(head, at, frame=PORTRAIT.size).opacity == pytest.approx(layer_at(whole, at, frame=PORTRAIT.size).opacity)
    for at in np.linspace(3.0, 4.0, 5):
        assert layer_at(tail, at, frame=PORTRAIT.size).centre == pytest.approx(layer_at(whole, at, frame=PORTRAIT.size).centre)
        assert layer_at(tail, at, frame=PORTRAIT.size).opacity == pytest.approx(layer_at(whole, at, frame=PORTRAIT.size).opacity)


def eased_x(at: float, start: float) -> float:
    return value_at([Keyframe(start, 200), Keyframe(start + 1, 880, EASE_OUT)], at, 0)


def test_a_keyed_shape_renders_at_its_keyed_place_opacity_and_scale(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, shapes=[
        # A green bar from x 200 to 880 over 1 s, easing out.
        {"id": "slid", "start": 0.4, "secs": 2.0, "transform": {"y": 300}, "style": {"width": 200, "height": 120, "fill": "#00FF00"},
         "keys": {"x": [{"at": 0, "value": 200}, {"at": 1, "value": 880, "ease": "ease_out"}]}},
        # A blue square faded to half over 1 s, over the grey picture.
        {"id": "faded", "start": 0.4, "secs": 2.0, "transform": {"y": 800}, "style": {"width": 200, "height": 200, "fill": "#0000FF"},
         "keys": {"opacity": [{"at": 0, "value": 1}, {"at": 1, "value": 0.5}]}},
        # A green square keyed to scale 2, popping in.
        {"id": "popped", "start": 0.0, "secs": 1.2, "transform": {"y": 1130}, "style": {"width": 100, "height": 100, "fill": "#00FF00"},
         "keys": {"scale": [{"at": 0, "value": 2}]}, "animation_in": "pop", "animation_ms": 400},
    ])
    slid, faded, popped = preview(client, job, candidate)["plan"]["shapes"]
    # The preview places the same picture by the same Keyframes, in Clip time.
    assert [(key["at"], key["value"]) for key in slid["picture"]["motion"]["x"]] == [(0.4, 200), (1.4, 880)]
    assert popped["layout"]["scale"] == 2
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    # The green bar's middle at the eased x, frame by frame (25 fps).
    for at in (0.4, 0.6, 0.8, 1.0, 1.4, 2.0):
        band = full_frame(settings, video, at)[200:400]
        rows, columns = pixels(band, GREEN)
        assert abs(columns.mean() - eased_x(at, 0.4)) <= 2, (at, columns.mean(), eased_x(at, 0.4))
        assert abs(rows.mean() + 200 - 300) <= 2

    # The blue square opaque at first, half over the grey after 1 s, and 76% on the way (0.48 s in).
    for at, opacity in ((0.4, 1.0), (0.88, 0.76), (1.6, 0.5)):
        rows, columns = pixels(full_frame(settings, video, at), GREY * (1 - opacity) + BLUE * opacity, 14)
        assert len(rows) == pytest.approx(200 * 200, rel=0.1), (at, len(rows))
        assert abs(columns.mean() - 540) <= 2 and abs(rows.mean() - 800) <= 2

    def extent(frame: np.ndarray) -> tuple[int, int]:
        """How wide and tall the popped square shows, round where it is: its pixels unlike the grey."""
        part = frame[1130 - 200 : 1130 + 200, 540 - 200 : 540 + 200]
        rows, columns = np.nonzero(np.abs(part - GREY).max(axis=2) > 60)
        return int(columns.max() + 1 - columns.min()), int(rows.max() + 1 - rows.min())

    # Popped in, it peaks at its keyed scale, twice its size; half way in, at 85% of that.
    assert extent(full_frame(settings, video, 0.8)) == pytest.approx((200, 200), abs=3)
    assert extent(full_frame(settings, video, 0.2)) == pytest.approx((170, 170), abs=6)
