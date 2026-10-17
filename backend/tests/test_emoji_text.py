"""Colour emoji in Text Layers (.scratch/text-advanced/issues/11-colour-emoji-in-text-layers.md,
docs/adr/0010): the planner makes a run of each emoji sequence, 1 em square, and the rasteriser pastes
its image there in its own colours; the hook, the Kicker, the Watermark and captions leave emoji out.

Seam B on the planner's runs and the captions, then the picture of a layout, a Seam A render with the
real ffmpeg, and the images' endpoint. The images are emojifiles.py's stand-ins.
"""

from dataclasses import replace

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import TextLayer
from app.config import load_settings
from app.planner import TextEvent, TextRun, emoji_square, font_metrics, text_event
from app.text_pictures import rasterised
from emojifiles import FLAG, QUARTERS
from test_planner import captioned, said, shown
from test_render import HEARD, add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch
from test_text_pictures import picture_of

_LAYER = TypeAdapter(TextLayer)
STYLE_FONT = "montserrat-extrabold"
FIRE = "emoji_u1f525.png"
FAMILY = "👨‍👩‍👧"


def layer(text: str, **style) -> TextLayer:
    return _LAYER.validate_python({"id": "t1", "text": text, "start": 0.0, "secs": 2.0, "style": {"size": 100, **style}})


def runs(event: TextEvent) -> list[list[tuple[str, str | None]]]:
    return [[(run.text, run.image) for run in line] for line in event.layout.runs]


def em(size: float = 100) -> float:
    metrics = font_metrics(STYLE_FONT)
    return size * metrics.em / metrics.units


def squares(event: TextEvent) -> list[tuple[str, tuple[float, float, float]]]:
    """Each emoji's image and square in the layer's picture, at scale 1."""
    return [
        (run.image, emoji_square(run, baseline, event.layout.size))
        for line, (_, baseline) in zip(event.layout.runs, event.layout.anchors)
        for run in line
        if run.image
    ]


def share(pixels: np.ndarray, colour: tuple[int, int, int], tolerance: int = 12) -> float:
    """The share of the opaque RGBA `pixels` that are `colour`."""
    opaque = pixels[pixels[..., 3] > 250][:, :3].astype(int)
    if not len(opaque):
        return 0.0
    return float((np.abs(opaque - colour).max(axis=1) <= tolerance).mean())


def quarters(pixels: np.ndarray, left: float, top: float, side: float) -> list[np.ndarray]:
    """The middles of the four quarters of the square at (`left`, `top`) `side` pixels wide in
    `pixels`: top-left, top-right, bottom-left, bottom-right."""
    half = max(2, round(side / 10))
    patches = []
    for down in (0.25, 0.75):
        for across in (0.25, 0.75):
            x, y = round(left + across * side), round(top + down * side)
            patches.append(pixels[y - half : y + half, x - half : x + half])
    return patches


def test_an_emoji_is_a_run_of_its_own_one_em_wide_followed_by_the_text():
    event = text_event(layer("🔥 WAJIB TONTON"), 10)
    assert event.lines == ["🔥 WAJIB TONTON"]
    assert runs(event) == [[("🔥", FIRE), ("WAJIB TONTON", None)]]
    [[fire, text]] = event.layout.runs
    metrics = font_metrics(STYLE_FONT)
    assert fire.font == STYLE_FONT
    assert fire.width == pytest.approx(em(), abs=0.01)
    # The space after it is room between the two.
    assert text.x - fire.x == pytest.approx(em() + metrics.width(" ", 100), abs=0.01)
    assert text.width == pytest.approx(metrics.width("WAJIB TONTON", 100), abs=0.01)
    assert event.area.width == pytest.approx(text.x + text.width - fire.x, abs=1)
    # Its square stands on the line: centred on the middle of the capitals, a little below the baseline.
    [(_, (x, top, side))] = squares(event)
    baseline = event.layout.anchors[0][1]
    capitals = metrics.cap_height / metrics.units * 100
    assert (x, side) == (fire.x, fire.width)
    assert top + side / 2 == pytest.approx(baseline - capitals / 2, abs=0.01)
    assert top < baseline - capitals and baseline < top + side


