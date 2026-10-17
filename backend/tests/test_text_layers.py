"""Text Layers: free text overlays of the Advanced Edit (.scratch/advanced-edit/issues/02-text-layers.md),
each placed by its Transform and drawn in its Text Style
(.scratch/text-advanced/issues/01-text-style-and-transform-shape.md).

Seam B on the planner and the migration of old Text Layers, whose pictures look as their ASS events
did, then the update API, stored Candidates and a Seam A render with the real ffmpeg. Their pictures
are tested in test_text_pictures.py.
"""

import json
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import TextAlign, TextLayer
from app.jobs import CANDIDATES_FILE, REVISIONS_DIR
from app.migration import migrated_candidate, migrated_clip, migrated_text_layer
from app.config import FONTS_DIR, load_settings
from app.planner import MAX_TEXT_PICTURE, OUTPUT_HEIGHT, OUTPUT_WIDTH, TEXT_MARGIN, Box, TextEvent, font_metrics, plan_render, text_event
from app.renderer import _ass
from app.text_pictures import rasterised
from app.video_source import SourceMetadata
from conftest import FIXTURES
from test_render import HEARD, add, check_clip, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, candidates, patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
_LAYER = TypeAdapter(TextLayer)
_LAYERS = TypeAdapter(list[TextLayer])
_EVENT = TypeAdapter(TextEvent)
# Text Layers saved before Text Styles, with the events the planner made of them in a 7 s Clip and
# the ASS lines the renderer wrote for them (both from the code before Text Styles).
BEFORE = json.loads((FIXTURES / "text_layers_before_text_style.json").read_text())
BEFORE_ASS = (FIXTURES / "text_layers_before_text_style.ass").read_text()
# The colour behind the text, plain_video's.
GREY = np.array([0x4A, 0x55, 0x60])


def layer(transform: dict | None = None, style: dict | None = None, **fields) -> TextLayer:
    given = {"id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0, "transform": transform or {}, "style": style or {}, **fields}
    return _LAYER.validate_python(given)


def drawn(event: TextEvent) -> dict:
    """What a Text Layer's event draws: all of it but the layer it was planned from."""
    return {key: value for key, value in _EVENT.dump_python(event, mode="json").items() if key != "layer"}


def as_before(event: dict, before: dict, keys: tuple[str, ...]) -> None:
    """`event` (as JSON) plans `keys` as `before` did: the same, its anchors to within a hundredth of a
    pixel (a layer once set smaller has its plate's padding saved to the hundredth at its size), and
    its size, now its style's, as the size it was set at."""
    event = event | {"size": event["layout"]["style"]["size"]}
    assert {key: event[key] for key in keys if key != "anchors"} == {key: before[key] for key in keys if key != "anchors"}, event
    for anchor, old in zip(event["anchors"], before["anchors"], strict=True):
        assert anchor == pytest.approx(old, abs=0.01), event


def old_look(at: float) -> np.ndarray:
    """What the Text Layers' ASS lines from before Text Styles drew over GREY at `at` seconds into
    the Clip: 1080x1920 RGB."""
    header = _ass(plan_render(0, 7, SOURCE)).split("[Events]")[0]
    styles, events = [], []
    for line in BEFORE_ASS.splitlines():
        (styles if line.startswith("Style:") else events).append(line)
    script = header.rstrip("\n") + "\n" + "\n".join(styles) + "\n\n[Events]\n"
    script += "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(events) + "\n"
    with tempfile.TemporaryDirectory() as work:
        path = Path(work, "old.ass")
        path.write_text(script)
        command = [
            str(load_settings().ffmpeg_bin), "-v", "error", "-f", "lavfi", "-i", f"color=c=0x4a5560:s={OUTPUT_WIDTH}x{OUTPUT_HEIGHT}:r=10:d=7",
            "-vf", f"format=rgb24,ass=filename={path}:fontsdir={FONTS_DIR}", "-ss", f"{at}", "-frames:v", "1",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ]
        data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, np.uint8).reshape(OUTPUT_HEIGHT, OUTPUT_WIDTH, 3).astype(float)


