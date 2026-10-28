"""Shapes (.scratch/shapes/issues/02-tracer-a-rectangle-from-the-stickers-tab.md,
03-rectangle-look.md, 04-six-more-figures.md, docs/adr/0011): a Shape saved on the Candidate,
planned as a picture layer, drawn by libass into a picture of its own (its figure, its fill, its
stroke inside its width and height, its rounded corners and its drop shadow; a line or an arrow all
stroke), and burned into the Clip over the captions and under the Text Layers.
"""

import json
from dataclasses import replace

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Shape
from app.canvas import PORTRAIT
from app.jobs import CANDIDATES_FILE
from app.layer_pictures import PICTURES_DIR
from app.planner import MAX_LAYER_PICTURE, Box, ShapeEvent, plan_render, shape_event, text_event
from app.video_source import SourceMetadata
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_through_mcp
from test_render import HEARD, add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, candidates, patch
from test_text_layers import layer as text_layer
from test_layer_pictures import picture_of

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
_SHAPE = TypeAdapter(Shape)


def shape(transform: dict | None = None, style: dict | None = None, **fields) -> Shape:
    given = {"id": "s1", "start": 1.0, "secs": 2.0, "transform": transform or {}, "style": style or {}, **fields}
    return _SHAPE.validate_python(given)


def plate(**fields) -> dict:
    """A Shape as the API takes it: from 0.5 s for 1.5 s, the rest its defaults."""
    return {"id": "s1", "start": 0.5, "secs": 1.5, **fields}


# Planner (pure)


def test_a_shape_is_centred_on_its_transform_and_holds_its_width_and_height():
    event = shape_event(shape({"x": 400, "y": 700}, {"width": 300, "height": 200}), 10)
    assert isinstance(event, ShapeEvent)
    assert event.area == event.bounds == Box(250, 600, 300, 200)
    assert event.picture.centre == pytest.approx((400, 700))
    assert (event.start, event.end) == (1.0, 3.0)
    # Its picture holds the figure and a little room round it, its centre the figure's.
    assert event.layout.width >= 300 and event.layout.height >= 200
    assert event.layout.width - 300 == event.layout.height - 200
    # Scaled and turned, its box stands twice as large on end about its centre.
    turned = shape_event(shape({"x": 400, "y": 700, "scale": 2, "rotation": 90}, {"width": 300, "height": 200}), 10)
    assert turned.area == event.area and turned.layout == replace(event.layout, scale=2.0)
    assert turned.bounds == Box(200, 400, 400, 600)
    # Ended with the Clip, or not shown at all past it.
    assert shape_event(shape(start=9, secs=5), 10).end == 10
    assert shape_event(shape(start=10), 10) is None


def test_a_shapes_picture_is_made_at_the_scale_it_reaches_and_never_larger_than_the_cap():
    def made(**fields) -> ShapeEvent:
        event = shape_event(shape(**fields), 10)
        assert event is not None
        return event

    assert [made(transform={"scale": scale}).layout.scale for scale in (0.3, 1, 1.2, 2.5, 8)] == [1, 1, 1.5, 3, 8]
    # Keyed, from its largest scale Keyframe: the Keyframes replace its Transform's.
    keyed = made(keys={"scale": [{"at": 0, "value": 0.5}, {"at": 1, "value": 2.5}]})
    assert keyed.layout.scale == 3
    # One look is one picture key at every scale; another size is another.
    assert made(transform={"scale": 2}).picture_key == made().picture_key != made(style={"width": 401}).picture_key
    assert made(transform={"scale": 2}).image != made().image
    huge = made(transform={"scale": 8}, style={"width": 4000, "height": 1000})
    assert max(huge.layout.raster) <= MAX_LAYER_PICTURE


def test_shapes_are_picture_layers_drawn_after_the_captions_and_before_the_text_layers():
    title = text_layer()
    planned = plan_render(10.0, 20.0, SOURCE, text_layers=[title], shapes=[shape(id="a"), shape(id="b", start=12)], canvas=PORTRAIT)
    # A Shape that starts after the Clip ends isn't shown.
    assert [event.layer.id for event in planned.shapes] == ["a"]
    assert [event.layer.id for event in planned.picture_layers] == ["a", "t1"]
    assert planned.picture_layers[1] == text_event(title, 10.0, canvas=PORTRAIT)
    # Without Shapes, the plan is as it was.
    assert plan_render(10.0, 20.0, SOURCE, text_layers=[title], canvas=PORTRAIT).picture_layers == [text_event(title, 10.0, canvas=PORTRAIT)]


