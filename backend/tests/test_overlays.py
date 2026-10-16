"""Overlays: videos and images laid over the Clip, picture in picture
(.scratch/advanced-edit/issues/07-overlays.md), each placed by its Transform
(.scratch/transform-crop/issues/01-overlay-transform.md), cut by its Crop
(.scratch/transform-crop/issues/02-crop.md) and decorated with corners, a border and a shadow
(.scratch/transform-crop/issues/08-overlay-decoration.md).

Seam B on the planner, the fitted size and the migration of old Overlays, then Seam A through the
API and the real ffmpeg.
"""

import json

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Border, Crop, Overlay, Shadow, Transform
from app.migration import migrated_candidate, migrated_overlay
from app.pictures import cover_scale, drawn_size
from app.planner import FRAME, OUTPUT_WIDTH, MediaInfo, overlay_events
from test_media_library import make, upload
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

CLIP = "ab" * 16
STILL = "cd" * 16
TALL = "ef" * 16
WIDE = "12" * 16
SQUARE = "34" * 16
ITEMS = {
    CLIP: MediaInfo(640, 360, 4.0, True),
    STILL: MediaInfo(200, 100, None, False),
    TALL: MediaInfo(540, 1080, None, False),
    WIDE: MediaInfo(1920, 1080, None, False),
    SQUARE: MediaInfo(1000, 1000, None, False),
}


def overlay(**fields) -> Overlay:
    return Overlay(**{"id": "o1", "media": CLIP, "start": 1.0, "secs": 2.0, **fields})


def drawn(transform: Transform, media: str = CLIP, crop: Crop = Crop()):
    [event] = overlay_events([overlay(media=media, transform=transform, crop=crop)], 10, ITEMS)
    return event.picture


def box(bounds) -> tuple[int, int, int, int]:
    return bounds.x, bounds.y, bounds.width, bounds.height


def test_a_picture_is_its_fitted_size_times_its_scale_and_stretch_and_a_cover_scale_fills_the_frame():
    # A 16:9 picture fits the frame's width: 1080 x 607.5, kept even.
    assert drawn_size(1920, 1080, Transform(), FRAME) == (1080, 608)
    assert drawn_size(1920, 1080, Transform(scale=0.5), FRAME) == (540, 304)
    assert cover_scale(1920, 1080, FRAME) == pytest.approx(1920 / 607.5)
    # A 9:16 one fits it exactly, and covers it at 1.
    assert drawn_size(540, 960, Transform(), FRAME) == (1080, 1920) and cover_scale(540, 960, FRAME) == pytest.approx(1)
    # Stretch is on top of the scale, on its own axis.
    assert drawn_size(1920, 1080, Transform(scale=0.5, stretch_x=2), FRAME) == (1080, 304)
    assert drawn_size(1920, 1080, Transform(scale=0.5, stretch_y=0.5), FRAME) == (540, 152)


def test_an_overlay_is_drawn_at_its_transform_and_kept_in_the_clip_and_its_video():
    picture = drawn(Transform(x=300, y=400, scale=0.5, opacity=0.4, flip_h=True))
    assert (picture.width, picture.height, picture.centre) == (540, 304, (300, 400))
    # The whole item, until it can be cropped.
    assert box(picture.crop) == (0, 0, 640, 360)
    assert (picture.opacity, picture.flip_h, picture.flip_v, picture.rotation) == (0.4, True, False, 0)
    assert box(picture.bounds) == (30, 248, 540, 304)
    [event] = overlay_events([overlay()], 10, ITEMS)
    assert (event.start, event.end, event.offset, event.image) == (1.0, 3.0, 0.0, False)
    # A new Overlay is half its fitted size at the frame's centre: 540 px wide for a wide item.
    assert box(event.picture.bounds) == (270, 808, 540, 304)
    # Cut where the Clip or its video ends.
    assert overlay_events([overlay(start=9.0)], 10, ITEMS)[0].end == 10
    assert overlay_events([overlay(offset=3.0)], 10, ITEMS)[0].end == 2.0
    # An image lasts as long as it is given; a missing item shows nothing.
    assert overlay_events([overlay(media=STILL, secs=8.0)], 10, ITEMS)[0].end == 9.0
    assert overlay_events([overlay(media="00" * 16)], 10, ITEMS) == []