def new_look(events: list[TextEvent], at: float) -> np.ndarray:
    """The pictures of the Text Layers shown at `at` (none coming on or going off then) laid over
    GREY, each at its picture's place, as the render lays them."""
    frame = np.tile(GREY.astype(float), (OUTPUT_HEIGHT, OUTPUT_WIDTH, 1))
    for event in events:
        if not event.start <= at < event.end:
            continue
        pixels = rasterised(load_settings().ffmpeg_bin, event.layout).astype(float)
        x, y = (round(c - size / 2) for c, size in zip(event.picture.centre, (event.picture.width, event.picture.height)))
        # Only what is on the frame.
        left, top = max(x, 0), max(y, 0)
        right, bottom = min(x + pixels.shape[1], OUTPUT_WIDTH), min(y + pixels.shape[0], OUTPUT_HEIGHT)
        shown = pixels[top - y : bottom - y, left - x : right - x]
        alpha = shown[..., 3:] / 255
        frame[top:bottom, left:right] = shown[..., :3] * alpha + frame[top:bottom, left:right] * (1 - alpha)
    return frame


def test_without_text_layers_the_plan_and_the_script_are_unchanged():
    planned = plan_render(0, 5, SOURCE, hook="Halo")
    assert planned.texts == []
    script = _ass(planned)
    assert "Style: Text" not in script
    # The hook keeps its layers.
    assert "Dialogue: 2," in script and "Dialogue: 5," not in script


def test_a_text_layer_is_centred_on_its_transform_and_measured_in_its_face():
    event = text_event(layer({"x": 400, "y": 700}, {"size": 80}, text="Halo dunia"), 10)
    width = font_metrics(event.layer.style.font).width("Halo dunia", 80)
    assert event.layout.style.size == 80 and event.lines == ["Halo dunia"]
    assert event.area.width == pytest.approx(width, abs=1)
    assert event.area.x + event.area.width / 2 == pytest.approx(400, abs=1)
    assert event.area.y + event.area.height / 2 == pytest.approx(700, abs=1)
    assert (event.start, event.end) == (1.0, 3.0)
    assert event.box is None


def test_lines_are_split_at_newlines_aligned_and_spaced_by_the_line_height():
    text = "Satu\nDua yang lebih panjang"
    centred = text_event(layer(style={"size": 60}, text=text), 10)
    assert centred.lines == ["Satu", "Dua yang lebih panjang"]
    [first, second] = centred.anchors
    assert first[0] == second[0] == pytest.approx(centred.area.x + centred.area.width / 2)
    assert second[1] - first[1] == pytest.approx(1.1 * 60)
    spaced = text_event(layer(style={"size": 60, "line_height": 2}, text=text), 10)
    assert spaced.anchors[1][1] - spaced.anchors[0][1] == pytest.approx(2 * 60)
    left = text_event(layer(style={"size": 60, "align": "left"}, text=text), 10)
    metrics = font_metrics(left.layer.style.font)
    assert left.anchors[0][0] - metrics.width("Satu", 60) / 2 == pytest.approx(left.area.x, abs=0.5)
    right = text_event(layer(style={"size": 60, "align": TextAlign.RIGHT}, text=text), 10)
    assert right.anchors[0][0] + metrics.width("Satu", 60) / 2 == pytest.approx(right.area.x + right.area.width, abs=0.5)


def test_a_block_plate_pads_the_text_by_its_pixels():
    plain = text_event(layer(style={"size": 80}), 10)
    block = {"shape": "block", "padding_x": 30, "padding_y": 10, "radius": 12}
    boxed = text_event(layer(style={"size": 80, "plate": block}), 10)
    assert boxed.box == boxed.area and boxed.layout.radius == 12
    assert boxed.area.width - plain.area.width in (60, 61) and boxed.area.height - plain.area.height in (20, 21)


def test_a_sentence_wider_than_the_frame_breaks_between_words_at_its_size_inside_the_frame():
    text = "Ini adalah kalimat yang sangat panjang sekali"
    wide = text_event(layer(style={"size": 200, "plate": {"shape": "block", "padding_x": 30}}, text=text), 10)
    metrics = font_metrics(wide.layer.style.font)
    assert len(wide.lines) > 1
    assert " ".join(wide.lines) == text
    # Each line as long as fits the frame less TEXT_MARGIN and the padding either side: the next
    # word would not.
    room = OUTPUT_WIDTH - 2 * TEXT_MARGIN - 2 * 30
    for line, after in zip(wide.lines, wide.lines[1:]):
        assert metrics.width(line, 200) <= room < metrics.width(f"{line} {after.split()[0]}", 200)
    widest = max(metrics.width(line, 200) for line in wide.lines)
    assert wide.area.width == pytest.approx(widest + 60, abs=1) and wide.area.width <= OUTPUT_WIDTH - 2 * TEXT_MARGIN
    assert [y for _, y in wide.anchors] == pytest.approx([wide.anchors[0][1] + i * 1.1 * 200 for i in range(len(wide.lines))])


