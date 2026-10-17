"""CJK in Text Layers (.scratch/text-advanced/issues/10-cjk-in-text-layers.md, docs/adr/0010): a
character a Text Layer's Face hasn't got is set in the bundled CJK Face, FALLBACK_FONT, and measured
with it; one neither has is left out.

Seam B on the planner's runs, then the picture libass draws of them and a Seam A render with the
real ffmpeg.
"""

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import TextLayer
from app.config import load_settings
from app.fonts import FALLBACK_FONT, registry
from app.planner import TextEvent, TextRun, font_metrics, text_event
from app.text_pictures import rasterised
from test_render import HEARD, add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

_LAYER = TypeAdapter(TextLayer)
STYLE_FONT = "montserrat-extrabold"


def layer(text: str, **style) -> TextLayer:
    return _LAYER.validate_python({"id": "t1", "text": text, "start": 0.0, "secs": 2.0, "style": {"size": 100, **style}})


def runs(event: TextEvent) -> list[list[tuple[str, str]]]:
    return [[(run.text, run.font) for run in line] for line in event.layout.runs]


def ink_columns(pixels: np.ndarray) -> np.ndarray:
    """The columns of an RGBA picture holding ink."""
    return np.nonzero((pixels[..., 3] > 64).any(axis=0))[0]


def test_a_line_mixing_latin_and_japanese_has_a_run_per_face_each_measured_in_its_own():
    event = text_event(layer("HALO 日本語です!"), 10)
    assert event.lines == ["HALO 日本語です!"]
    # The space goes with the run it follows, and is not drawn at its end.
    assert runs(event) == [[("HALO", STYLE_FONT), ("日本語です", FALLBACK_FONT), ("!", STYLE_FONT)]]
    latin, cjk = font_metrics(STYLE_FONT), font_metrics(FALLBACK_FONT)
    [[halo, japanese, bang]] = event.layout.runs
    assert halo.width == pytest.approx(latin.width("HALO", 100), abs=0.01)
    assert japanese.width == pytest.approx(cjk.width("日本語です", 100), abs=0.01)
    # Each from where the last ends, the space between the first two.
    assert japanese.x - halo.x == pytest.approx(latin.width("HALO ", 100), abs=0.01)
    assert bang.x == pytest.approx(japanese.x + japanese.width, abs=0.01)
    # The line as wide as its runs, centred on its anchor.
    width = bang.x + bang.width - halo.x
    assert event.area.width == pytest.approx(width, abs=1)
    assert (halo.x + bang.x + bang.width) / 2 == pytest.approx(event.layout.anchors[0][0], abs=0.01)
    # Not one em a character, as a character the Face hasn't got used to be counted.
    assert abs(width - latin.width("HALO 日本語です!", 100)) > 20


def test_a_cjk_run_keeps_the_line_pitch_of_the_styles_face():
    latin = text_event(layer("HALO\nDUNIA"), 10)
    mixed = text_event(layer("HALO\n日本語"), 10)
    assert [y for _, y in mixed.anchors] == [y for _, y in latin.anchors]
    assert mixed.area.height == latin.area.height
    assert mixed.layout.height == latin.layout.height


def test_a_character_neither_face_has_is_left_out_and_the_line_closes_up():
    # Hangul: in neither Montserrat nor the bundled Chinese Face.
    closed = text_event(layer("AB한CD"), 10)
    plain = text_event(layer("ABCD"), 10)
    assert closed.lines == ["ABCD"] and runs(closed) == [[("ABCD", STYLE_FONT)]]
    assert closed.area == plain.area and closed.layout.runs == plain.layout.runs
    # A line of nothing either has shows nothing; a layer of only such lines is blank.
    assert text_event(layer("한국어\nHALO"), 10).lines == ["HALO"]
    assert text_event(layer("한국어"), 10) is None


def test_the_fallback_face_is_bundled_but_not_offered():
    face = registry().get(FALLBACK_FONT)
    assert face.bundled and face.licence
    assert FALLBACK_FONT not in registry().ids() and FALLBACK_FONT not in {face.id for face in registry().all()}
    with pytest.raises(ValueError):
        layer("HALO", font=FALLBACK_FONT)