def test_a_turned_picture_is_bounded_by_its_turned_box_about_the_same_centre():
    # 540x1080 fits as 960x1920: this scale draws it 100x200.
    small = 100 / 960
    picture = drawn(Transform(x=500, y=700, scale=small, rotation=90), TALL)
    assert (picture.width, picture.height, picture.rotation) == (100, 200, 90)
    assert box(picture.bounds) == (400, 650, 200, 100)
    assert box(drawn(Transform(x=500, y=700, scale=small, rotation=-180), TALL).bounds) == (450, 600, 100, 200)
    # At 45°, the box holds both sides' diagonals: (100 + 200) / √2 each way.
    assert box(drawn(Transform(x=500, y=700, scale=small, rotation=45), TALL).bounds) == (394, 594, 212, 212)


def test_the_centre_is_kept_on_the_frame_and_the_picture_may_go_past_its_edges():
    picture = drawn(Transform(x=1300, y=-40, scale=2))
    assert picture.centre == (OUTPUT_WIDTH, 0)
    assert (picture.width, picture.height) == (2160, 1216)
    assert box(picture.bounds) == (0, -608, 2160, 1216)


def test_a_centre_given_off_the_frame_is_clamped_onto_it_and_a_non_finite_one_is_refused():
    given = TypeAdapter(Transform)
    clamped = given.validate_python({"x": 1200, "y": -5, "scale": 2})
    assert (clamped.x, clamped.y, clamped.scale) == (OUTPUT_WIDTH, 0, 2)
    assert (given.validate_python({"y": 2500}).x, given.validate_python({"y": 2500}).y) == (540, 1920)
    for bad in (float("inf"), float("nan"), "x"):
        with pytest.raises(ValidationError):
            given.validate_python({"x": bad})


def test_the_crop_is_taken_in_item_pixels_before_the_picture_is_fitted():
    picture = drawn(Transform(), SQUARE, Crop(left=0.25))
    assert box(picture.crop) == (250, 0, 750, 1000) and picture.item_size == (1000, 1000)
    # What is fitted is the 750x1000 that is kept: 1080x1440, not the whole item's 1080x1080.
    assert (picture.width, picture.height) == (1080, 1440)
    assert box(drawn(Transform(), SQUARE, Crop(top=0.1, right=0.2, bottom=0.3)).crop) == (0, 100, 800, 600)


def test_a_crop_that_would_leave_less_than_a_tenth_is_pulled_back_by_its_second_edge():
    tidied = Crop(left=0.6, right=0.6)
    assert (tidied.left, tidied.right) == (0.6, pytest.approx(0.3))
    assert Crop(top=0.9, bottom=0.5) == Crop(top=0.9, bottom=0)
    assert Crop(left=0.2, right=0.7) == Crop(left=0.2, right=0.7)
    assert box(drawn(Transform(), SQUARE, Crop(left=0.6, right=0.6)).crop) == (600, 0, 100, 1000)


def test_corners_are_a_share_of_the_drawn_pictures_shorter_side_and_border_and_shadow_keep_their_pixels():
    # 540x304 at 0.5: a quarter of its shorter side is 76 px.
    [event] = overlay_events([overlay(radius=0.25)], 10, ITEMS)
    assert event.picture.radius == 76
    # It scales with the picture: twice as large, twice the radius. A tall 100x200 one at 0.5 is round.
    [large] = overlay_events([overlay(radius=0.25, transform=Transform(scale=1))], 10, ITEMS)
    assert large.picture.radius == 152
    [tall] = overlay_events([overlay(media=TALL, radius=0.5, transform=Transform(scale=100 / 960))], 10, ITEMS)
    assert tall.picture.radius == 50
    # The border and shadow are in output pixels, the same at any scale.
    border, shadow = Border(width=10, colour="#ff0000"), Shadow(blur=30, x=20, y=20, opacity=0.6)
    for scale in (0.2, 2):
        [decorated] = overlay_events([overlay(border=border, shadow=shadow, transform=Transform(scale=scale))], 10, ITEMS)
        assert (decorated.picture.border, decorated.picture.shadow) == (border, shadow)
    # Undecorated by default.
    assert (event.picture.border, event.picture.shadow, drawn(Transform()).radius) == (None, None, 0)