@pytest.mark.parametrize(("text", "image"), [
    (FAMILY, "emoji_u1f468_200d_1f469_200d_1f467.png"),
    ("🇮🇩", FLAG),
    ("👍🏽", "emoji_u1f44d_1f3fd.png"),
    ("❤️", "emoji_u2764.png"),
    ("#️⃣", "emoji_u0023_20e3.png"),
])
def test_a_sequence_is_one_emoji_drawn_from_one_image(text, image):
    event = text_event(layer(f"A{text}B"), 10)
    assert runs(event) == [[("A", None), (text, image), ("B", None)]]
    assert event.layout.runs[0][1].width == pytest.approx(em(), abs=0.01)


def test_a_sequence_without_an_image_falls_back_to_its_first_emoji_or_is_left_out():
    # A bald man has no image here: his sequence is drawn as its first codepoint, a man.
    bald = text_event(layer("A👨‍🦲B"), 10)
    assert runs(bald) == [[("A", None), ("👨‍🦲", "emoji_u1f468.png"), ("B", None)]]
    # One with neither is left out, as a character no Face has, and the line closes up.
    plain = text_event(layer("AB CD"), 10)
    closed = text_event(layer("AB 🫨 CD"), 10)
    assert closed.lines == ["AB CD"] and closed.layout.runs == plain.layout.runs
    # As are a joiner or a variation selector on their own.
    assert text_event(layer("AB‍️ CD"), 10).lines == ["AB CD"]


def test_a_layer_of_only_emoji_shows_them_and_one_of_only_unknown_characters_shows_nothing():
    event = text_event(layer("🔥🔥 👍🏽"), 10)
    assert runs(event) == [[("🔥", FIRE), ("🔥", FIRE), ("👍🏽", "emoji_u1f44d_1f3fd.png")]]
    [[first, second, third]] = event.layout.runs
    assert second.x == pytest.approx(first.x + em(), abs=0.01)
    assert third.x == pytest.approx(second.x + em() + font_metrics(STYLE_FONT).width(" ", 100), abs=0.01)
    assert text_event(layer("🫨 한"), 10) is None


def test_the_picture_shows_each_emoji_in_its_own_colours_where_it_is_planned():
    # A magenta stroke, a cyan shadow and a grey plate: none is drawn on the emoji, which keeps its
    # colours over them.
    event = text_event(layer("🔥 HALO 🇮🇩", colour="#FFFFFF", stroke_width=8, stroke_colour="#FF00FF",
                             shadow={"colour": "#00FFFF", "opacity": 1.0, "distance": 12, "angle": 0},
                             plate={"shape": "block", "colour": "#404040", "opacity": 1.0, "padding_x": 60, "padding_y": 60}), 10)
    pixels = rasterised(load_settings().ffmpeg_bin, event.layout)
    scale = event.layout.raster[0] / event.layout.width
    [(fire, (x, top, side)), (flag, (fx, ftop, fside))] = squares(event)
    assert (fire, flag) == (FIRE, FLAG)
    left, right, bottom = round(x * scale), round((x + side) * scale), round((top + side) * scale)
    inset = round(side * scale * 0.1)
    for quarter, colour in zip(quarters(pixels, x * scale, top * scale, side * scale), QUARTERS[FIRE]):
        assert share(quarter, colour) > 0.9, colour
    # Round the disc, the plate shows; no stroke, white or magenta, anywhere on the emoji's square.
    corner = pixels[round(top * scale) + 2 : round(top * scale) + inset, left + 2 : left + inset]
    assert share(corner, (64, 64, 64)) > 0.9
    square = pixels[round(top * scale) : bottom, left:right]
    assert share(square, (255, 0, 255), 40) == 0 and share(square, (255, 255, 255), 30) == 0
    assert share(square, (0, 255, 255), 40) == 0
    # The flag, 3:2, fills its square across, red over white, centred down it.
    flag_pixels = pixels[round(ftop * scale) : round((ftop + fside) * scale), round(fx * scale) + 2 : round((fx + fside) * scale) - 2]
    middle = flag_pixels.shape[0] // 2
    red_rows = [i for i in range(flag_pixels.shape[0]) if share(flag_pixels[i : i + 1], (255, 0, 0)) > 0.9]
    white_rows = [i for i in range(flag_pixels.shape[0]) if share(flag_pixels[i : i + 1], (255, 255, 255)) > 0.9]
    assert red_rows and white_rows and max(red_rows) < middle <= min(white_rows)
    assert len(red_rows) + len(white_rows) == pytest.approx(flag_pixels.shape[0] * 2 / 3, abs=4)
    # The text is drawn between them, in white with its stroke.
    text = pixels[:, round((x + side) * scale) + 4 : round(fx * scale) - 4]
    assert share(text, (255, 255, 255), 30) > 0.05 and share(text, (255, 0, 255), 40) > 0.05
    assert share(text, (0, 255, 255), 40) > 0.005


