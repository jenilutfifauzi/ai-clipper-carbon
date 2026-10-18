"""Shapes (.scratch/shapes/issues/02-tracer-a-rectangle-from-the-stickers-tab.md, docs/adr/0011): a
Shape saved on the Candidate, planned as a picture layer, drawn by libass into a picture of its own,
and burned into the Clip over the captions and under the Text Layers.
"""

import json
from dataclasses import replace

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Shape
from app.jobs import CANDIDATES_FILE
from app.planner import MAX_TEXT_PICTURE, Box, ShapeEvent, plan_render, shape_event, text_event
from app.text_pictures import TEXTS_DIR
from app.video_source import SourceMetadata
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_through_mcp
from test_render import HEARD, add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, candidates, patch
from test_text_layers import layer as text_layer
from test_text_pictures import picture_of

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
    assert max(huge.layout.raster) <= MAX_TEXT_PICTURE


def test_shapes_are_picture_layers_drawn_after_the_captions_and_before_the_text_layers():
    title = text_layer()
    planned = plan_render(10.0, 20.0, SOURCE, text_layers=[title], shapes=[shape(id="a"), shape(id="b", start=12)])
    # A Shape that starts after the Clip ends isn't shown.
    assert [event.layer.id for event in planned.shapes] == ["a"]
    assert [event.layer.id for event in planned.picture_layers] == ["a", "t1"]
    assert planned.picture_layers[1] == text_event(title, 10.0)
    # Without Shapes, the plan is as it was.
    assert plan_render(10.0, 20.0, SOURCE, text_layers=[title]).picture_layers == [text_event(title, 10.0)]


def test_a_shape_is_never_stretched_nor_flipped_nor_left_with_nothing_to_draw():
    for transform, refused in (({"stretch_x": 2}, "stretched"), ({"stretch_y": 0.5}, "stretched"), ({"flip_h": True}, "flipped"), ({"flip_v": True}, "flipped")):
        with pytest.raises(ValidationError, match=f"Shape s1 can't be {refused}"):
            shape(transform)
    with pytest.raises(ValidationError, match="Shape s1 has nothing to draw"):
        shape(style={"fill": None})
    # Scaled, turned and faded, as a Text Layer is.
    assert shape({"scale": 2, "rotation": 15, "opacity": 0.5}).transform.rotation == 15


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
        "style": {"kind": "rectangle", "width": 400, "height": 400, "fill": "#FFFFFF"},
        "animation_in": "none", "animation_out": "none", "animation_ms": 300, "keys": {},
    }
    [part] = client.get(f"{candidate_url(job, candidate)}/revisions").json()["revisions"][0]["parts"]
    assert part == "Shapes"

    for bad, said in (
        ([plate(transform={"stretch_x": 2})], "can't be stretched"),
        ([plate(transform={"flip_v": True})], "can't be flipped"),
        ([plate(style={"fill": None})], "nothing to draw"),
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


def test_shape_pictures_no_candidate_shows_are_swept_when_the_job_is_opened(client, settings):
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "halo", "ya"), shapes=[plate(style={"fill": "#00FF00"})])
    [kept] = preview(client, job, candidate)["plan"]["shapes"]
    [draft] = preview(client, job, candidate, {"shapes": [plate(style={"fill": "#FF00FF"})]})["plan"]["shapes"]
    folder = settings.data_dir / "jobs" / job["id"] / TEXTS_DIR
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