def test_an_old_overlay_becomes_the_transform_that_draws_the_same_box():
    old = {"id": "o1", "media": WIDE, "start": 1.0, "secs": 2.0, "offset": 0.0, "x": 300, "y": 500, "size": 540, "opacity": 0.8, "volume": 0.0}
    new = migrated_overlay(old, (1920, 1080))
    assert new == {
        "id": "o1", "media": WIDE, "start": 1.0, "secs": 2.0, "offset": 0.0, "volume": 0.0,
        "transform": {"x": 300, "y": 500, "scale": 0.5, "opacity": 0.8},
    }
    assert box(drawn(Transform(**new["transform"]), WIDE).bounds) == (30, 348, 540, 304)
    assert migrated_overlay(new, (1920, 1080)) == new
    # The old planner kept it inside the frame, and no taller than it: the new one draws that box.
    boxes = {
        (1000, 1900, 400, WIDE): (680, 1696, 400, 224),
        (540, 960, 2000, TALL): (60, 0, 960, 1920),
        (16, 16, 300, STILL): (0, 0, 300, 150),
    }
    for (x, y, size, media), expected in boxes.items():
        item = ITEMS[media]
        moved = migrated_overlay(old | {"media": media, "x": x, "y": y, "size": size}, (item.width, item.height))
        assert box(drawn(Transform(**moved["transform"]), media).bounds) == expected, (x, y, size)
    # A missing item is taken as 16:9. Of a Candidate, only the Overlays change.
    assert migrated_overlay(old, None)["transform"]["scale"] == 0.5
    candidate = {"id": "c1", "hook_text": "x", "overlays": [old]}
    assert migrated_candidate(candidate, {WIDE: (1920, 1080)}) == {"id": "c1", "hook_text": "x", "overlays": [new]}
    assert migrated_candidate({"id": "c1", "overlays": []}, {}) == {"id": "c1", "overlays": []}