def test_a_picture_made_larger_draws_its_emoji_as_large_as_its_text():
    # A layer scaled 3 times has its picture made 3 times as large (the scale is the Transform's).
    layout = replace(text_event(layer("🔥"), 10).layout, scale=3.0)
    pixels = rasterised(load_settings().ffmpeg_bin, layout)
    [[run]] = layout.runs
    _, top, side = emoji_square(run, layout.anchors[0][1], layout.size)
    drawn = np.nonzero(pixels[..., 3] > 128)
    # The disc is 3 times its square at scale 1, less the stand-in's edge of transparency.
    assert drawn[1].max() - drawn[1].min() + 1 == pytest.approx(3 * side * 124 / 128, abs=3)
    assert drawn[0].min() == pytest.approx(3 * (top + side * 2 / 128), abs=3)


def test_captions_leave_emoji_out():
    words = said("keren 🔥 banget👍🏽 ya")
    events = captioned(words, 10)
    assert shown(events) == ["KEREN BANGET YA"]
    # The Word that was only an emoji has no place in the line: no empty box is highlighted.
    assert [word.text for word in events[0].words] == ["KEREN", "BANGET", "YA"]


def test_a_rendered_frame_and_the_preview_show_the_emoji_where_the_plan_places_it(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, text_layers=[{
        "id": "t1", "text": "🔥 WAJIB TONTON", "start": 0.0, "secs": 2.5, "transform": {"x": 540, "y": 900},
        "style": {"size": 120, "colour": "#FFFFFF"},
    }])
    [event] = preview(client, job, candidate)["plan"]["texts"]
    [[fire, text]] = event["layout"]["runs"]
    assert (fire["text"], fire["image"], text["text"], text["image"]) == ("🔥", FIRE, "WAJIB TONTON", None)
    # The preview's picture (at scale 1) has it in its colours, in its square.
    picture = picture_of(client, job, event).astype(np.uint8)
    baseline = event["layout"]["anchors"][0][1]
    x, top, side = emoji_square(TextRun(**fire), baseline, event["layout"]["size"])
    for quarter, colour in zip(quarters(picture, x, top, side), QUARTERS[FIRE]):
        assert share(quarter, colour) > 0.9, colour

    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)
    # The same place on the frame: the picture's corner, plus the square's.
    left = event["picture"]["centre"][0] - event["picture"]["width"] / 2
    upper = event["picture"]["centre"][1] - event["picture"]["height"] / 2
    for quarter, colour in zip(quarters(frame.astype(int), left + x, upper + top, side), QUARTERS[FIRE]):
        assert np.abs(quarter - colour).max(axis=2).mean() < 40, colour
    # The text after it, white.
    white = frame.min(axis=2) > 220
    x0, x1 = round(left + text["x"]), round(left + text["x"] + text["width"])
    assert white[round(upper + baseline) - 60 : round(upper + baseline), x0:x1].mean() > 0.1


def test_an_emoji_image_is_served_by_its_codepoints_for_the_face_pickers_samples(client, emoji_images):
    response = client.get("/api/emoji/1f525")
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    assert response.content == (emoji_images / FIRE).read_bytes()
    # A sequence, joined by dashes, and one that falls back to its first codepoint.
    assert client.get("/api/emoji/1f468-200d-1f469-200d-1f467").content == (emoji_images / "emoji_u1f468_200d_1f469_200d_1f467.png").read_bytes()
    assert client.get("/api/emoji/1f468-200d-1f9b2").content == (emoji_images / "emoji_u1f468.png").read_bytes()
    assert client.get("/api/emoji/1fae8").status_code == 404
    assert client.get("/api/emoji/zz").status_code == 404
