"""Text Layers: free text overlays of the Advanced Edit (.scratch/advanced-edit/issues/02-text-layers.md).

Seam B on the planner and the ASS it gives the Renderer, then the update API and a Seam A render
with the real ffmpeg.
"""

import json

import numpy as np
import pytest

from app.candidates import TextAlign, TextLayer
from app.planner import OUTPUT_HEIGHT, OUTPUT_WIDTH, TEXT_MARGIN, font_metrics, plan_render, text_event
from app.renderer import _ass
from app.styles import Animation
from app.video_source import SourceMetadata
from test_render import HEARD, add, check_clip, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def layer(**fields) -> TextLayer:
    return TextLayer(**{"id": "t1", "text": "Halo", "start": 1.0, "secs": 2.0, **fields})


def test_without_text_layers_the_plan_and_the_script_are_unchanged():
    planned = plan_render(0, 5, SOURCE, hook="Halo")
    assert planned.texts == []
    script = _ass(planned)
    assert "Style: Text" not in script
    # The hook keeps its layers.
    assert "Dialogue: 2," in script and "Dialogue: 5," not in script


def test_a_text_layer_is_centred_on_its_place_and_measured_in_its_font():
    event = text_event(layer(text="Halo dunia", x=400, y=700, size=80), 10)
    width = font_metrics(event.layer.font).width("Halo dunia", 80)
    assert event.size == 80 and event.lines == ["Halo dunia"]
    assert event.area.width == pytest.approx(width, abs=1)
    assert event.area.x + event.area.width / 2 == pytest.approx(400, abs=1)
    assert event.area.y + event.area.height / 2 == pytest.approx(700, abs=1)
    assert (event.start, event.end) == (1.0, 3.0)
    assert event.box is None


def test_lines_are_split_at_newlines_and_aligned():
    centred = text_event(layer(text="Satu\nDua yang lebih panjang", size=60), 10)
    assert centred.lines == ["Satu", "Dua yang lebih panjang"]
    [first, second] = centred.anchors
    assert first[0] == second[0] == pytest.approx(centred.area.x + centred.area.width / 2)
    assert second[1] > first[1]
    left = text_event(layer(text="Satu\nDua yang lebih panjang", size=60, align=TextAlign.LEFT), 10)
    metrics = font_metrics(left.layer.font)
    assert left.anchors[0][0] - metrics.width("Satu", 60) / 2 == pytest.approx(left.area.x, abs=0.5)
    right = text_event(layer(text="Satu\nDua yang lebih panjang", size=60, align=TextAlign.RIGHT), 10)
    assert right.anchors[0][0] + metrics.width("Satu", 60) / 2 == pytest.approx(right.area.x + right.area.width, abs=0.5)


def test_a_box_pads_the_text_and_a_text_too_wide_is_set_smaller_inside_the_frame():
    plain = text_event(layer(size=80), 10)
    boxed = text_event(layer(size=80, box=True), 10)
    assert boxed.box == boxed.area and boxed.area.width > plain.area.width and boxed.area.height > plain.area.height
    wide = text_event(layer(text="Ini adalah kalimat yang sangat panjang sekali", size=200, box=True), 10)
    assert wide.size < 200
    assert wide.area.width <= OUTPUT_WIDTH - 2 * TEXT_MARGIN + 1
    # Placed near a corner, it is kept inside the frame.
    corner = text_event(layer(size=120, x=OUTPUT_WIDTH, y=OUTPUT_HEIGHT), 10)
    assert corner.area.x + corner.area.width <= OUTPUT_WIDTH and corner.area.y + corner.area.height <= OUTPUT_HEIGHT


def test_a_text_layer_is_kept_in_the_clip_and_blank_or_late_ones_show_nothing():
    assert text_event(layer(start=4.0, secs=5.0), 6).end == 6
    assert text_event(layer(start=6.0), 6) is None
    assert text_event(layer(text="  \n "), 6) is None
    # Emoji, which no bundled font has, are left out.
    assert text_event(layer(text="Halo 🔥"), 6).lines == ["Halo"]


def test_text_layers_are_drawn_over_the_captions_and_under_the_hook_in_their_order():
    planned = plan_render(
        0, 5, SOURCE, hook="Halo",
        text_layers=[layer(id="a", colour="#00FF00", box=True), layer(id="b", text="Dua", animation_in=Animation.FADE)],
    )
    assert [event.layer.id for event in planned.texts] == ["a", "b"]
    script = _ass(planned)
    assert "Style: Text0,Montserrat ExtraBold,80,&H0000FF00" in script
    events = [line for line in script.splitlines() if line.startswith("Dialogue")]
    texts = [line for line in events if ",Text" in line]
    hooks = [line for line in events if ",Hook," in line]
    layers = lambda lines: [int(line.split(",")[0].split()[1]) for line in lines]
    # Each Text Layer above the one before, and the hook above them all.
    assert layers([line for line in texts if ",Text0," in line]) == [2, 3]
    assert min(layers([line for line in texts if ",Text1," in line])) > 3
    assert min(layers(hooks)) > max(layers(texts))
    assert "\\fad(300,0)" in next(line for line in texts if ",Text1," in line)


def test_text_layers_are_saved_on_the_candidate_validated_and_kept_through_a_trim(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    title = {"id": "t1", "text": "Judul", "start": 0.5, "secs": 2, "colour": "#ff0000"}
    saved = patch(client, job, candidate, text_layers=[title])
    assert saved["edited"] is True
    assert saved["text_layers"][0]["colour"] == "#FF0000" and saved["text_layers"][0]["size"] == 80
    planned = preview(client, job, saved)["plan"]["texts"]
    assert [event["lines"] for event in planned] == [["Judul"]]

    for bad in (
        [title | {"font": "comic-sans"}],
        [title | {"secs": 0}],
        [title | {"text": "x" * 301}],
        [title, title],
        [title | {"surprise": 1}],
    ):
        response = client.patch(candidate_url(job, candidate), json={"text_layers": bad})
        assert response.status_code == 422, bad

    # Trimming the Clip leaves its Text Layers where they were in it.
    trimmed = patch(client, job, saved, start=saved["start"] + 0.4)
    assert trimmed["text_layers"] == saved["text_layers"]
    assert preview(client, job, trimmed)["plan"]["texts"][0]["start"] == 0.5


def test_a_text_layer_is_burned_in_where_and_when_the_plan_puts_it(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, text_layers=[
        {"id": "t1", "text": "HALO", "start": 1.0, "secs": 1.5, "colour": "#00FF00", "size": 160, "x": 300, "y": 500},
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