@pytest.fixture(scope="session")
def pictures(tmp_path_factory) -> dict[str, bytes]:
    """A 3 s green 320x180 video with a tone, a blue 200x100 PNG, and a 200x200 PNG of four coloured
    quadrants: red top left, green top right, blue bottom left, yellow bottom right."""
    folder = tmp_path_factory.mktemp("overlay")
    lavfi = ("-f", "lavfi", "-i")
    quadrants = (
        "color=c=red:s=200x200[a];color=c=lime:s=100x100[b];color=c=blue:s=100x100[c];color=c=yellow:s=100x100[d];"
        "[a][b]overlay=100:0[ab];[ab][c]overlay=0:100[abc];[abc][d]overlay=100:100[out0]"
    )
    return {
        "green": make(folder / "green.mp4", *lavfi, "color=c=0x00ff00:size=320x180:rate=30:duration=3", *lavfi,
                      "sine=frequency=1500:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "blue": make(folder / "blue.png", *lavfi, "color=c=0x0000ff:size=200x100", "-frames:v", "1"),
        "quadrants": make(folder / "quadrants.png", *lavfi, quadrants, "-frames:v", "1"),
    }


def test_overlays_are_validated_and_burned_in_where_and_when_planned(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    green = upload(client, pictures["green"], "green.mp4").json()
    blue = upload(client, pictures["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # Both fit as wide as the frame: these scales draw them 400 and 300 px wide.
    on_video = {"id": "v", "media": green["id"], "start": 0.2, "secs": 1.0, "transform": {"x": 300, "y": 500, "scale": 400 / 1080}}
    on_image = {"id": "i", "media": blue["id"], "start": 1.4, "secs": 1.0, "transform": {"x": 700, "y": 1300, "scale": 300 / 1080}}
    for bad in (
        [on_video | {"offset": 2.5}],
        [on_video | {"media": "ef" * 16}],
        [on_video | {"transform": {"opacity": 2}}],
        [on_video | {"transform": {"scale": 9}}],
        [on_video | {"transform": {"x": "inf"}}],
    ):
        assert client.patch(candidate_url(job, candidate), json={"overlays": bad}).status_code == 422, bad
    # A centre off the frame is brought onto it.
    off = patch(client, job, candidate, overlays=[on_video | {"transform": {"x": 1100, "y": -20}}])
    assert (off["overlays"][0]["transform"]["x"], off["overlays"][0]["transform"]["y"]) == (1080, 0)
    candidate = off
    candidate = patch(client, job, candidate, overlays=[on_video, on_image])
    assert candidate["overlays"][0]["volume"] == 0
    assert candidate["overlays"][0]["transform"] | {"x": 0, "y": 0, "scale": 0} == {
        "x": 0, "y": 0, "scale": 0, "stretch_x": 1, "stretch_y": 1, "rotation": 0, "flip_h": False, "flip_v": False, "opacity": 1,
    }
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert [(event["start"], event["end"]) for event in planned] == [(0.2, 1.2), (1.4, 2.4)]
    # Muted by default: no sound of it is planned.
    assert preview(client, job, candidate)["plan"]["audio"] == []
    assert client.delete(f"/api/media/{blue['id']}").status_code == 409

    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["overlays"] == candidate["overlays"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def seen(at: float, colour: list[int], area: dict) -> tuple[int, bool]:
        frame = full_frame(settings, video, at)
        rows, columns = np.nonzero(np.abs(frame - np.array(colour)).max(axis=2) < 60)
        inside = len(rows) > 0 and area["y"] - 4 <= rows.min() and rows.max() <= area["y"] + area["height"] + 4 and \
            area["x"] - 4 <= columns.min() and columns.max() <= area["x"] + area["width"] + 4
        return len(rows), inside

    green_at, blue_at = planned[0]["picture"]["bounds"], planned[1]["picture"]["bounds"]
    assert (green_at["width"], blue_at["width"]) == (400, 300)
    count, inside = seen(0.7, [0, 255, 0], green_at)
    assert count > 0.8 * green_at["width"] * green_at["height"] and inside
    count, inside = seen(1.9, [0, 0, 255], blue_at)
    assert count > 0.8 * blue_at["width"] * blue_at["height"] and inside
    assert seen(1.9, [0, 255, 0], green_at)[0] == 0
    assert seen(0.7, [0, 0, 255], blue_at)[0] == 0


RED, GREEN, BLUE = np.array([255, 0, 0]), np.array([0, 255, 0]), np.array([0, 0, 255])


def test_a_turned_a_flipped_and_a_faded_overlay_render_as_they_are_planned(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    quadrants = upload(client, pictures["quadrants"], "quadrants.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 200x200 fits as 1080x1080: at 0.3 it is 324x324, each quadrant 162 px, its middle 81 px from the centre.
    shown = {"media": quadrants["id"], "start": 0.0, "secs": 2.0}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "turned", **shown, "transform": {"x": 540, "y": 400, "scale": 0.3, "rotation": 90}},
        {"id": "flipped", **shown, "transform": {"x": 540, "y": 780, "scale": 0.3, "flip_h": True}},
        {"id": "faded", **shown, "transform": {"x": 540, "y": 1150, "scale": 0.3, "opacity": 0.5}},
    ])
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert [event["picture"]["bounds"]["width"] for event in planned] == [324, 324, 324]

    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.0)

    def near(x: int, y: int, colour: np.ndarray, tolerance: int = 60) -> bool:
        return bool(np.abs(frame[y, x] - colour).max() <= tolerance)

    # Turned a quarter clockwise: the top-left quadrant (red) is at the top right, the bottom-left (blue) at the top left.
    assert near(540 + 81, 400 - 81, RED) and near(540 - 81, 400 - 81, BLUE)
    # Flipped left to right: red is at the top right, and the top-right quadrant (green) at the top left.
    assert near(540 + 81, 780 - 81, RED) and near(540 - 81, 780 - 81, GREEN)
    # At half opacity, red is mixed half and half with the picture under it.
    under = frame[1150, 100]
    assert near(540 - 81, 1150 - 81, (RED + under) / 2, tolerance=25) and not near(540 - 81, 1150 - 81, RED)


YELLOW = np.array([255, 255, 0])


def test_a_cropped_overlay_renders_only_what_it_keeps_and_its_crop_turns_with_it(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    quadrants = upload(client, pictures["quadrants"], "quadrants.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"media": quadrants["id"], "start": 0.0, "secs": 2.0}
    for bad in ({"left": 0.95}, {"top": -0.1}, {"right": "half"}):
        assert client.patch(candidate_url(job, candidate), json={"overlays": [{"id": "o", **shown, "crop": bad}]}).status_code == 422, bad
    tidied = patch(client, job, candidate, overlays=[{"id": "o", **shown, "crop": {"left": 0.6, "right": 0.6}}])["overlays"][0]["crop"]
    assert tidied == {"left": 0.6, "top": 0, "right": pytest.approx(0.3), "bottom": 0}
    # Its right half is kept, 100x200 (green over yellow), which fits as 960x1920: at 0.2, 192x384,
    # each quadrant 192 px, its middle 96 px from the centre.
    half = {"left": 0.5}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "cropped", **shown, "crop": half, "transform": {"x": 540, "y": 500, "scale": 0.2}},
        {"id": "turned", **shown, "crop": half, "transform": {"x": 540, "y": 1000, "scale": 0.2, "rotation": 90}},
    ])
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert [event["picture"]["crop"] for event in planned] == [{"x": 100, "y": 0, "width": 100, "height": 200}] * 2
    assert [event["picture"]["bounds"] for event in planned] == [
        {"x": 444, "y": 308, "width": 192, "height": 384}, {"x": 348, "y": 904, "width": 384, "height": 192},
    ]

    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.0)

    def near(x: int, y: int, colour: np.ndarray) -> bool:
        return bool(np.abs(frame[y, x] - colour).max() <= 60)

    def none_of(colour: np.ndarray, bounds: dict) -> bool:
        inside = frame[bounds["y"]:bounds["y"] + bounds["height"], bounds["x"]:bounds["x"] + bounds["width"]]
        return not (np.abs(inside - colour).max(axis=2) < 60).any()

    # The left quadrants' colours (red and blue) are gone: green is over yellow.
    assert near(540, 500 - 96, GREEN) and near(540, 500 + 96, YELLOW)
    # Turned a quarter clockwise, the crop with it: its top (green) is at the right.
    assert near(540 + 96, 1000, GREEN) and near(540 - 96, 1000, YELLOW)
    for event in planned:
        assert none_of(RED, event["picture"]["bounds"]) and none_of(BLUE, event["picture"]["bounds"])


def test_rounded_corners_a_border_and_a_shadow_render_as_they_are_planned(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    quadrants = upload(client, pictures["quadrants"], "quadrants.png").json()
    green = upload(client, pictures["green"], "green.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 200x200 at 0.3 is 324x324, from 162 px left of its centre to 162 px right; 320x180 at 0.3 is 324x182.
    shown = {"start": 0.0, "secs": 2.0}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "round", "media": quadrants["id"], **shown, "transform": {"x": 540, "y": 400, "scale": 0.3}, "radius": 0.5},
        # Turned a quarter: the shadow still falls right and down on the frame.
        {"id": "lifted", "media": quadrants["id"], **shown, "transform": {"x": 540, "y": 780, "scale": 0.3, "rotation": 90},
         "shadow": {"blur": 4, "x": 20, "y": 20, "opacity": 0.8}},
        {"id": "framed", "media": green["id"], **shown, "transform": {"x": 540, "y": 1150, "scale": 0.3}, "border": {"width": 10, "colour": "#ffffff"}},
    ])
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert planned[0]["picture"]["radius"] == 162
    assert planned[1]["picture"]["shadow"] == {"blur": 4, "x": 20, "y": 20, "colour": "#000000", "opacity": 0.8}
    assert planned[2]["picture"]["border"] == {"width": 10, "colour": "#FFFFFF"}

    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.0)

    def near(x: int, y: int, colour: np.ndarray, tolerance: int = 40) -> bool:
        return bool(np.abs(frame[y, x] - colour).max() <= tolerance)

    # What the Segment shows on row `y`, left of every Overlay (Blur's background, or its picture).
    def under(y: int) -> np.ndarray:
        return frame[y, 100]

    # A circle: the box's corners show the Segment, while its quadrants' middles are still the picture.
    for x, y in ((540 - 158, 400 - 158), (540 + 158, 400 - 158), (540 - 158, 400 + 158), (540 + 158, 400 + 158)):
        assert near(x, y, under(y), tolerance=12), (x, y)
    assert near(540 - 81, 400 - 81, RED) and near(540 + 81, 400 + 81, YELLOW)
    # The shadow darkens the Segment just right of and below the box, not left of it or above.
    darker = lambda x, y: frame[y, x].sum() < under(y).sum() - 60
    assert darker(540 + 172, 780) and darker(540, 780 + 172) and darker(540 + 172, 780 + 172)
    assert not darker(540 - 172, 780) and not darker(540, 780 - 172)
    # A 10 px white line runs along the inside of the video's edge, and the video is inside it.
    assert near(540 - 162 + 4, 1150, np.array([255, 255, 255])) and near(540 + 162 - 5, 1150 + 40, np.array([255, 255, 255]))
    assert near(540 - 162 + 20, 1150, GREEN) and near(540, 1150 - 91 + 4, np.array([255, 255, 255]))
    assert near(540 - 162 - 6, 1150, under(1150), tolerance=12)