def test_a_wrap_width_breaks_lines_at_it_keeps_newlines_and_breaks_an_over_long_word_between_characters():
    style = {"size": 60, "wrap_width": 400}
    wrapped = text_event(layer(style=style, text="Satu dua tiga empat lima enam\nTujuh"), 10)
    metrics = font_metrics(wrapped.layer.style.font)
    assert len(wrapped.lines) > 2 and wrapped.lines[-1] == "Tujuh"
    assert " ".join(wrapped.lines[:-1]) == "Satu dua tiga empat lima enam"
    assert all(metrics.width(line, 60) <= 400 for line in wrapped.lines)
    # The box is the wrap width wide, its lines aligned inside it.
    assert wrapped.area.width == 400
    left = text_event(layer(style=style | {"align": "left"}, text="Satu"), 10)
    assert left.area.width == 400 and left.anchors[0][0] - metrics.width("Satu", 60) / 2 == pytest.approx(left.area.x)
    # With a Block plate, it holds the plate's padding too: the lines break that much narrower.
    plated = text_event(layer(style=style | {"plate": {"shape": "block", "padding_x": 50}}, text="Satu dua tiga empat lima enam"), 10)
    assert plated.area.width == 400 and all(metrics.width(line, 60) <= 300 for line in plated.lines)
    # A word wider than the wrap width breaks between its characters, each line as full as fits.
    word = "Supercalifragilisticexpialidocious"
    long = text_event(layer(style=style, text=f"A {word}"), 10)
    assert long.lines[0] == "A" and "".join(long.lines[1:]) == word and len(long.lines) > 2
    for line, after in zip(long.lines[1:], long.lines[2:]):
        assert metrics.width(line, 60) <= 400 < metrics.width(line + after[0], 60)
    # A wrap width wider than the words is the box's width.
    assert text_event(layer(style={"size": 60, "wrap_width": 900}, text="Satu"), 10).area.width == 900


def test_a_fixed_height_taller_than_the_words_centres_them_and_a_shorter_one_grows_to_hold_them():
    words = text_event(layer(style={"size": 60, "plate": {"shape": "block", "padding_y": 10}}, text="Satu\nDua"), 10)
    tall = text_event(layer(style={"size": 60, "fixed_height": 400, "plate": {"shape": "block", "padding_y": 10}}, text="Satu\nDua"), 10)
    assert tall.area.height == 400 and tall.box == tall.area
    assert tall.area.y + tall.area.height / 2 == pytest.approx(960, abs=1)
    # The words, as tall as they are without it, centred down it.
    letters_top = words.anchors[0][1] - words.area.y
    letters_bottom = words.area.y + words.area.height - words.anchors[-1][1]
    middle = (tall.anchors[0][1] - letters_top + 10 + tall.anchors[-1][1] + letters_bottom - 10) / 2
    assert middle == pytest.approx(tall.area.y + 200, abs=0.5)
    assert tall.anchors[1][1] - tall.anchors[0][1] == pytest.approx(66)
    short = text_event(layer(style={"size": 60, "fixed_height": 30, "plate": {"shape": "block", "padding_y": 10}}, text="Satu\nDua"), 10)
    assert short.area.height == words.area.height and short.anchors == words.anchors


def test_tracking_widens_each_line_by_its_gaps_and_a_line_too_wide_with_it_wraps():
    text = "Satu\nDua yang lebih panjang"
    plain = text_event(layer(style={"size": 60}, text=text), 10)
    spaced = text_event(layer(style={"size": 60, "tracking": 8}, text=text), 10)
    tight = text_event(layer(style={"size": 60, "tracking": -3}, text=text), 10)
    # The widest line has 22 characters: 21 gaps.
    assert spaced.area.width - plain.area.width == pytest.approx(21 * 8, abs=1)
    assert tight.area.width - plain.area.width == pytest.approx(-21 * 3, abs=1)
    # A left-aligned line's middle moves by half its own tracking.
    left = text_event(layer(style={"size": 60, "tracking": 8, "align": "left"}, text=text), 10)
    metrics = font_metrics(left.layer.style.font)
    assert left.anchors[0][0] - (metrics.width("Satu", 60) + 3 * 8) / 2 == pytest.approx(left.area.x, abs=0.5)
    # It wraps only once its tracked width is too wide for the frame, never set smaller.
    words = "Kalimat yang cukup panjang"
    fits = text_event(layer(style={"size": 70}, text=words), 10)
    assert fits.lines == [words]
    wrapped = text_event(layer(style={"size": 70, "tracking": 20}, text=words), 10)
    assert len(wrapped.lines) == 2 and " ".join(wrapped.lines) == words
    assert all(metrics.width(line, 70, 20) <= OUTPUT_WIDTH - 2 * TEXT_MARGIN for line in wrapped.lines)
    assert wrapped.layout.style.tracking == 20