def test_a_layers_picture_draws_each_run_in_its_face_where_it_is_planned():
    event = text_event(layer("HALO 日本語"), 10)
    pixels = rasterised(load_settings().ffmpeg_bin, event.layout)
    [[halo, japanese]] = event.layout.runs
    columns = ink_columns(pixels)
    # The line's ink is as wide as it is planned, within the letters' side bearings.
    assert columns.min() == pytest.approx(halo.x, abs=8)
    assert columns.max() + 1 == pytest.approx(japanese.x + japanese.width, abs=8)
    # Ink under each character of the Japanese run, in the gap between the runs none.
    each = japanese.width / 3
    for i in range(3):
        start = round(japanese.x + i * each + 0.2 * each)
        assert (pixels[:, start : round(start + 0.6 * each), 3] > 64).any(), i
    gap = pixels[:, round(halo.x + halo.width) + 3 : round(japanese.x) - 3, 3]
    assert gap.size and gap.max() < 64


def test_tracking_spaces_every_character_of_every_run_and_each_run_is_drawn_where_it_is_planned():
    # .scratch/text-advanced/issues/04-shadow-plate-and-spacing.md: tracking across runs.
    plain = text_event(layer("HALO 日本語"), 10)
    spaced = text_event(layer("HALO 日本語", tracking=30), 10)
    # 8 characters, the space among them: 7 gaps.
    assert spaced.area.width - plain.area.width == pytest.approx(7 * 30, abs=1)
    [[halo, japanese]] = spaced.layout.runs
    assert halo.width == pytest.approx(font_metrics(STYLE_FONT).width("HALO", 100, 30), abs=0.01)
    # The run after a space starts past the space and the tracking after it and after HALO's O.
    assert japanese.x - halo.x == pytest.approx(font_metrics(STYLE_FONT).width("HALO ", 100) + 5 * 30, abs=0.01)
    pixels = rasterised(load_settings().ffmpeg_bin, spaced.layout)
    columns = ink_columns(pixels)
    assert columns.min() == pytest.approx(halo.x, abs=8)
    assert columns.max() + 1 == pytest.approx(japanese.x + japanese.width, abs=8)
    gap = pixels[:, round(halo.x + halo.width) + 3 : round(japanese.x) - 3, 3]
    assert gap.size and gap.max() < 64


def test_japanese_glyphs_are_drawn_not_missing_glyph_boxes():
    def halves(text: str) -> tuple[np.ndarray, np.ndarray]:
        event = text_event(layer(text), 10)
        pixels = rasterised(load_settings().ffmpeg_bin, event.layout)
        [[run]] = event.layout.runs
        middle = round(run.x + run.width / 2)
        alpha = pixels[..., 3].astype(int)
        return alpha[:, middle - round(run.width / 2) : middle], alpha[:, middle : middle + round(run.width / 2)]

    # Two glyphs alike draw alike; two others, two different shapes (missing glyphs would be the same box).
    left, right = halves("日日")
    assert np.abs(left - right).mean() < 2
    left, right = halves("日本")
    assert np.abs(left - right).mean() > 20


def test_a_rendered_frame_has_ink_where_each_cjk_run_is_planned(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, text_layers=[{
        "id": "t1", "text": "AB 日本語 CD 中文", "start": 0.0, "secs": 2.5, "transform": {"x": 540, "y": 900},
        "style": {"size": 120, "colour": "#00FF00"},
    }])
    [event] = preview(client, job, candidate)["plan"]["texts"]
    assert [[run["font"] for run in line] for line in event["layout"]["runs"]] == [[STYLE_FONT, FALLBACK_FONT, STYLE_FONT, FALLBACK_FONT]]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.5)
    green = (frame[..., 1] > 180) & (frame[..., 0] < 100) & (frame[..., 2] < 100)
    # The picture's corner on the frame: its runs are placed from it.
    left = round(event["picture"]["centre"][0] - event["picture"]["width"] / 2)
    area = event["area"]
    rows = slice(area["y"] - 20, area["y"] + area["height"] + 20)
    [line] = event["layout"]["runs"]
    for run in line:
        x0, x1 = left + round(run["x"]), left + round(run["x"] + run["width"])
        assert green[rows, x0:x1].sum() > 0.08 * (x1 - x0) * area["height"], run["text"]
    # Nothing past the line's ends.
    assert not green[:, : left + round(line[0]["x"]) - 10].any()
    assert not green[:, left + round(line[-1]["x"] + line[-1]["width"]) + 10 :].any()
