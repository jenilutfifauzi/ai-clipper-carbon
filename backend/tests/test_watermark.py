"""Watermarks: a line of text or an uploaded Logo shown over the whole Clip (.scratch/watermark/spec.md).

Seam B on the planner and the ASS it gives the Renderer, then the Logos API and Seam A renders with
the real ffmpeg.
"""

import json
import subprocess
from dataclasses import replace

import numpy as np
import pytest

from app.config import load_settings
from app.planner import OUTPUT_HEIGHT, OUTPUT_WIDTH, SAFE_AREA, WATERMARK_MARGIN, Box, font_metrics, plan_render, watermark
from app.renderer import _ass
from app.styles import (
    DEFAULT,
    InvalidStyle,
    PresetStore,
    StyleOverrides,
    WatermarkKind,
    WatermarkPosition,
    WatermarkStyle,
    resolve,
)
from app.video_source import SourceMetadata
from test_render import HEARD, add, check_clip, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
TEXT = WatermarkStyle(kind=WatermarkKind.TEXT, text="@kanal", size=60)


def inside(box: Box, area: Box) -> bool:
    return area.x <= box.x and box.x + box.width <= area.x + area.width and area.y <= box.y and box.y + box.height <= area.y + area.height


def test_no_watermark_by_default_and_the_default_script_is_unchanged():
    planned = plan_render(0, 5, SOURCE, hook="Halo")
    assert planned.watermark is None
    assert "Watermark" not in _ass(planned)
    # Blank text, a Logo kind without a Logo, or a Logo that is missing (deleted): nothing.
    assert watermark(WatermarkStyle(kind=WatermarkKind.TEXT, text="  ")) is None
    assert watermark(WatermarkStyle(kind=WatermarkKind.LOGO)) is None
    assert watermark(WatermarkStyle(kind=WatermarkKind.LOGO, logo="ab12cd34"), None) is None


def test_the_nine_positions_sit_inside_the_safe_area_by_its_margin():
    margin = Box(SAFE_AREA.x + WATERMARK_MARGIN, SAFE_AREA.y + WATERMARK_MARGIN,
                 SAFE_AREA.width - 2 * WATERMARK_MARGIN, SAFE_AREA.height - 2 * WATERMARK_MARGIN)
    areas = {}
    for position in WatermarkPosition:
        if position is WatermarkPosition.CUSTOM:
            continue
        event = watermark(WatermarkStyle(kind=WatermarkKind.LOGO, logo="ab12cd34", position=position, size=100), (400, 200))
        assert event is not None and (event.area.width, event.area.height) == (200, 100)
        assert inside(event.area, margin), position
        areas[position.value] = event.area
    assert (areas["top_left"].x, areas["top_left"].y) == (margin.x, margin.y)
    assert areas["bottom_right"].x + 200 == margin.x + margin.width
    assert areas["bottom_right"].y + 100 == margin.y + margin.height
    # The middle column is centred in the frame, like the captions and the hook.
    assert areas["top"].x == areas["middle"].x == areas["bottom"].x == (OUTPUT_WIDTH - 200) // 2
    assert areas["left"].y == areas["middle"].y == areas["right"].y


def test_a_custom_watermark_is_centred_where_it_was_dragged_and_kept_in_the_frame():
    style = WatermarkStyle(kind=WatermarkKind.LOGO, logo="ab12cd34", position=WatermarkPosition.CUSTOM, x=300, y=700, size=100)
    assert watermark(style, (100, 100)).area == Box(250, 650, 100, 100)
    corner = WatermarkStyle(kind=WatermarkKind.LOGO, logo="ab12cd34", position=WatermarkPosition.CUSTOM, x=1080, y=1920, size=100)
    assert watermark(corner, (100, 100)).area == Box(OUTPUT_WIDTH - 100, OUTPUT_HEIGHT - 100, 100, 100)


def test_a_text_watermark_is_measured_in_its_font_and_set_smaller_when_wider_than_the_frame():
    event = watermark(TEXT)
    assert (event.size, event.area.height) == (60, 60)
    assert event.area.width == pytest.approx(font_metrics(TEXT.font).width("@kanal", 60), abs=1)
    wide = watermark(WatermarkStyle(kind=WatermarkKind.TEXT, text="W" * 60, size=200))
    assert wide.size < 200 and wide.area.width <= OUTPUT_WIDTH


def test_a_text_watermark_is_the_first_event_of_the_script_for_the_whole_clip():
    planned = plan_render(0, 5, SOURCE, hook="Halo", watermark_style=replace(TEXT, opacity=0.5, colour="#FF0000"))
    script = _ass(planned)
    style = next(line for line in script.splitlines() if line.startswith("Style: Watermark,"))
    assert ",60,&H000000FF,&H000000FF," in style
    events = [line for line in script.splitlines() if line.startswith("Dialogue:")]
    area = planned.watermark.area
    centre = f"\\pos({area.x + area.width / 2:g},{area.y + area.height / 2:g})"
    assert events[0] == f"Dialogue: 0,0:00:00.00,0:00:05.00,Watermark,,0,0,0,,{{{centre}\\alpha&H80&}}@kanal"
    # Without an outline, none.
    plain = _ass(plan_render(0, 5, SOURCE, watermark_style=WatermarkStyle(kind=WatermarkKind.TEXT, text="x", outline=False)))
    assert next(line for line in plain.splitlines() if line.startswith("Style: Watermark,")).endswith(",1,0,0,5,0,0,0,1")