def test_line_height_sets_the_pitch_of_the_anchors_and_the_box_grows_with_it():
    text = "Satu\nDua\nTiga"
    tight = text_event(layer(style={"size": 60, "line_height": 0.9}, text=text), 10)
    airy = text_event(layer(style={"size": 60, "line_height": 1.8}, text=text), 10)
    for event, pitch in ((tight, 0.9 * 60), (airy, 1.8 * 60)):
        [first, second, third] = event.anchors
        assert second[1] - first[1] == pytest.approx(pitch) and third[1] - second[1] == pytest.approx(pitch)
    assert airy.area.height - tight.area.height == pytest.approx(2 * 0.9 * 60, abs=1)


def test_strips_put_a_plate_behind_each_line_as_wide_as_it_and_a_block_one_behind_them_all():
    text = "Satu\nDua yang lebih panjang"
    plate = {"padding_x": 20, "padding_y": 10, "radius": 200}
    for align in ("center", "left", "right"):
        strips = text_event(layer(style={"size": 60, "align": align, "tracking": 4, "plate": plate | {"shape": "strips"}}, text=text), 10)
        layout = strips.layout
        assert len(layout.plates) == 2
        metrics = font_metrics(strips.layer.style.font)
        letters = (metrics.cap_height + metrics.descent) / metrics.units * 60
        origin = (strips.area.x - layout.plates[1].x, strips.area.y - layout.plates[0].y)
        for plate_box, line, (x, baseline) in zip(layout.plates, strips.lines, strips.anchors, strict=True):
            width = metrics.width(line, 60, 4)
            assert plate_box.width == pytest.approx(width + 40, abs=1)
            assert plate_box.height == pytest.approx(letters + 20, abs=1)
            # Round its line, on the frame.
            assert plate_box.x + origin[0] + plate_box.width / 2 == pytest.approx(x, abs=1)
            assert plate_box.y + origin[1] + 10 + metrics.cap_height / metrics.units * 60 == pytest.approx(baseline, abs=1)
        # The widest strip spans the area.
        assert layout.plates[1].width == pytest.approx(strips.area.width, abs=1)
        # Corners at most half a strip's height round.
        assert layout.radius == layout.plates[0].height // 2
    block = text_event(layer(style={"size": 60, "plate": plate | {"shape": "block", "radius": 12}}, text=text), 10)
    [only] = block.layout.plates
    assert (only.width, only.height) == (block.area.width, block.area.height) and block.box == block.area
    assert text_event(layer(style={"size": 60}, text=text), 10).layout.plates == []


def test_a_shadow_is_moved_by_its_distance_towards_its_angle_and_its_picture_grows_to_hold_it():
    plain = text_event(layer(style={"size": 80}), 10)
    for angle, offset in ((0, (12, 0)), (90, (0, 12)), (180, (-12, 0)), (-90, (0, -12)), (45, (8.4853, 8.4853))):
        shadowed = text_event(layer(style={"size": 80, "shadow": {"distance": 12, "angle": angle, "blur": 6}}), 10)
        assert shadowed.layout.shadow == pytest.approx(offset, abs=1e-3)
        # Room for its distance and its blur's reach on every side, the layer's area and centre as they were.
        assert shadowed.layout.width - plain.layout.width in (2 * (12 + 9), 2 * (12 + 9) + 2)
        assert shadowed.area == plain.area and shadowed.picture.centre == plain.picture.centre
    halo = text_event(layer(style={"size": 80, "shadow": {"blur": 10}}), 10)
    assert halo.layout.shadow == (0, 0) and halo.layout.width > plain.layout.width
    # Off: transparent, or neither moved nor blurred.
    for off in ({"opacity": 0, "distance": 12, "blur": 6}, {"distance": 0, "blur": 0, "opacity": 1}):
        event = text_event(layer(style={"size": 80, "shadow": off}), 10)
        assert event.layout.shadow is None and event.layout.width == plain.layout.width


