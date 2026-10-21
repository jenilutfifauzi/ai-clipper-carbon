"""Keyframes on Text Layers (.scratch/text-advanced/issues/12-text-layer-keyframes.md, docs/adr/0008,
0010): a Text Layer's centre, scale, rotation and opacity keyed with Eases as an Overlay's are, its
picture made at the largest scale it reaches, and Fade, Pop and Slide stacked on the keyed values.

Seam B on the model and the planner, Seam A renders with the real ffmpeg, and the agent through MCP.
"""

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import EASE_OUT, Keyframe, KeyProperty, TextLayer
from app.keyframes import value_at
from app.planner import MAX_LAYER_PICTURE, bounds_at, picture_at, text_event
from app.renderer import layer_at
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import HEARD, add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

_LAYER = TypeAdapter(TextLayer)
GREY = np.array([0x4A, 0x55, 0x60])
GREEN = np.array([0, 255, 0])
BLUE = np.array([0, 0, 255])


def layer(transform: dict | None = None, style: dict | None = None, **fields) -> TextLayer:
    given = {"id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0, "transform": transform or {}, "style": style or {}, **fields}
    return _LAYER.validate_python(given)


def card(colour: str, size: int = 60) -> dict:
    """A Text Style whose letters are as `colour` as its square-cornered plate: one block of it."""
    plate = {"shape": "block", "colour": colour, "opacity": 1, "radius": 0, "padding_x": 60, "padding_y": 30}
    return {"size": size, "colour": colour, "plate": plate}


def test_a_text_layer_is_keyed_as_an_overlay_is():
    keyed = layer(keys={"x": [{"at": 1, "value": 880, "ease": "ease_out"}, {"at": 0, "value": 5000}], "opacity": [{"at": 0.5, "value": 0.2}]})
    # Sorted, a centre brought onto the largest Canvas (its Candidate's brings it onto its own), an Ease by its name.
    assert keyed.keys[KeyProperty.X] == [Keyframe(0, 1920), Keyframe(1, 880, EASE_OUT)]
    assert keyed.keys[KeyProperty.OPACITY] == [Keyframe(0.5, 0.2)]
    assert layer().keys == {}
    with pytest.raises(ValidationError, match="no volume Keyframes"):
        layer(keys={"volume": [{"at": 0, "value": 1}]})
    with pytest.raises(ValidationError, match="past its length"):
        layer(secs=2, keys={"scale": [{"at": 2.5, "value": 2}]})
    with pytest.raises(ValidationError, match="closer than a frame"):
        layer(keys={"y": [{"at": 0, "value": 100}, {"at": 0.01, "value": 200}]})
    with pytest.raises(ValidationError, match="opacity is 0 to 1"):
        layer(keys={"opacity": [{"at": 0, "value": 2}]})


def test_a_keyed_text_layers_picture_moves_in_clip_time_as_an_overlays_does():
    slide = {"x": [{"at": 0, "value": 200}, {"at": 1, "value": 880, "ease": "ease_out"}], "scale": [{"at": 0, "value": 1}, {"at": 2, "value": 2}]}
    event = text_event(layer({"x": 540, "y": 900}, start=1.0, secs=2.0, keys=slide), 10)
    still = text_event(layer({"x": 540, "y": 900}, start=1.0, secs=2.0), 10)
    picture = event.picture
    # Its Keyframes in seconds into the Clip, sampled by the Overlay's rule.
    assert [key.at for key in picture.motion[KeyProperty.X]] == [1.0, 2.0]
    for at in (1.25, 1.5, 2.5):
        drawn = picture_at(picture, at)
        assert drawn.centre[0] == pytest.approx(value_at([Keyframe(1, 200), Keyframe(2, 880, EASE_OUT)], at, 0))
        # Its whole picture (its words and the room round them), scaled as keyed.
        scale = 1 + (at - 1) / 2
        assert drawn.width == pytest.approx(event.layout.width * scale) and drawn.height == pytest.approx(event.layout.height * scale)
        assert drawn.centre[1] == picture.centre[1]
    # The same words and layout as the layer unkeyed.
    assert (event.lines, event.area, event.picture_key) == (still.lines, still.area, still.picture_key)
    assert still.picture.motion == {}


def test_a_keyed_text_layers_picture_is_made_at_the_largest_scale_it_reaches():
    def made(transform: dict, keys: dict, **style) -> float:
        return text_event(layer(transform, {"size": 60, **style}, keys=keys), 10).layout.scale

    grows = {"scale": [{"at": 0, "value": 0.5}, {"at": 1, "value": 2.5}, {"at": 2, "value": 1}]}
    # Its keyed scale replaces its constant, which then makes no picture larger.
    assert made({"scale": 1}, grows) == 3
    assert made({"scale": 6}, grows) == 3
    assert made({"scale": 6}, {"scale": [{"at": 0, "value": 1.2}]}) == 1.5
    # Pop grows it to its full size, never past it: it peaks at the keyed scale.
    assert text_event(layer({}, {"size": 60}, keys=grows, animation_in="pop", animation_out="pop"), 10).layout.scale == 3
    # Never more than MAX_LAYER_PICTURE on its longest side.
    huge = text_event(layer({}, {"size": 300}, text="Kalimat yang panjang", keys={"scale": [{"at": 0, "value": 8}]}), 10)
    assert max(huge.picture.item_size) <= MAX_LAYER_PICTURE


def test_fade_pop_and_slide_are_stacked_on_a_keyed_text_layers_values():
    keys = {
        "y": [{"at": 0, "value": 800}, {"at": 2, "value": 1000}],
        "scale": [{"at": 0, "value": 2}, {"at": 2, "value": 1}],
        "opacity": [{"at": 0, "value": 0.8}, {"at": 2, "value": 0.4}],
    }
    popped = text_event(layer(keys=keys, start=1.0, secs=2.0, animation_in="pop", animation_out="slide", animation_ms=400), 10)
    picture = popped.picture
    # Half way in: half its keyed opacity, 85% of its keyed scale, at its keyed place.
    keyed, drawn = picture_at(picture, 1.2), layer_at(popped, 1.2)
    assert drawn.opacity == pytest.approx(keyed.opacity * 0.5)
    assert (drawn.width, drawn.height) == pytest.approx((keyed.width * 0.85, keyed.height * 0.85))
    assert drawn.centre == pytest.approx(keyed.centre)
    # Half way out: half its keyed opacity, 30 px below its keyed place, at its keyed scale.
    keyed, drawn = picture_at(picture, 2.8), layer_at(popped, 2.8)
    assert drawn.opacity == pytest.approx(keyed.opacity * 0.5)
    assert drawn.centre == pytest.approx((keyed.centre[0], keyed.centre[1] + 30))
    assert (drawn.width, drawn.height) == pytest.approx((keyed.width, keyed.height))
    # In between, as keyed.
    assert layer_at(popped, 2.0) == picture_at(picture, 2.0)


def eased_x(at: float, start: float) -> float:
    return value_at([Keyframe(start, 200), Keyframe(start + 1, 880, EASE_OUT)], at, 0)


def test_a_keyed_text_layer_renders_at_its_keyed_place_turn_opacity_and_scale(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    white = {"size": 60, "colour": "#FFFFFF"}
    candidate = patch(client, job, candidate, text_layers=[
        # A green card from x 200 to 880 over 1 s, easing out.
        {"id": "slid", "text": "--", "start": 0.4, "secs": 2.0, "transform": {"y": 300}, "style": card("#00FF00"),
         "keys": {"x": [{"at": 0, "value": 200}, {"at": 1, "value": 880, "ease": "ease_out"}]}},
        # A blue card turned a quarter and faded to half over 1 s, over the grey picture.
        {"id": "turned", "text": "--", "start": 0.4, "secs": 2.0, "transform": {"y": 800}, "style": card("#0000FF"),
         "keys": {"rotation": [{"at": 0, "value": 0}, {"at": 1, "value": 90}], "opacity": [{"at": 0, "value": 1}, {"at": 1, "value": 0.5}]}},
        # White words keyed to scale 2, popping in; then the same words at twice the size.
        {"id": "popped", "text": "HM", "start": 0.0, "secs": 1.2, "transform": {"y": 1130}, "style": white,
         "keys": {"scale": [{"at": 0, "value": 2}]}, "animation_in": "pop", "animation_ms": 400},
        {"id": "sized", "text": "HM", "start": 1.3, "secs": 1.3, "transform": {"y": 1130}, "style": white | {"size": 120}},
    ])
    slid, turned, popped, sized = preview(client, job, candidate)["plan"]["texts"]
    # Made at the keyed scale: as many pixels as the words at twice the size.
    assert popped["layout"]["scale"] == 2
    assert popped["picture"]["item_size"] == pytest.approx(sized["picture"]["item_size"], abs=4)
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    # The green card's middle at the eased x, frame by frame (25 fps).
    for at in (0.4, 0.6, 0.8, 1.0, 1.4, 2.0):
        rows, columns = pixels(full_frame(settings, video, at), GREEN)
        assert abs(columns.mean() - eased_x(at, 0.4)) <= 2, (at, columns.mean(), eased_x(at, 0.4))
        assert abs(rows.mean() - 300) <= 2

    # The blue card unturned and opaque at first, stood on end at half opacity after 1 s; on the way
    # (0.48 s in), turned 43.2° at 76%.
    area = turned["area"]
    first = full_frame(settings, video, 0.4)
    rows, columns = pixels(first, BLUE)
    assert abs(columns.max() + 1 - columns.min() - area["width"]) <= 3 and abs(rows.max() + 1 - rows.min() - area["height"]) <= 3
    rows, columns = pixels(full_frame(settings, video, 0.88), GREY * 0.24 + BLUE * 0.76, 14)
    angle = np.radians(43.2)
    across = area["width"] * np.cos(angle) + area["height"] * np.sin(angle)
    down = area["width"] * np.sin(angle) + area["height"] * np.cos(angle)
    # But for its antialiased tips, which the colour's tolerance leaves out.
    assert abs(columns.max() + 1 - columns.min() - across) <= 6 and abs(rows.max() + 1 - rows.min() - down) <= 6
    assert len(rows) == pytest.approx(area["width"] * area["height"], rel=0.1)
    last = full_frame(settings, video, 1.6)
    rows, columns = pixels(last, (GREY + BLUE) / 2, 14)
    assert abs(columns.max() + 1 - columns.min() - area["height"]) <= 4 and abs(rows.max() + 1 - rows.min() - area["width"]) <= 4
    assert len(pixels(last, BLUE, 60)[0]) == 0

    def ink(frame: np.ndarray, event: dict) -> tuple[int, int, tuple[int, int]]:
        """Round the words' box: how many pixels are part way between them and what is behind (their
        edges), how many inked, and how wide and tall what shows of them is."""
        b = event["bounds"]
        luma = frame[b["y"] - 60 : b["y"] + b["height"] + 60, b["x"] - 60 : b["x"] + b["width"] + 60].mean(axis=2)
        low, high = GREY.mean(), 255
        part = (luma > low + 0.2 * (high - low)) & (luma < high - 0.2 * (high - low))
        inked = luma >= high - 0.2 * (high - low)
        rows, columns = np.nonzero(luma > low + 30)
        return int(part.sum()), int(inked.sum()), (int(columns.max() + 1 - columns.min()), int(rows.max() + 1 - rows.min()))

    # Popped in, it peaks at the keyed scale, as sharp as the words at twice the size; half way in,
    # at 85% of it.
    (peak_edges, peak_ink, peak_box), (sized_edges, sized_ink, sized_box) = ink(full_frame(settings, video, 0.8), sized), ink(full_frame(settings, video, 2.0), sized)
    assert peak_box == pytest.approx(sized_box, abs=4)
    assert peak_ink == pytest.approx(sized_ink, rel=0.08) and peak_edges < 1.5 * sized_edges, (peak_ink, sized_ink, peak_edges, sized_edges)
    _, _, growing = ink(full_frame(settings, video, 0.2), sized)
    assert growing[0] == pytest.approx(0.85 * peak_box[0], abs=6)


def test_a_keyed_text_layers_bounds_at_a_time_hold_its_area_as_keyed_then():
    keys = {
        "x": [{"at": 0, "value": 300}, {"at": 1, "value": 700}],
        "scale": [{"at": 0, "value": 1}, {"at": 1, "value": 2}],
        "rotation": [{"at": 0, "value": 0}, {"at": 1, "value": 90}],
    }
    event = text_event(layer({"x": 540, "y": 900}, style={"size": 60}, start=1.0, secs=2.0, keys=keys), 10)
    area = event.area
    # At first, its area at scale 1 about x 300.
    first = bounds_at(event, 1.0)
    assert (first.width, first.height) == pytest.approx((area.width, area.height), abs=1)
    assert first.x + first.width / 2 == pytest.approx(300, abs=1) and first.y + first.height / 2 == pytest.approx(900, abs=1)
    # After its last Keyframe, twice as large and stood on end about x 700.
    last = bounds_at(event, 2.5)
    assert (last.width, last.height) == pytest.approx((2 * area.height, 2 * area.width), abs=2)
    assert last.x + last.width / 2 == pytest.approx(700, abs=1) and last.y + last.height / 2 == pytest.approx(900, abs=1)
    # Unkeyed, its bounds.
    still = text_event(layer({"x": 540, "y": 900}), 10)
    assert bounds_at(still, 1.5) == still.bounds


@pytest.mark.anyio
async def test_the_agent_keys_a_text_layer_as_an_overlay_and_it_plans_as_the_editors(mcp, client):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    slide = {"x": [{"at": 0, "value": 200}, {"at": 1, "value": 880, "ease": "ease_out"}]}
    title = {"id": "title", "text": "Judul", "start": 0.2, "secs": 1.2, "transform": {"y": 400}, "style": {"size": 60}}
    await call(mcp, "merge_candidate_items", **ids, text_layers=[title | {"keys": slide}])

    # Only the properties given change: the x Keyframes stay.
    fade = {"opacity": [{"at": 0, "value": 0}, {"at": 0.5, "value": 1, "ease": [0.3, 0, 0.2, 1]}]}
    [made] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "keys": fade}]))["text_layers"]
    assert (made["keys"]["x"][1]["ease"], made["keys"]["opacity"][1]["ease"]) == ([0, 0, 0.58, 1], [0.3, 0, 0.2, 1])
    # A length that would leave a Keyframe past it is refused, naming it.
    message = await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "secs": 0.8}])
    assert "Text Layer title's x Keyframe at 1 s is past its length of 0.8 s; send its keys too" in message, message
    volume = {"volume": [{"at": 0, "value": 1}]}
    assert "no volume Keyframes" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "keys": volume}])

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [view] = plan["text_layers"]
    # In Timeline time, from its start at 0.2 s, with the presets by name; its box at each.
    assert view["keys"] == {
        "x": [{"at": 0.2, "value": 200, "ease": "linear"}, {"at": 1.2, "value": 880, "ease": "ease_out"}],
        "opacity": [{"at": 0.2, "value": 0, "ease": "linear"}, {"at": 0.7, "value": 1, "ease": [0.3, 0, 0.2, 1]}],
    }
    width = view["bounds"]["width"]
    assert [moment["at"] for moment in view["bounds_at_keys"]] == [0.2, 0.7, 1.2]
    middles = [moment["bounds"]["x"] + moment["bounds"]["width"] / 2 for moment in view["bounds_at_keys"]]
    assert middles[0] == pytest.approx(200, abs=1) and middles[2] == pytest.approx(880, abs=1)
    # To the pixel, its centre not on one.
    assert all(abs(moment["bounds"]["width"] - width) <= 1 for moment in view["bounds_at_keys"])

    # The owner's editor saves the same layer through the API: the same plan, so the same Clip.
    other = await manual(mcp, job, *HALO_KABAR)
    patch(client, job, other, text_layers=[made])
    by_agent = preview(client, job, candidate)["plan"]["texts"]
    by_editor = preview(client, job, other)["plan"]["texts"]
    assert by_agent == by_editor and by_agent[0]["picture"]["motion"]