def test_a_shape_is_never_stretched_nor_flipped_nor_left_with_nothing_to_draw():
    for transform, refused in (({"stretch_x": 2}, "stretched"), ({"stretch_y": 0.5}, "stretched"), ({"flip_h": True}, "flipped"), ({"flip_v": True}, "flipped")):
        with pytest.raises(ValidationError, match=f"Shape s1 can't be {refused}"):
            shape(transform)
    with pytest.raises(ValidationError, match="Shape s1 has nothing to draw: give its style a fill or a stroke"):
        shape(style={"fill": None})
    with pytest.raises(ValidationError, match="Shape s1 has nothing to draw"):
        shape(style={"fill": None, "stroke_width": 0, "stroke_colour": "#FF0000"})
    # An outline alone is something to draw.
    assert shape(style={"fill": None, "stroke_width": 6}).style.fill is None
    # Scaled, turned and faded, as a Text Layer is.
    assert shape({"scale": 2, "rotation": 15, "opacity": 0.5}).transform.rotation == 15


def test_a_shapes_stroke_and_corners_keep_its_bounds_and_its_shadow_grows_its_picture_to_hold_it():
    plain = shape_event(shape({"x": 400, "y": 700}, {"width": 300, "height": 200}), 10)
    # Drawn inside its width and height: no stroke, however thick, nor corner makes it larger.
    for look in ({"stroke_width": 4}, {"stroke_width": 60, "fill": None}, {"radius": 0.5}):
        event = shape_event(shape({"x": 400, "y": 700}, {"width": 300, "height": 200, **look}), 10)
        assert (event.area, event.bounds) == (plain.area, plain.bounds)
        assert (event.layout.width, event.layout.height) == (plain.layout.width, plain.layout.height)
    # Its picture holds the shadow's distance and its blur's reach on every side, about the same centre.
    shadowed = shape_event(shape({"x": 400, "y": 700}, {"width": 300, "height": 200, "shadow": {"distance": 12, "blur": 6}}), 10)
    assert shadowed.layout.width - plain.layout.width in (2 * (12 + 9), 2 * (12 + 9) + 2)
    assert shadowed.layout.height - plain.layout.height in (2 * (12 + 9), 2 * (12 + 9) + 2)
    assert (shadowed.area, shadowed.bounds) == (plain.area, plain.bounds)
    assert shadowed.picture.centre == plain.picture.centre
    # An unseen shadow takes no room.
    unseen = shape_event(shape({"x": 400, "y": 700}, {"width": 300, "height": 200, "shadow": {"distance": 12, "opacity": 0}}), 10)
    assert unseen.layout.width == plain.layout.width


# Model and API


def test_shapes_are_saved_on_the_candidate_with_their_defaults_and_bad_ones_are_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    saved = patch(client, job, candidate, shapes=[plate()])
    assert saved["edited"] is True and saved["revision"] == candidate["revision"] + 1
    [stored] = saved["shapes"]
    assert stored == {
        "id": "s1", "start": 0.5, "secs": 1.5,
        "transform": {"x": 540, "y": 960, "scale": 1.0, "stretch_x": 1.0, "stretch_y": 1.0, "rotation": 0.0, "flip_h": False, "flip_v": False, "opacity": 1.0},
        "style": {
            "kind": "rectangle", "width": 400, "height": 400, "fill": "#FFFFFF", "stroke_colour": "#000000", "stroke_width": 0,
            "radius": 0.0, "shadow": {"colour": "#000000", "opacity": 0.6, "blur": 0.0, "distance": 0.0, "angle": 45.0},
        },
        "animation_in": "none", "animation_out": "none", "animation_ms": 300, "keys": {}, "template": None,
    }
    [part] = client.get(f"{candidate_url(job, candidate)}/revisions").json()["revisions"][0]["parts"]
    assert part == "Shapes"

    for bad, said in (
        ([plate(transform={"stretch_x": 2})], "can't be stretched"),
        ([plate(transform={"flip_v": True})], "can't be flipped"),
        ([plate(style={"fill": None})], "nothing to draw"),
        ([plate(style={"fill": None, "stroke_width": 0})], "nothing to draw"),
        ([plate(style={"stroke_width": -1})], "stroke_width"),
        ([plate(style={"stroke_width": 201})], "stroke_width"),
        ([plate(style={"stroke_colour": "red"})], "stroke_colour"),
        ([plate(style={"radius": 0.6})], "radius"),
        ([plate(style={"shadow": {"distance": 101}})], "distance"),
        ([plate(style={"kind": "hexagon"})], "kind"),
        ([plate(style={"width": 0})], "width"),
        ([plate(style={"height": 5000})], "height"),
        ([plate(secs=0)], "secs"),
        ([plate(), plate()], "same id"),
        ([plate(surprise=1)], "surprise"),
        ([plate(start=30)], "starts after the clip ends"),
    ):
        response = client.patch(candidate_url(job, candidate), json={"shapes": bad, "revision": saved["revision"]})
        assert response.status_code == 422, bad
        assert said in response.text, response.text
    # Trimming the Clip leaves its Shapes where they were in it.
    trimmed = patch(client, job, saved, start=saved["start"] + 0.4)
    assert trimmed["shapes"] == saved["shapes"]