def test_a_text_styles_shadow_and_plate_refuse_values_out_of_range():
    for style in (
        {"shadow": {"blur": -1}}, {"shadow": {"opacity": 1.5}}, {"shadow": {"distance": -2}}, {"shadow": {"angle": 400}},
        {"shadow": {"colour": "black"}}, {"plate": {"radius": -1}}, {"plate": {"padding_x": 500}}, {"plate": {"shape": "pill"}},
        {"tracking": 500}, {"line_height": 0.1},
    ):
        with pytest.raises(ValidationError):
            layer(style=style)
    drawn_now = layer(style={"tracking": -4, "plate": {"shape": "strips"}, "shadow": {"distance": 6}})
    assert drawn_now.style.shadow.opacity == 0.6 and drawn_now.style.shadow.angle == 45


def test_a_text_layer_is_kept_in_the_clip_and_blank_or_late_ones_show_nothing():
    assert text_event(layer(start=4.0, secs=5.0), 6).end == 6
    assert text_event(layer(start=6.0), 6) is None
    assert text_event(layer(text="  \n "), 6) is None
    # An emoji is kept, drawn from its image (test_emoji_text.py); a character no Face nor image has
    # is left out.
    assert text_event(layer(text="Halo 🔥"), 6).lines == ["Halo 🔥"]
    assert text_event(layer(text="Halo 🫨"), 6).lines == ["Halo"]


def test_text_layers_leave_the_ass_script_in_their_order():
    planned = plan_render(
        0, 5, SOURCE, hook="Halo",
        text_layers=[layer(id="a", style={"colour": "#00FF00", "plate": {"shape": "block"}}), layer(id="b", text="Dua")],
    )
    assert [event.layer.id for event in planned.texts] == ["a", "b"]
    # Pictures of their own (test_text_pictures.py), and the hook's layers as they are without them.
    script = _ass(planned)
    assert "Dua" not in script and "Style: Text" not in script
    assert script == _ass(plan_render(0, 5, SOURCE, hook="Halo"))