def test_an_old_shape_overlay_is_refused_with_its_new_shape_named(client, pictures):
    blue = upload(client, pictures["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya", selected=False)
    old = {"id": "i", "media": blue["id"], "start": 0, "secs": 1, "x": 540, "y": 960, "size": 540}
    response = client.patch(candidate_url(job, candidate), json={"overlays": [old]})
    assert response.status_code == 422
    assert "transform" in response.text and "size" in response.text


def test_a_job_saved_with_old_overlays_reads_them_as_transforms_that_plan_the_same_box(client, settings, pictures):
    blue = upload(client, pictures["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya", selected=False)
    candidate = patch(client, job, candidate, overlays=[{"id": "i", "media": blue["id"], "start": 0, "secs": 1}])
    # Saved before Transforms: 300 px wide, centred near the right edge, so kept inside the frame.
    path = settings.data_dir / "jobs" / job["id"] / "candidates.json"
    stored = json.loads(path.read_text())
    old = {"id": "i", "media": blue["id"], "start": 0.0, "secs": 1.0, "offset": 0.0, "x": 1000, "y": 1300, "size": 300, "opacity": 0.5, "volume": 0.0}
    path.write_text(json.dumps([c | {"overlays": [old]} if c["id"] == candidate["id"] else c for c in stored]))

    [read] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    transform = read["overlays"][0]["transform"]
    assert (transform["x"], transform["y"], transform["opacity"]) == (930, 1300, 0.5)
    assert transform["scale"] == pytest.approx(300 / 1080)
    assert "size" not in read["overlays"][0] and read["revision"] == candidate["revision"]
    [event] = preview(client, job, read)["plan"]["overlays"]
    assert event["picture"]["bounds"] == {"x": 780, "y": 1225, "width": 300, "height": 150}

    # Written back in the new shape on the next save.
    patch(client, job, read, hook_text="Baru")
    [saved] = [c for c in json.loads(path.read_text()) if c["id"] == candidate["id"]]
    assert saved["overlays"][0]["transform"]["x"] == 930 and "size" not in saved["overlays"][0]
