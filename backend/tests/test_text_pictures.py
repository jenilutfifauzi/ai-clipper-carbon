"""Text Layers as pictures (.scratch/text-advanced/issues/02-text-layers-as-pictures.md, docs/adr/0010):
the picture libass draws of a Text Layer, served by its name and swept with the Job's derived files,
and Seam A renders with the real ffmpeg of where, when and under what it is drawn.
"""


import cv2
import numpy as np
import pytest

from app.jobs import CANDIDATES_FILE
from app.text_pictures import TEXTS_DIR
from test_render import HEARD, add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_preview_copies import edit
from test_review import candidates, patch

def title(**fields) -> dict:
    return {"id": "t1", "text": "HALO", "start": 0.5, "secs": 1.5, **fields}


def picture_of(client, job: dict, event: dict) -> np.ndarray:
    """The picture a Text Layer's event names, as the preview fetches it: RGBA."""
    response = client.get(f"/api/jobs/{job['id']}/{TEXTS_DIR}/{event['image']}")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png" and "immutable" in response.headers["cache-control"]
    pixels = cv2.imdecode(np.frombuffer(response.content, np.uint8), cv2.IMREAD_UNCHANGED)
    return cv2.cvtColor(pixels, cv2.COLOR_BGRA2RGBA).astype(int)