def test_an_old_text_layer_moves_its_centre_into_its_transform_and_its_look_into_its_style():
    old = {
        "id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0, "x": 300, "y": 500, "font": "anton", "size": 64, "colour": "#FF0000",
        "outline": 4, "outline_colour": "#112233", "box": True, "box_colour": "#FFFFFF", "box_opacity": 0.5, "align": "right",
        "animation_in": "pop", "animation_out": "none", "animation_ms": 300,
    }
    new = migrated_text_layer(old)
    assert new == {
        "id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0, "animation_in": "pop", "animation_out": "none", "animation_ms": 300,
        "transform": {"x": 300, "y": 500},
        "style": {
            "font": "anton", "size": 64, "colour": "#FF0000", "stroke_width": 4, "stroke_colour": "#112233", "align": "right",
            "line_height": 1.1,
            "plate": {"shape": "block", "colour": "#FFFFFF", "opacity": 0.5, "radius": 16, "padding_x": 22.4, "padding_y": 14.08},
        },
    }
    assert migrated_text_layer(new) == new
    # One saved with its defaults alone is the same in either shape; one without a box has no plate.
    bare = {"id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0}
    assert migrated_text_layer(bare) == bare
    assert migrated_text_layer(bare | {"size": 100})["style"]["plate"]["shape"] == "none"
    # A Candidate's and a rendered Clip's Text Layers.
    assert migrated_candidate({"id": "c1", "text_layers": [old]}, {}) == {"id": "c1", "text_layers": [new]}
    assert migrated_clip({"candidate_id": "c1", "output": {"text_layers": [old]}}, {}) == {"candidate_id": "c1", "output": {"text_layers": [new]}}


def test_an_old_text_layer_set_smaller_keeps_that_size_and_a_wrap_width_holding_its_widest_line():
    [wide, narrow] = [migrated_text_layer(old) for old in BEFORE["layers"] if old["id"] in ("wide", "narrow")]
    [wide_before, narrow_before] = [event for old, event in zip(BEFORE["layers"], BEFORE["events"]) if old["id"] in ("wide", "narrow")]
    assert (wide["style"]["size"], narrow["style"]["size"]) == (wide_before["size"], narrow_before["size"]) == (59.9, 81.3)
    # Padded by its box, which is sized at that size.
    assert wide["style"]["plate"]["padding_x"] == round(0.35 * 59.9, 2)
    assert wide["style"]["wrap_width"] == pytest.approx(wide_before["area"]["width"], abs=1)
    assert narrow["style"]["wrap_width"] == pytest.approx(narrow_before["area"]["width"], abs=1)
    # One that fitted keeps its size and no wrap width.
    [title] = [migrated_text_layer(old) for old in BEFORE["layers"] if old["id"] == "title"]
    assert title["style"]["size"] == 130 and "wrap_width" not in title["style"]


def test_an_old_text_layer_the_planner_kept_inside_the_frame_is_centred_where_it_was_drawn():
    old = next(layer for layer in BEFORE["layers"] if layer["id"] == "corner")
    area = next(event for layer, event in zip(BEFORE["layers"], BEFORE["events"]) if layer["id"] == "corner")["area"]
    # Centred on the frame's corner, it was drawn inside the frame.
    assert (old["x"], old["y"]) == (OUTPUT_WIDTH, OUTPUT_HEIGHT)
    assert area["x"] + area["width"] == OUTPUT_WIDTH and area["y"] + area["height"] == OUTPUT_HEIGHT
    new = migrated_text_layer(old)
    assert new["transform"] == {"x": area["x"] + area["width"] / 2, "y": area["y"] + area["height"] / 2}
    assert drawn(text_event(_LAYER.validate_python(new), 10))["area"] == area
    assert migrated_text_layer(new) == new


def test_migrated_text_layers_plan_and_look_as_they_did():
    layers = _LAYERS.validate_python([migrated_text_layer(old) for old in BEFORE["layers"]])
    planned = plan_render(0, 7, SOURCE, text_layers=layers)
    for event, before in zip(planned.texts, BEFORE["events"], strict=True):
        as_before(drawn(event), before, tuple(before))
    # Their pictures, laid where the plan puts them, show what their ASS events drew, at two moments
    # that show all 9 between them (each between its animations).
    for at in (1.5, 3.2):
        old, new = old_look(at), new_look(planned.texts, at)
        differs = np.abs(old - new).max(axis=2)
        inked = np.abs(old - GREY).max(axis=2) > 8
        assert inked.sum() > 100_000, at
        # Within rounding: the alpha recovered from the matte, and libass's own blending.
        assert differs.max() <= 6 and differs[inked].mean() < 1.0, at


def test_a_text_layer_is_never_stretched_nor_flipped():
    for transform in ({"stretch_x": 2}, {"stretch_y": 0.5}, {"flip_h": True}, {"flip_v": True}):
        with pytest.raises(ValidationError, match="stretched|flipped"):
            layer(transform)
    # Every field of its style is drawn.
    assert layer(style={"wrap_width": 600, "fixed_height": 300, "tracking": 4, "plate": {"shape": "strips"}}).style.wrap_width == 600
    # Scaled, turned and faded, as an Overlay is.
    assert layer({"scale": 2, "rotation": 15, "opacity": 0.5}).transform.rotation == 15


def test_a_text_layer_is_centred_on_its_transform_past_the_frames_edges():
    corner = text_event(layer({"x": OUTPUT_WIDTH, "y": OUTPUT_HEIGHT}, {"size": 120}), 10)
    assert corner.area.x + corner.area.width / 2 == pytest.approx(OUTPUT_WIDTH, abs=1)
    assert corner.area.y + corner.area.height / 2 == pytest.approx(OUTPUT_HEIGHT, abs=1)
    assert corner.picture.centre == pytest.approx((OUTPUT_WIDTH, OUTPUT_HEIGHT), abs=1)
    # Its centre is kept on the frame.
    off = text_event(layer({"x": -400, "y": 5000}), 10)
    assert off.picture.centre == pytest.approx((0, OUTPUT_HEIGHT), abs=1)


def test_a_scaled_and_turned_text_layer_keeps_its_layout_and_turns_its_bounds_about_its_centre():
    plain = text_event(layer({"x": 500, "y": 900}, text="Halo dunia"), 10)
    turned = text_event(layer({"x": 500, "y": 900, "scale": 2, "rotation": 90, "opacity": 0.4}, text="Halo dunia"), 10)
    # The same lines, size and area: scaling neither rewraps nor resizes it.
    assert (turned.lines, turned.area) == (plain.lines, plain.area)
    assert turned.layout.anchors == plain.layout.anchors
    picture = turned.picture
    assert (picture.rotation, picture.opacity) == (90, 0.4)
    assert picture.width == pytest.approx(2 * plain.picture.width, abs=2)
    assert picture.height == pytest.approx(2 * plain.picture.height, abs=2)
    # Its area, twice as large and stood on end about its centre.
    area = plain.area
    assert turned.bounds.width == pytest.approx(2 * area.height, abs=2) and turned.bounds.height == pytest.approx(2 * area.width, abs=2)
    assert turned.bounds.x + turned.bounds.width / 2 == pytest.approx(500, abs=1)
    assert turned.bounds.y + turned.bounds.height / 2 == pytest.approx(900, abs=1)


def test_a_text_layers_bounds_are_rounded_to_the_pixel_as_a_pictures_are():
    turned = text_event(layer({"x": 500, "y": 900, "scale": 1.37, "rotation": 30}, text="Halo dunia"), 10)
    # Its area's corners, scaled and turned about its picture's centre, in fractions of a pixel.
    area, (x, y) = turned.area, turned.picture.centre
    angle = math.radians(30)
    corners = [((u - x) * 1.37, (v - y) * 1.37) for u in (area.x, area.x + area.width) for v in (area.y, area.y + area.height)]
    xs = [x + u * math.cos(angle) - v * math.sin(angle) for u, v in corners]
    ys = [y + u * math.sin(angle) + v * math.cos(angle) for u, v in corners]
    # To the nearest pixel, as the editor's preview rounds a picture's (and a keyed Text Layer's) bounds,
    # not out to whole pixels.
    nearest = Box(round(min(xs)), round(min(ys)), round(max(xs) - min(xs)), round(max(ys) - min(ys)))
    outward = Box(math.floor(min(xs)), math.floor(min(ys)), math.ceil(max(xs)) - math.floor(min(xs)), math.ceil(max(ys)) - math.floor(min(ys)))
    assert turned.bounds == nearest != outward


def test_a_text_layers_picture_is_made_at_the_next_scale_up_and_is_one_picture_within_it():
    def made(scale: float) -> TextEvent:
        return text_event(layer({"scale": scale}, {"size": 60}), 10)

    assert [made(scale).layout.scale for scale in (0.3, 1, 1.2, 1.5, 2.5, 3, 5, 8)] == [1, 1, 1.5, 1.5, 3, 3, 6, 8]
    # Scaled within one step, it is the same picture; past it, another of the same key.
    assert made(2.2).image == made(2.9).image != made(3.1).image
    assert made(2.2).picture_key == made(3.1).picture_key == made(0.5).picture_key
    assert text_event(layer({"scale": 2.2}, {"size": 61}), 10).picture_key != made(2.2).picture_key
    # Drawn at its own scale whatever its picture's.
    assert made(2.2).picture.width == pytest.approx(2.2 * made(1).picture.width, abs=2)
    assert made(2.2).picture.item_size == made(2.9).picture.item_size
    # Never more than MAX_TEXT_PICTURE on its longest side.
    huge = text_event(layer({"scale": 8}, {"size": 300}, text="Kalimat yang panjang"), 10)
    assert max(huge.picture.item_size) <= MAX_TEXT_PICTURE


def test_text_layers_are_saved_on_the_candidate_validated_and_kept_through_a_trim(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    title = {"id": "t1", "text": "Judul", "start": 0.5, "secs": 2, "style": {"colour": "#ff0000"}}
    saved = patch(client, job, candidate, text_layers=[title])
    assert saved["edited"] is True
    [layer] = saved["text_layers"]
    assert layer["style"]["colour"] == "#FF0000" and layer["style"]["size"] == 80
    assert (layer["transform"]["x"], layer["transform"]["y"], layer["style"]["plate"]["shape"]) == (540, 960, "none")
    planned = preview(client, job, saved)["plan"]["texts"]
    assert [event["lines"] for event in planned] == [["Judul"]]

    for bad in (
        [title | {"style": {"font": "comic-sans"}}],
        [title | {"secs": 0}],
        [title | {"text": "x" * 301}],
        [title, title],
        [title | {"surprise": 1}],
        [title | {"style": {"plate": {"opacity": 2}}}],
        [title | {"transform": {"flip_h": True}}],
    ):
        response = client.patch(candidate_url(job, candidate), json={"text_layers": bad})
        assert response.status_code == 422, bad
    # The shape before Text Styles is refused with what replaced it.
    old = client.patch(candidate_url(job, candidate), json={"text_layers": [title | {"x": 300, "outline": 2}]})
    assert old.status_code == 422 and "style" in old.text and "transform" in old.text

    # Trimming the Clip leaves its Text Layers where they were in it.
    trimmed = patch(client, job, saved, start=saved["start"] + 0.4)
    assert trimmed["text_layers"] == saved["text_layers"]
    assert preview(client, job, trimmed)["plan"]["texts"][0]["start"] == 0.5


def test_a_stored_candidate_and_its_revisions_read_in_the_new_shape_and_plan_as_before(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    job_dir = settings.data_dir / "jobs" / job["id"]
    # Saved before Text Styles: the Candidate at Revision 2, and its Revision 1 in its history.
    stored = json.loads((job_dir / CANDIDATES_FILE).read_text())
    [entry] = [c for c in stored if c["id"] == candidate["id"]]
    entry |= {"text_layers": BEFORE["layers"], "revision": 2}
    (job_dir / CANDIDATES_FILE).write_text(json.dumps(stored))
    history = [{
        "revision": 1, "source": "advanced-edit", "tab": None, "parts": ["Text Layers"], "at": None,
        "candidate": entry | {"text_layers": BEFORE["layers"][2:4], "revision": 1},
    }]
    (job_dir / REVISIONS_DIR).mkdir(exist_ok=True)
    (job_dir / REVISIONS_DIR / f"{candidate['id']}.json").write_text(json.dumps(history))

    [read] = [c for c in candidates(client, job) if c["id"] == candidate["id"]]
    assert [layer["id"] for layer in read["text_layers"]] == [layer["id"] for layer in BEFORE["layers"]]
    assert all("style" in layer and "outline" not in layer for layer in read["text_layers"])
    planned = preview(client, job, read)["plan"]["texts"]
    for event, before in zip(planned, BEFORE["events"], strict=True):
        as_before(event, before, tuple(key for key in before if key not in ("start", "end")))

    restored = client.post(f"{candidate_url(job, candidate)}/revisions/1/restore", json={"revision": 2})
    assert restored.status_code == 200, restored.text
    assert restored.json()["text_layers"] == read["text_layers"][2:4]


def test_a_text_layer_is_burned_in_where_and_when_the_plan_puts_it(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, text_layers=[
        {"id": "t1", "text": "HALO", "start": 1.0, "secs": 1.5, "transform": {"x": 300, "y": 500}, "style": {"colour": "#00FF00", "size": 160}},
    ])
    planned = preview(client, job, candidate)["plan"]["texts"][0]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    assert clip["output"]["text_layers"] == candidate["text_layers"]
    assert json.loads((job_dir / clip["output"]["plan"]).read_text())["texts"][0] == planned

    area = planned["area"]
    shown = full_frame(settings, job_dir / clip["output"]["video"], 1.8)
    rows, columns = pixels(shown, np.array([0, 255, 0]))
    assert len(rows) > 2000
    assert area["y"] - 4 <= rows.min() and rows.max() <= area["y"] + area["height"] + 4
    assert area["x"] - 4 <= columns.min() and columns.max() <= area["x"] + area["width"] + 4
    before = full_frame(settings, job_dir / clip["output"]["video"], 0.5)
    assert len(pixels(before, np.array([0, 255, 0]))[0]) == 0


def test_a_stored_boxed_text_layer_renders_its_plate_as_before(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    job_dir = settings.data_dir / "jobs" / job["id"]
    stored = json.loads((job_dir / CANDIDATES_FILE).read_text())
    old = {
        "id": "t1", "text": "HALO", "start": 0.5, "secs": 2.0, "x": 300, "y": 500, "size": 120, "colour": "#FFFFFF",
        "box": True, "box_colour": "#0000FF", "box_opacity": 1.0, "outline": 0,
    }
    for entry in stored:
        if entry["id"] == candidate["id"]:
            entry["text_layers"] = [old]
    (job_dir / CANDIDATES_FILE).write_text(json.dumps(stored))
    [candidate] = [c for c in candidates(client, job) if c["id"] == candidate["id"]]
    planned = preview(client, job, candidate)["plan"]["texts"][0]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    shown = full_frame(settings, job_dir / clip["output"]["video"], 1.0)
    rows, columns = pixels(shown, np.array([0, 0, 255]))
    box = planned["box"]
    assert len(rows) > 0.8 * box["width"] * box["height"] - 4000
    assert box["y"] - 3 <= rows.min() and rows.max() <= box["y"] + box["height"] + 3
    assert box["x"] - 3 <= columns.min() and columns.max() <= box["x"] + box["width"] + 3