def test_a_stored_candidate_without_shapes_reads_with_none_and_plans_as_before(client, settings):
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "halo", "ya"), text_layers=[{"id": "t1", "text": "Judul", "start": 0, "secs": 1}])
    planned = preview(client, job, candidate)["plan"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    stored = json.loads((job_dir / CANDIDATES_FILE).read_text())
    for entry in stored:
        entry.pop("shapes", None)
    (job_dir / CANDIDATES_FILE).write_text(json.dumps(stored))

    [read] = [c for c in candidates(client, job) if c["id"] == candidate["id"]]
    assert read["shapes"] == [] and read["text_layers"] == candidate["text_layers"]
    again = preview(client, job, read)["plan"]
    assert again["shapes"] == [] and again["texts"] == planned["texts"]


# Pictures and renders


def test_a_shapes_picture_is_its_fill_with_clean_alpha_at_the_scale_it_is_drawn(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(client, job, candidate, shapes=[plate(transform={"scale": 1.2}, style={"width": 300, "height": 120, "fill": "#00ff00"})])
    assert candidate["shapes"][0]["style"]["fill"] == "#00FF00"
    [event] = preview(client, job, candidate)["plan"]["shapes"]
    picture = picture_of(client, job, event)
    assert (picture.shape[1], picture.shape[0]) == tuple(event["picture"]["item_size"])
    alpha = picture[..., 3]
    # Clear at its edges, the figure opaque green and 1.5 times its size (its picture's scale).
    assert alpha[0].max() == alpha[-1].max() == alpha[:, 0].max() == alpha[:, -1].max() == 0
    rows, columns = np.nonzero(alpha > 127)
    assert columns.max() + 1 - columns.min() == pytest.approx(450, abs=1)
    assert rows.max() + 1 - rows.min() == pytest.approx(180, abs=1)
    # Centred in its picture.
    assert (columns.min() + columns.max() + 1) / 2 == pytest.approx(picture.shape[1] / 2, abs=0.5)
    assert (rows.min() + rows.max() + 1) / 2 == pytest.approx(picture.shape[0] / 2, abs=0.5)
    inside = picture[rows.min() + 1 : rows.max(), columns.min() + 1 : columns.max()]
    assert (inside == [0, 255, 0, 255]).all()
    # No dark fringe where it meets transparency.
    edges = (alpha > 0) & (alpha < 255)
    assert picture[edges][:, 1].min() >= 250 if edges.any() else True
    # Drawn on the frame at its own scale, whatever its picture's.
    assert event["picture"]["width"] == pytest.approx(1.2 * event["layout"]["width"], abs=2)


def drawn(client, job: dict, candidate: dict, **style) -> tuple[np.ndarray, int, int]:
    """The picture of a Shape of `style` at scale 1, as the preview fetches it, and where its
    figure's top-left corner is in it (its figure the size of its area: a line's its length by its
    thickness)."""
    [event] = preview(client, job, candidate, {"shapes": [plate(style=style)]})["plan"]["shapes"]
    assert event["layout"]["scale"] == 1
    picture = picture_of(client, job, event)
    area = event["area"]
    return picture, (picture.shape[1] - area["width"]) // 2, (picture.shape[0] - area["height"]) // 2


@pytest.mark.parametrize("width, height", [(400, 400), (1000, 200)])
def test_an_outline_alone_is_the_strokes_colour_within_its_width_of_every_edge_and_clear_inside(client, width, height):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    stroke = 16
    picture, left, top = drawn(client, job, candidate, width=width, height=height, fill=None, stroke_colour="#FF0000", stroke_width=stroke)
    right, bottom = left + width, top + height
    red = [255, 0, 0, 255]
    # Along each edge, a quarter, half and three quarters of the way: the stroke's colour through its
    # width, clear past it, and clear outside the figure.
    for share in (0.25, 0.5, 0.75):
        x, y = round(left + share * width), round(top + share * height)
        for depth in (1, stroke // 2, stroke - 2):
            assert picture[top + depth, x].tolist() == red, ("top", share, depth)
            assert picture[bottom - 1 - depth, x].tolist() == red, ("bottom", share, depth)
            assert picture[y, left + depth].tolist() == red, ("left", share, depth)
            assert picture[y, right - 1 - depth].tolist() == red, ("right", share, depth)
        for depth in (stroke + 2, stroke + 20):
            assert picture[top + depth, x, 3] == picture[bottom - 1 - depth, x, 3] == 0, ("inside", share, depth)
            assert picture[y, left + depth, 3] == picture[y, right - 1 - depth, 3] == 0, ("inside", share, depth)
        assert picture[top - 2, x, 3] == picture[bottom + 1, x, 3] == picture[y, left - 2, 3] == picture[y, right + 1, 3] == 0
    # Clear in the middle, and the stroke as thick on every side.
    assert picture[top + height // 2, left + width // 2, 3] == 0
    ink = picture[..., 3] > 127
    across, down = ink[top + height // 2], ink[:, left + width // 2]
    assert across.sum() == pytest.approx(2 * stroke, abs=1) and down.sum() == pytest.approx(2 * stroke, abs=1)


def test_a_thicker_stroke_draws_inside_the_same_edges_over_its_fill(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    for stroke in (4, 40):
        picture, left, top = drawn(client, job, candidate, width=500, height=300, fill="#0000FF", stroke_colour="#FFFF00", stroke_width=stroke)
        rows, columns = np.nonzero(picture[..., 3] > 127)
        assert (columns.min(), columns.max() + 1, rows.min(), rows.max() + 1) == (left, left + 500, top, top + 300)
        # Its stroke at its edge, its fill inside it, with no seam between them.
        assert picture[top + stroke // 2, left + 250].tolist() == [255, 255, 0, 255]
        assert picture[top + stroke + 2, left + 250].tolist() == [0, 0, 255, 255]
        inside = picture[top + 1 : top + 299, left + 1 : left + 499]
        assert (inside[..., 3] == 255).all()


def test_a_pills_corners_are_clear_and_its_middle_is_filled(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    picture, left, top = drawn(client, job, candidate, width=600, height=200, fill="#00FF00", radius=0.5)
    right, bottom = left + 600, top + 200
    alpha = picture[..., 3]
    # Each corner of its box is clear: its ends are half circles of its height.
    for x, y in ((left + 8, top + 8), (right - 9, top + 8), (left + 8, bottom - 9), (right - 9, bottom - 9)):
        assert alpha[y, x] == 0, (x, y)
    # Its middle, and the middle of each end, are filled.
    for x, y in ((left + 300, top + 100), (left + 3, top + 100), (right - 4, top + 100), (left + 300, top + 2), (left + 300, bottom - 3)):
        assert picture[y, x].tolist() == [0, 255, 0, 255], (x, y)
    # Its ends are round: 50 px above the middle, the left end's edge is 86.6 px left of its circle's centre.
    assert alpha[top + 50, left + 100 - 84] == 255 and alpha[top + 50, left + 100 - 90] == 0
    # A smaller radius rounds less: 0.1 of the shorter side, 20 px.
    picture, left, top = drawn(client, job, candidate, width=600, height=200, fill="#00FF00", radius=0.1)
    assert picture[top + 2, left + 2, 3] == 0 and picture[top + 8, left + 8, 3] == 255 and picture[top + 2, left + 30, 3] == 255


def test_a_rounded_outlines_inner_corners_are_rounded_less_by_its_stroke(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # Corners 40 px round, a stroke 16 px thick: inside, its corners 24 px round.
    picture, left, top = drawn(client, job, candidate, width=400, height=400, fill=None, stroke_colour="#FFFFFF", stroke_width=16, radius=0.1)
    alpha = picture[..., 3]
    assert alpha[top + 2, left + 2] == 0
    # On the diagonal into the corner, the stroke is 16 px thick, as on its sides.
    diagonal = [alpha[top + i, left + i] > 127 for i in range(0, 60)]
    thick = sum(diagonal) * np.sqrt(2)
    assert thick == pytest.approx(16, abs=3)
    assert alpha[top + 60, left + 60] == 0


# Six more figures (04-six-more-figures.md)

# Where each filled figure, 400 x 300, has ink and where it has none: points as shares of its width
# and height from its top-left corner.
FIGURES = {
    # Its edge touches the middle of each side of its box; its corners are clear.
    "ellipse": (
        [(0.5, 0.5), (0.5, 0.03), (0.03, 0.5), (0.97, 0.5), (0.5, 0.97), (0.8, 0.8), (0.2, 0.2)],
        [(0.03, 0.03), (0.97, 0.03), (0.03, 0.97), (0.97, 0.97), (0.9, 0.9), (0.1, 0.1)],
    ),
    # Point up, in the middle of its top; its base the box's bottom.
    "triangle": (
        [(0.5, 0.05), (0.5, 0.5), (0.03, 0.98), (0.97, 0.98)],
        [(0.05, 0.05), (0.95, 0.05), (0.2, 0.5), (0.8, 0.5)],
    ),
    # Leaning right: its top-right and bottom-left corners are its box's, the others clear.
    "parallelogram": (
        [(0.5, 0.5), (0.97, 0.03), (0.03, 0.97)],
        [(0.03, 0.03), (0.97, 0.97)],
    ),
    # Narrower at the top: its bottom corners are its box's, its top ones clear.
    "trapezoid": (
        [(0.5, 0.5), (0.5, 0.03), (0.03, 0.97), (0.97, 0.97)],
        [(0.05, 0.05), (0.95, 0.05)],
    ),
}


def test_every_filled_figure_fills_its_width_and_height_about_its_centre_and_a_line_and_an_arrow_are_their_stroke():
    for kind in ("rectangle", *FIGURES):
        event = shape_event(shape({"x": 400, "y": 700}, {"kind": kind, "width": 300, "height": 200}), 10)
        assert event.area == event.bounds == Box(250, 600, 300, 200), kind
        assert event.picture.centre == pytest.approx((400, 700))
    # A line is its length by its thickness, its height not used.
    line = shape_event(shape({"x": 400, "y": 700}, {"kind": "line", "width": 600, "height": 300, "stroke_width": 12}), 10)
    assert line.area == line.bounds == Box(100, 694, 600, 12)
    assert line.picture.centre == pytest.approx((400, 700))
    lower = shape_event(shape({"x": 400, "y": 700}, {"kind": "line", "width": 600, "height": 50, "stroke_width": 12}), 10)
    assert lower.area == line.area and (lower.layout.width, lower.layout.height) == (line.layout.width, line.layout.height)
    assert line.layout.height < 50
    # An arrow is its length by its head, four times its thickness, about the middle of its shaft.
    arrow = shape_event(shape({"x": 400, "y": 700, "rotation": 90}, {"kind": "arrow", "width": 600, "stroke_width": 12}), 10)
    assert arrow.area == Box(100, 676, 600, 48)
    assert arrow.bounds == Box(376, 400, 48, 600)


def test_a_line_or_an_arrow_with_no_stroke_width_is_refused_and_needs_no_fill(client):
    for kind, named in (("line", "a line"), ("arrow", "an arrow")):
        with pytest.raises(ValidationError, match=f"Shape s1 has nothing to draw: {named} is all stroke, its stroke_width its thickness"):
            shape(style={"kind": kind})
        assert shape(style={"kind": kind, "fill": None, "stroke_width": 4}).style.stroke_width == 4
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    response = client.patch(candidate_url(job, candidate), json={"shapes": [plate(style={"kind": "arrow", "width": 600})], "revision": candidate["revision"]})
    assert response.status_code == 422 and "an arrow is all stroke" in response.text, response.text
    saved = patch(client, job, candidate, shapes=[plate(style={"kind": "line", "width": 600, "stroke_width": 12})])
    assert saved["shapes"][0]["style"]["kind"] == "line"


@pytest.mark.parametrize("kind", FIGURES)
def test_each_filled_figure_has_ink_inside_it_and_none_outside_with_clean_alpha(client, kind):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    width, height = 400, 300
    picture, left, top = drawn(client, job, candidate, kind=kind, width=width, height=height, fill="#00FF00")

    def at(x: float, y: float) -> np.ndarray:
        return picture[top + min(round(y * height), height - 1), left + min(round(x * width), width - 1)]

    inside, outside = FIGURES[kind]
    for x, y in inside:
        assert at(x, y).tolist() == [0, 255, 0, 255], (kind, x, y)
    for x, y in outside:
        assert at(x, y)[3] == 0, (kind, x, y)
    # Nothing past its box: clear round it.
    alpha = picture[..., 3]
    rows, columns = np.nonzero(alpha)
    assert left - 1 <= columns.min() and columns.max() <= left + width and top - 1 <= rows.min() and rows.max() <= top + height
    # Across its middle it is as wide as its box (a triangle half as wide; a parallelogram and a
    # trapezoid less what their slant, a quarter of the shorter side, takes), and down its middle as tall.
    ink = alpha > 127
    across = {"ellipse": width, "triangle": width / 2, "parallelogram": width - 75, "trapezoid": width - 75}[kind]
    assert ink[top + height // 2].sum() == pytest.approx(across, abs=1.5)
    assert ink[:, left + width // 2].sum() >= height * 0.95
    # Clean alpha: where it is part covered, its colour is the fill's, with no dark fringe.
    edges = (alpha > 0) & (alpha < 255)
    assert edges.any() and picture[edges][:, 1].min() >= 250 and picture[edges][:, [0, 2]].max() <= 5


def thickness(alpha: np.ndarray, start: tuple[float, float], inward: tuple[float, float], reach: float = 60) -> float:
    """How far, in pixels, a walk from `start` (outside the figure) along `inward` goes through ink."""
    norm = np.hypot(*inward)
    steps = np.arange(0, reach, 0.25)
    xs = np.floor(start[0] + steps * inward[0] / norm).astype(int)
    ys = np.floor(start[1] + steps * inward[1] / norm).astype(int)
    return float((alpha[ys, xs] > 127).sum() * 0.25)


def test_an_outline_alone_ellipse_and_triangle_keep_the_strokes_thickness_all_round(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # A long ellipse: across its edge, its stroke is as thick near its ends as at its sides.
    width, height, stroke = 800, 200, 24
    picture, left, top = drawn(client, job, candidate, kind="ellipse", width=width, height=height, fill=None, stroke_colour="#FF0000", stroke_width=stroke)
    a, b = width / 2, height / 2
    cx, cy = left + a, top + b
    alpha = picture[..., 3]
    assert alpha[round(cy), round(cx)] == 0
    for turn in np.linspace(0, 2 * np.pi, 24, endpoint=False):
        normal = np.array([np.cos(turn) / a, np.sin(turn) / b])
        normal /= np.hypot(*normal)
        start = (cx + a * np.cos(turn) + 1.5 * normal[0], cy + b * np.sin(turn) + 1.5 * normal[1])
        assert thickness(alpha, start, (-normal[0], -normal[1])) == pytest.approx(stroke, abs=1.5), turn
    assert (picture[alpha == 255][:, :3] == [255, 0, 0]).all()
    # Thicker than its ends are round (25 px), its inside comes to a point there: no thinner anywhere,
    # and as thick where it is less round.
    stroke = 40
    picture, left, top = drawn(client, job, candidate, kind="ellipse", width=width, height=height, fill=None, stroke_colour="#FF0000", stroke_width=stroke)
    alpha = picture[..., 3]
    for turn in np.linspace(0, 2 * np.pi, 24, endpoint=False):
        normal = np.array([np.cos(turn) / a, np.sin(turn) / b])
        normal /= np.hypot(*normal)
        start = (cx + a * np.cos(turn) + 1.5 * normal[0], cy + b * np.sin(turn) + 1.5 * normal[1])
        across = thickness(alpha, start, (-normal[0], -normal[1]), reach=1.5 * stroke)
        assert across >= stroke - 1.5, turn
        if abs(np.cos(turn)) < 0.9:
            assert across == pytest.approx(stroke, abs=1.5), turn
    assert alpha[round(cy), round(cx) - 300 : round(cx) + 300].max() == 0

    # A triangle: across each side, a quarter, half and three quarters along it.
    width, height, stroke = 400, 300, 16
    picture, left, top = drawn(client, job, candidate, kind="triangle", width=width, height=height, fill=None, stroke_colour="#FF0000", stroke_width=stroke)
    alpha = picture[..., 3]
    corners = [(left + width / 2, top), (left + width, top + height), (left, top + height)]
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        # Going round clockwise on screen, its inside is on the right.
        inward = (-(y1 - y0), x1 - x0)
        outward = -np.array(inward) / np.hypot(*inward)
        for share in (0.25, 0.5, 0.75):
            x, y = x0 + share * (x1 - x0), y0 + share * (y1 - y0)
            assert thickness(alpha, (x + 1.5 * outward[0], y + 1.5 * outward[1]), inward) == pytest.approx(stroke, abs=1.5), (x0, y0, share)
    assert alpha[top + 200, left + 200] == 0


def test_a_line_and_an_arrow_are_ink_along_their_length_at_their_thickness_in_their_strokes_colour(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    length, stroke = 600, 12
    for kind, fill in (("line", "#FFFFFF"), ("line", None), ("arrow", "#FFFFFF")):
        picture, left, top = drawn(client, job, candidate, kind=kind, width=length, fill=fill, stroke_colour="#FF0000", stroke_width=stroke)
        alpha = picture[..., 3]
        ink = alpha > 127
        middle = top + (stroke if kind == "line" else 4 * stroke) / 2
        # Its length, end to end.
        columns = np.nonzero(ink.any(axis=0))[0]
        assert (columns.min(), columns.max() + 1) == pytest.approx((left, left + length), abs=1), kind
        # Along its shaft, as thick as its stroke about its middle, and in its colour whatever its fill.
        for share in (0.1, 0.3, 0.5, 0.7):
            column = ink[:, left + round(share * length)]
            assert column.sum() == pytest.approx(stroke, abs=1), (kind, share)
            assert abs(np.nonzero(column)[0].mean() + 0.5 - middle) <= 1
        assert (picture[alpha == 255][:, :3] == [255, 0, 0]).all()
        edges = (alpha > 0) & (alpha < 255)
        assert picture[edges][:, 0].min() >= 250 and picture[edges][:, 1:3].max() <= 5
        heights = ink[:, left : left + length].sum(axis=0)
        if kind == "line":
            assert heights.max() <= stroke + 1
            continue
        # An arrow's head is at its right end: four times its thickness tall where it starts, coming to a point.
        assert heights.max() == pytest.approx(4 * stroke, abs=2)
        assert np.argmax(heights) >= length - 4 * stroke
        assert heights[: length // 2].max() <= stroke + 1
        assert heights[-2] <= stroke / 2

    # Its drop shadow is the figure again, moved.
    picture, left, top = drawn(
        client, job, candidate, kind="line", width=length, stroke_colour="#FF0000", stroke_width=stroke,
        shadow={"colour": "#0000FF", "opacity": 1, "distance": 20, "angle": 90},
    )
    assert picture[top + stroke // 2, left + length // 2].tolist() == [255, 0, 0, 255]
    assert picture[top + 20 + stroke // 2, left + length // 2].tolist() == [0, 0, 255, 255]


def test_shape_pictures_no_candidate_shows_are_swept_when_the_job_is_opened(client, settings):
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "halo", "ya"), shapes=[plate(style={"fill": "#00FF00"})])
    [kept] = preview(client, job, candidate)["plan"]["shapes"]
    [draft] = preview(client, job, candidate, {"shapes": [plate(style={"fill": "#FF00FF"})]})["plan"]["shapes"]
    folder = settings.data_dir / "jobs" / job["id"] / PICTURES_DIR
    assert sorted(path.name for path in folder.iterdir()) == sorted([kept["image"], draft["image"]])
    candidates(client, job)
    assert [path.name for path in folder.iterdir()] == [kept["image"]]


def test_a_shape_is_burned_in_at_its_bounds_over_the_captions_and_under_the_text_layers(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    planned = preview(client, job, candidate)["plan"]
    caption = next(event for event in planned["captions"] if event["start"] <= 1.5 < event["end"])["area"]
    # A green bar across the caption line, and a magenta Text Layer plate over its left half.
    middle = {"x": caption["x"] + caption["width"] / 2, "y": caption["y"] + caption["height"] / 2}
    bar = plate(start=0.0, secs=2.5, transform=middle, style={"width": 900, "height": caption["height"] + 80, "fill": "#00FF00"})
    opaque = {"shape": "block", "colour": "#FF00FF", "opacity": 1, "radius": 0, "padding_x": 80, "padding_y": 40}
    title = {
        "id": "t1", "text": "--", "start": 0.0, "secs": 2.5, "transform": {"x": middle["x"] - 250, "y": middle["y"]},
        "style": {"size": 60, "colour": "#FF00FF", "plate": opaque},
    }
    candidate = patch(client, job, candidate, shapes=[bar], text_layers=[title])
    planned = preview(client, job, candidate)["plan"]
    [shown], [text] = planned["shapes"], planned["texts"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["shapes"] == candidate["shapes"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)

    # The bar fills its planned bounds but where the plate is over it; the caption's words don't show on it.
    bounds, box = shown["bounds"], text["box"]
    rows, columns = pixels(frame, np.array([0, 255, 0]))
    assert abs(rows.min() - bounds["y"]) <= 2 and abs(rows.max() + 1 - bounds["y"] - bounds["height"]) <= 2
    assert abs(columns.min() - bounds["x"]) <= 2 and abs(columns.max() + 1 - bounds["x"] - bounds["width"]) <= 2
    assert len(rows) > bounds["width"] * bounds["height"] - box["width"] * box["height"] - 6000
    covered = frame[caption["y"] + 4 : caption["y"] + caption["height"] - 4, box["x"] + box["width"] + 4 : bounds["x"] + bounds["width"] - 4]
    assert covered.size and len(pixels(covered, np.array([255, 255, 255]), 60)[0]) == 0
    # The Text Layer's plate over it.
    plated = frame[box["y"] + 4 : box["y"] + box["height"] - 4, box["x"] + 4 : box["x"] + box["width"] - 4]
    assert len(pixels(plated, np.array([255, 0, 255]))[0]) > 0.9 * plated.shape[0] * plated.shape[1]
    # Not there before it starts.
    assert len(pixels(full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 2.6), np.array([0, 255, 0]))[0]) == 0


def test_a_turned_shapes_corners_are_where_its_turned_bounds_say_in_a_rendered_frame(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # A green bar 300x120, half as large again and turned 30° clockwise.
    turned = plate(
        start=0.0, secs=2.5, transform={"x": 540, "y": 600, "rotation": 30, "scale": 1.5},
        style={"width": 300, "height": 120, "fill": "#00FF00"},
    )
    candidate = patch(client, job, candidate, shapes=[turned])
    [event] = preview(client, job, candidate)["plan"]["shapes"]
    # Its bounds are its 450x180 box stood on end by 30°.
    angle = np.radians(30)
    bounds = event["bounds"]
    assert bounds["width"] == pytest.approx(450 * np.cos(angle) + 180 * np.sin(angle), abs=2)
    assert bounds["height"] == pytest.approx(450 * np.sin(angle) + 180 * np.cos(angle), abs=2)
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)

    # The bar reaches its bounds on every side, and no further.
    rows, columns = pixels(frame, np.array([0, 255, 0]))
    assert abs(rows.min() - bounds["y"]) <= 3 and abs(rows.max() + 1 - bounds["y"] - bounds["height"]) <= 3
    assert abs(columns.min() - bounds["x"]) <= 3 and abs(columns.max() + 1 - bounds["x"] - bounds["width"]) <= 3
    # Each corner of its area, scaled about its centre and turned 30° clockwise, is a corner of the bar.
    area, (x, y) = event["area"], event["picture"]["centre"]
    for across in (area["x"], area["x"] + area["width"]):
        for down in (area["y"], area["y"] + area["height"]):
            u, v = 1.5 * (across - x), 1.5 * (down - y)
            row, column = y + u * np.sin(angle) + v * np.cos(angle), x + u * np.cos(angle) - v * np.sin(angle)
            # Within its antialiased tip, which the colour's tolerance leaves out.
            nearest = np.hypot(rows - row, columns - column).min()
            assert nearest <= 5, (across, down, nearest)
            # And green just inside it, towards the centre.
            inside = np.array([row - y, column - x])
            inside_row, inside_column = np.rint(np.array([row, column]) - 12 * inside / np.hypot(*inside)).astype(int)
            assert frame[inside_row, inside_column].tolist() == pytest.approx([0, 255, 0], abs=40), (across, down)


def test_a_shapes_shadow_falls_towards_its_angle_by_its_distance_in_a_rendered_frame(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    green = {"width": 200, "height": 200, "fill": "#00FF00"}
    red = {"colour": "#FF0000", "opacity": 1}
    placed = (
        ("se", {"x": 300, "y": 500}, {"angle": 45, "distance": 30}),
        ("w", {"x": 780, "y": 500}, {"angle": 180, "distance": 24}),
        ("n", {"x": 540, "y": 1000}, {"angle": -90, "distance": 20}),
    )
    shapes = [plate(id=id, start=0.0, secs=2.5, transform=at, style=green | {"shadow": red | shadow}) for id, at, shadow in placed]
    candidate = patch(client, job, candidate, shapes=shapes)
    planned = preview(client, job, candidate)["plan"]["shapes"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)

    def extent(event: dict, colour: list[int]) -> tuple[int, int, int, int]:
        """The left, top, right and bottom of `colour` round the Shape's area, from its area's corner."""
        area, reach = event["area"], 60
        around = frame[area["y"] - reach : area["y"] + area["height"] + reach, area["x"] - reach : area["x"] + area["width"] + reach]
        rows, columns = pixels(around, np.array(colour), 60)
        return columns.min() - reach, rows.min() - reach, columns.max() + 1 - reach, rows.max() + 1 - reach

    se, w, n = planned
    # The figure where it was planned, its shadow under it and past it towards the angle only.
    for event in planned:
        assert extent(event, [0, 255, 0]) == pytest.approx((0, 0, 200, 200), abs=2)
    # 30 px at 45°: 21 px right and down, showing where the figure doesn't cover it.
    assert extent(se, [255, 0, 0]) == pytest.approx((21, 21, 221, 221), abs=3)
    # 24 px at 180°: left of it, level with it.
    assert extent(w, [255, 0, 0]) == pytest.approx((-24, 0, 0, 200), abs=3)
    # 20 px at -90°: above it.
    assert extent(n, [255, 0, 0]) == pytest.approx((0, -20, 200, 0), abs=3)


# The agent's dry run


@pytest.mark.anyio
async def test_the_dry_run_lists_each_shapes_times_bounds_and_picture(mcp, client):
    job = await reviewed_through_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    [shown] = (await call(mcp, "edit_candidate", **ids, changes={"shapes": [plate(start=0, transform={"x": 300, "y": 400})]}, dry_run=True))["shapes"]
    assert (shown["id"], shown["start"], shown["end"]) == ("s1", 0, 1.5)
    assert shown["bounds"] == {"x": 100, "y": 200, "width": 400, "height": 400}
    picture = client.get(shown["picture"])
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/png"