def test_a_picture_is_clean_transparency_round_its_ink_and_made_once_for_its_look(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # White letters with a white stroke: any dark fringe would show where they meet transparency.
    white = {"size": 120, "colour": "#FFFFFF", "stroke_width": 6, "stroke_colour": "#FFFFFF"}
    candidate = patch(client, job, candidate, text_layers=[title(text="Halo Ägypten", style=white)])
    [event] = preview(client, job, candidate)["plan"]["texts"]
    picture = picture_of(client, job, event)
    assert (picture.shape[1], picture.shape[0]) == tuple(event["picture"]["item_size"])
    alpha = picture[..., 3]
    # Its edges are clear, the ink well inside them, and its area holds most of it.
    assert alpha[0].max() == alpha[-1].max() == alpha[:, 0].max() == alpha[:, -1].max() == 0
    assert (alpha == 0).mean() > 0.5
    edges = (alpha > 0) & (alpha < 255)
    assert edges.sum() > 500
    assert picture[edges][:, :3].min() >= 250

    # The same look is the same file, made once: moving the layer asks for nothing new.
    folder = settings.data_dir / "jobs" / job["id"] / TEXTS_DIR
    made = (folder / event["image"]).stat().st_mtime_ns
    moved = patch(client, job, candidate, text_layers=[title(text="Halo Ägypten", style=white, transform={"x": 300, "y": 1500})])
    [there] = preview(client, job, moved)["plan"]["texts"]
    assert there["image"] == event["image"] and there["area"] != event["area"]
    assert (folder / event["image"]).stat().st_mtime_ns == made
    # Another colour is another picture.
    [red] = preview(client, job, moved, {"text_layers": [title(text="Halo Ägypten", style=white | {"colour": "#FF0000"})]})["plan"]["texts"]
    assert red["image"] != event["image"]
    assert picture_of(client, job, red)[..., 0].max() == 255
    assert sorted(path.name for path in folder.iterdir()) == sorted([event["image"], red["image"]])

    assert client.get(f"/api/jobs/{job['id']}/{TEXTS_DIR}/{'0' * 24}.png").status_code == 404
    assert client.get(f"/api/jobs/{job['id']}/{TEXTS_DIR}/..%2F{CANDIDATES_FILE}").status_code == 404


def test_pictures_no_candidate_nor_revision_shows_are_swept_when_the_job_is_opened(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    folder = settings.data_dir / "jobs" / job["id"] / TEXTS_DIR
    first = edit(client, job, candidate, "advanced-edit", text_layers=[title(style={"colour": "#00FF00"})])
    [kept] = preview(client, job, first)["plan"]["texts"]
    # A later look saved over it by another editor: the first stays in the Revision History.
    second = edit(client, job, first, "agent", text_layers=[title(style={"colour": "#0000FF"})])
    [shown] = preview(client, job, second)["plan"]["texts"]
    # A draft never saved, and a part cut short.
    [draft] = preview(client, job, second, {"text_layers": [title(style={"colour": "#FF00FF"})]})["plan"]["texts"]
    (folder / ".cut.short.part.png").write_bytes(b"")
    assert len(list(folder.iterdir())) == 4

    candidates(client, job)
    assert sorted(path.name for path in folder.iterdir()) == sorted([kept["image"], shown["image"]])
    assert draft["image"] not in {kept["image"], shown["image"]}


def test_a_text_layer_draws_its_colour_stroke_and_plate_over_the_captions_and_under_the_hook(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), hook_text="HALO DUNIA")
    planned = preview(client, job, candidate)["plan"]
    hook = planned["hook"]["area"]
    caption = next(event for event in planned["captions"] if event["start"] <= 1.5 < event["end"])["area"]
    middle = lambda area: {"x": area["x"] + area["width"] / 2, "y": area["y"] + area["height"] / 2}
    opaque = lambda colour: {"shape": "block", "colour": colour, "opacity": 1, "padding_x": 120, "padding_y": 60}
    candidate = patch(client, job, candidate, text_layers=[
        # Green letters stroked in red, alone.
        title(id="stroked", text="IJ", start=0.0, secs=2.5, transform={"x": 540, "y": 1100},
              style={"size": 200, "colour": "#00FF00", "stroke_width": 12, "stroke_colour": "#FF0000"}),
        # A blue plate over the hook, a magenta one over the caption line.
        title(id="hooked", text="--", start=0.0, secs=2.5, transform=middle(hook), style={"size": 60, "colour": "#0000FF", "plate": opaque("#0000FF")}),
        title(id="captioned", text="--", start=0.0, secs=2.5, transform=middle(caption), style={"size": 60, "colour": "#FF00FF", "plate": opaque("#FF00FF")}),
    ])
    stroked, hooked, captioned = preview(client, job, candidate)["plan"]["texts"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)

    def inside(found: tuple[np.ndarray, np.ndarray], area: dict, reach: int) -> bool:
        rows, columns = found
        return (
            area["y"] - reach <= rows.min() and rows.max() <= area["y"] + area["height"] + reach
            and area["x"] - reach <= columns.min() and columns.max() <= area["x"] + area["width"] + reach
        )

    # The fill within the area, the stroke round it, reaching its width past the letters.
    green, red = pixels(frame, np.array([0, 255, 0])), pixels(frame, np.array([255, 0, 0]))
    assert len(green[0]) > 5000 and len(red[0]) > 3000
    assert inside(green, stroked["bounds"], 4) and inside(red, stroked["bounds"], 16)
    assert red[1].min() < green[1].min() - 6 and red[1].max() > green[1].max() + 6

    # Over the caption line: its plate hides the words, which are white and black.
    rows, columns = pixels(frame, np.array([255, 0, 255]))
    assert len(rows) > 0.95 * captioned["box"]["width"] * captioned["box"]["height"] - 4000
    assert inside((rows, columns), captioned["box"], 3)
    box = captioned["box"]
    under = frame[box["y"] + 8 : box["y"] + box["height"] - 8, box["x"] + 8 : box["x"] + box["width"] - 8]
    assert len(pixels(under, np.array([255, 255, 255]), 60)[0]) == 0

    # Under the hook: its box darkens the blue plate, and its white words show over it.
    box = hooked["box"]
    shown = frame[max(box["y"], hook["y"]) + 6 : min(box["y"] + box["height"], hook["y"] + hook["height"]) - 6,
                  max(box["x"], hook["x"]) + 6 : min(box["x"] + box["width"], hook["x"] + hook["width"]) - 6]
    assert shown.size and len(pixels(shown, np.array([0, 0, 255]))[0]) == 0
    assert len(pixels(shown, np.array([255, 255, 255]), 60)[0]) > 500
    assert len(pixels(frame, np.array([0, 0, 255]))[0]) > 2000


@pytest.mark.parametrize("animation", ["fade", "pop", "slide"])
def test_fade_pop_and_slide_bring_a_text_layer_on_and_off_as_the_hook_comes(
    client, settings, video_source, transcriber, plain_video, animation
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    moving = {"animation_in": animation, "animation_out": animation, "animation_ms": 600}
    candidate = patch(client, job, candidate, text_layers=[
        title(text="MM", start=0.5, secs=1.8, transform={"x": 540, "y": 900}, style={"size": 200, "colour": "#00FF00"}, **moving),
    ])
    [event] = preview(client, job, candidate)["plan"]["texts"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    area = event["area"]
    # Round the layer's area, as the Clip shows it before the layer comes on.
    x0, y0, x1, y1 = area["x"] - 100, area["y"] - 100, area["x"] + area["width"] + 100, area["y"] + area["height"] + 100
    behind = full_frame(settings, video, 0.2)[y0:y1, x0:x1]

    def look(at: float) -> tuple[int, float, tuple[int, int, int, int]]:
        """How many pixels round the area show the green at `at`, how strong it is (the share of
        the way from what is behind to full green, in the middle row of its letters), and the box
        holding them, on the frame."""
        frame = full_frame(settings, video, at)[y0:y1, x0:x1]
        shown = np.abs(frame - behind).max(axis=2) > 30
        if not shown.any():
            return 0, 0.0, (0, 0, 0, 0)
        rows, columns = np.nonzero(shown)
        row = rows.min() + (rows.max() - rows.min()) // 2
        middle = columns[shown[row, columns]]
        strength = float(np.median((frame[row, middle, 1] - behind[row, middle, 1]) / (255 - behind[row, middle, 1])))
        return int(shown.sum()), strength, (x0 + columns.min(), y0 + rows.min(), x0 + columns.max() + 1, y0 + rows.max() + 1)

    # Off before and after; whole between the animations, at the plan's area.
    assert look(0.4)[0] == 0 and look(2.4)[0] == 0
    count, strength, whole = look(1.4)
    assert strength > 0.9
    # Its letters, within their side bearings of the area.
    assert abs(whole[0] - area["x"]) <= 12 and abs(whole[2] - area["x"] - area["width"]) <= 12
    # Half way in (0.3 s after its start) and half way out (0.3 s before its end), as the hook does.
    for at in (0.8, 2.0):
        _, strength, box = look(at)
        assert strength == pytest.approx(0.5, abs=0.12), (animation, at)
        if animation == "pop":
            # Grown from 70% to 85% of its width, about its middle.
            assert (box[2] - box[0]) / (whole[2] - whole[0]) == pytest.approx(0.85, abs=0.03), at
            assert (box[0] + box[2]) / 2 == pytest.approx((whole[0] + whole[2]) / 2, abs=3)
        elif animation == "slide":
            # Risen half of its 60 px.
            assert box[1] - whole[1] == pytest.approx(30, abs=3) and box[0] == pytest.approx(whole[0], abs=2)
        else:
            assert box == pytest.approx(whole, abs=2)


def test_tracking_spaces_a_pictures_letters_as_planned_about_its_middle(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    style = {"size": 120, "colour": "#FFFFFF"}
    plain, spaced, tight = preview(client, job, candidate, {"text_layers": [
        title(id="plain", style=style), title(id="spaced", style=style | {"tracking": 40}), title(id="tight", style=style | {"tracking": -8}),
    ]})["plan"]["texts"]

    def ink(event: dict) -> tuple[int, float]:
        """How wide the picture's letters are, and how far their middle is from the picture's."""
        columns = np.nonzero(picture_of(client, job, event)[..., 3].max(axis=0) > 128)[0]
        return columns.max() + 1 - columns.min(), (columns.min() + columns.max() + 1) / 2 - event["picture"]["item_size"][0] / 2

    (width, middle), (wider, spaced_middle), (narrower, tight_middle) = ink(plain), ink(spaced), ink(tight)
    # HALO: three gaps.
    assert wider - width == pytest.approx(3 * 40, abs=3) and narrower - width == pytest.approx(-3 * 8, abs=3)
    assert spaced["area"]["width"] - plain["area"]["width"] == pytest.approx(3 * 40, abs=1)
    assert spaced_middle == pytest.approx(middle, abs=2) and tight_middle == pytest.approx(middle, abs=2)


def test_a_shadow_falls_towards_its_angle_by_its_distance_softened_by_its_blur_and_strips_plate_each_line(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    letters = {"size": 160, "colour": "#00FF00"}
    red = {"colour": "#FF0000", "opacity": 1, "angle": 45, "distance": 30}
    strips = {"shape": "strips", "colour": "#0000FF", "opacity": 1, "padding_x": 30, "padding_y": 12, "radius": 10}
    candidate = patch(client, job, candidate, text_layers=[
        title(id="hard", text="HI", start=0, secs=2.5, transform={"x": 300, "y": 400}, style=letters | {"shadow": red}),
        title(id="soft", text="HI", start=0, secs=2.5, transform={"x": 780, "y": 400}, style=letters | {"shadow": red | {"blur": 24}}),
        title(id="halo", text="HI", start=0, secs=2.5, transform={"x": 540, "y": 800}, style=letters | {"shadow": red | {"distance": 0, "blur": 24}}),
        title(id="strips", text="A\nPANJANG", start=0, secs=2.5, transform={"x": 540, "y": 1100},
              style={"size": 90, "colour": "#FFFFFF", "line_height": 1.4, "plate": strips}),
    ])
    hard, soft, halo, stripped = preview(client, job, candidate)["plan"]["texts"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)

    def around(event: dict, reach: int = 90) -> np.ndarray:
        area = event["area"]
        return frame[area["y"] - reach : area["y"] + area["height"] + reach, area["x"] - reach : area["x"] + area["width"] + reach]

    def extent(mask: np.ndarray) -> tuple[int, int, int, int]:
        rows, columns = np.nonzero(mask)
        return columns.min(), rows.min(), columns.max(), rows.max()

    def green(shown: np.ndarray) -> np.ndarray:
        return (shown[..., 1] > 200) & (shown[..., 0] < 60)

    def reddish(shown: np.ndarray, by: int = 24) -> np.ndarray:
        """Red over the grey behind, at any strength."""
        return (shown[..., 0] - shown[..., 1] > by) & (shown[..., 1] < 150)

    def edge(shown: np.ndarray) -> float:
        """The share of the red that is part way between red and the grey behind."""
        return (reddish(shown) & ~reddish(shown, 140)).sum() / reddish(shown).sum()

    # Down and to the right by 30 px at 45°: 21 px each way past the letters, none left of or above them.
    shown = around(hard)
    letters_box, shadow_box = extent(green(shown)), extent(reddish(shown))
    assert shadow_box[2] - letters_box[2] == pytest.approx(21, abs=3) and shadow_box[3] - letters_box[3] == pytest.approx(21, abs=3)
    assert shadow_box[0] >= letters_box[0] + 15 and shadow_box[1] >= letters_box[1] + 15
    assert edge(shown) < 0.2

    # Blurred, it reaches further and mostly fades.
    shown = around(soft)
    assert extent(reddish(shown))[2] - extent(green(shown))[2] > shadow_box[2] - letters_box[2] + 8
    assert edge(shown) > 0.6

    # At no distance, a halo as far round the letters on every side.
    shown = around(halo)
    letters_box, halo_box = extent(green(shown)), extent(reddish(shown))
    reaches = [letters_box[0] - halo_box[0], letters_box[1] - halo_box[1], halo_box[2] - letters_box[2], halo_box[3] - letters_box[3]]
    assert min(reaches) >= 8 and max(reaches) - min(reaches) <= 6, reaches

    # Strips: one blue plate round each line, as wide as it, where the layout puts them.
    picture = stripped["picture"]
    corner = (picture["centre"][0] - picture["width"] / 2, picture["centre"][1] - picture["height"] / 2)
    plates = [
        {"x": round(corner[0] + box["x"]), "y": round(corner[1] + box["y"]), "width": box["width"], "height": box["height"]}
        for box in stripped["layout"]["plates"]
    ]
    assert len(plates) == 2 and plates[0]["width"] < plates[1]["width"] - 200
    rows, columns = pixels(frame, np.array([0, 0, 255]))
    for box in plates:
        inside = (rows >= box["y"] + 3) & (rows <= box["y"] + box["height"] - 3)
        assert columns[inside].min() == pytest.approx(box["x"], abs=3)
        assert columns[inside].max() == pytest.approx(box["x"] + box["width"], abs=3)
    # The video shows between them.
    between = frame[plates[0]["y"] + plates[0]["height"] + 3 : plates[1]["y"] - 3, plates[1]["x"] + 10 : plates[1]["x"] + plates[1]["width"] - 10]
    assert between.size and len(pixels(between, np.array([0, 0, 255]))[0]) == 0