def test_watermark_overrides_are_validated_and_presets_keep_their_watermark(tmp_path):
    styles = resolve(DEFAULT, StyleOverrides(watermark={"kind": "text", "text": "@kanal", "position": "bottom_left"}))
    assert (styles.watermark.kind, styles.watermark.position) == ("text", "bottom_left")
    for overrides, message in (
        ({"size": 2000}, "size"), ({"opacity": 0}, "opacity"), ({"logo": "../x"}, "logo"), ({"glow": 1}, "glow"),
    ):
        with pytest.raises(InvalidStyle, match=message):
            resolve(DEFAULT, StyleOverrides(watermark=overrides))
    store = PresetStore(tmp_path / "presets.json")
    made = store.create("Brand", DEFAULT.caption, DEFAULT.hook, TEXT)
    assert PresetStore(tmp_path / "presets.json").get(made.id).watermark == TEXT
    # Presets saved before Watermarks have none.
    (tmp_path / "old.json").write_text(json.dumps([{"id": "old", "name": "Old"}]))
    assert PresetStore(tmp_path / "old.json").get("old").watermark == WatermarkStyle()


# Logos, through the API.


@pytest.fixture(scope="session")
def red_logo(tmp_path_factory) -> bytes:
    """A 200x100 red PNG with a transparent right half."""
    path = tmp_path_factory.mktemp("logo") / "logo.png"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error", "-f", "lavfi", "-i", "color=c=red@1.0:size=200x100,format=rgba",
        "-vf", "geq=r='255':g='0':b='0':a='if(lt(X,100),255,0)'", "-frames:v", "1", str(path),
    ], check=True)
    return path.read_bytes()


def upload(client, data: bytes, name: str = "brand.png"):
    return client.post("/api/logos", files={"file": (name, data, "application/octet-stream")})


def test_logos_are_uploaded_kept_as_png_listed_served_and_deleted(client, settings, red_logo):
    assert client.get("/api/logos").json() == []
    response = upload(client, red_logo)
    assert response.status_code == 201, response.text
    logo = response.json()
    assert (logo["name"], logo["width"], logo["height"]) == ("brand", 200, 100)
    assert client.get("/api/logos").json() == [logo]
    served = client.get(f"/api/logos/{logo['id']}")
    assert served.status_code == 200 and served.content.startswith(b"\x89PNG")
    # Kept in their own folder, which a restart doesn't empty.
    assert (settings.data_dir / "logos" / f"{logo['id']}.png").is_file()

    for data, name in ((b"not an image", "x.png"), (b"\x89PNG\r\n\x1a\n" + b"broken", "broken.png"), (b"\xff" * (5 * 2**20 + 10), "big.jpg")):
        assert upload(client, data, name).status_code == 422
    assert len(client.get("/api/logos").json()) == 1

    assert client.delete(f"/api/logos/{logo['id']}").status_code == 204
    assert client.get("/api/logos").json() == []
    assert client.get(f"/api/logos/{logo['id']}").status_code == 404
    assert client.delete(f"/api/logos/{logo['id']}").status_code == 404


def test_a_watermark_can_only_be_given_a_logo_that_exists(client, red_logo):
    logo = upload(client, red_logo).json()
    watermark = {"kind": "logo", "logo": "ab12cd34ab12cd34ab12cd34ab12cd34"}
    assert client.post("/api/presets", json={"name": "Brand", "watermark": watermark}).status_code == 422
    made = client.post("/api/presets", json={"name": "Brand", "watermark": {**watermark, "logo": logo["id"]}})
    assert made.status_code == 201 and made.json()["watermark"]["logo"] == logo["id"]
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"style_overrides": {"watermark": watermark}})
    assert response.status_code == 422
    # A Logo Watermark without a Logo yet (picked before one is uploaded) is fine, and shows nothing.
    chosen = patch(client, job, candidate, style_overrides={"watermark": {"kind": "logo"}})
    assert chosen["style_overrides"]["watermark"] == {"kind": "logo"}
    assert preview(client, job, chosen)["plan"]["watermark"] is None


def test_a_logo_watermark_is_burned_in_where_the_plan_puts_it(client, settings, video_source, transcriber, plain_video, red_logo):
    video_source.video = plain_video
    transcriber.words = HEARD
    logo = upload(client, red_logo).json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, style_overrides={
        "watermark": {"kind": "logo", "logo": logo["id"], "position": "top_right", "size": 200, "opacity": 1.0},
    })
    planned = preview(client, job, candidate)["plan"]["watermark"]
    assert (planned["area"]["width"], planned["area"]["height"]) == (400, 200)
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    assert clip["output"]["watermark_style"]["logo"] == logo["id"]
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    assert plan["watermark"] == planned

    area = planned["area"]
    for at in (0.2, candidate["end"] - candidate["start"] - 0.2):
        frame = full_frame(settings, job_dir / clip["output"]["video"], at)
        rows, columns = pixels(frame, np.array([255, 0, 0]), tolerance=60)
        assert len(rows) > 30000, at
        # Its opaque left half, inside its area; the transparent half shows the background.
        assert area["y"] - 2 <= rows.min() and rows.max() <= area["y"] + area["height"] + 2
        assert area["x"] - 2 <= columns.min() and columns.max() <= area["x"] + area["width"] // 2 + 2


def test_a_text_watermark_is_burned_in_at_its_opacity(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, style_overrides={
        "watermark": {"kind": "text", "text": "@KANAL", "colour": "#00FF00", "position": "bottom_left", "size": 120,
                      "outline": False, "opacity": 1.0},
    })
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    area = json.loads((job_dir / clip["output"]["plan"]).read_text())["watermark"]["area"]
    frame = full_frame(settings, job_dir / clip["output"]["video"], 0.5)
    rows, columns = pixels(frame, np.array([0, 255, 0]))
    assert len(rows) > 2000
    assert area["y"] <= rows.min() and rows.max() <= area["y"] + area["height"]
    assert area["x"] - 4 <= columns.min() and columns.max() <= area["x"] + area["width"] + 4
