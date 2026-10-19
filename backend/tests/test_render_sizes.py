"""Rendering at any resolution (.scratch/export-settings/issues/02-render-at-any-resolution.md,
docs/adr/0021): the Render Plan stays in 1080x1920 output pixels, and the renderer draws it at the
Export Settings' size, every coordinate and size multiplied by one factor.

Seam B on `scaled_plan`, the pure function that gives the plan at another size; then Seam A with the
real ffmpeg, rendering one plan at two sizes and sampling the pixels of their frames.
"""

import copy
import subprocess
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Border, Keyframe, KeyProperty, Layout, Overlay, Shadow, Shape, TextLayer, Transform, TransitionKind
from app.config import RenderTuning
from app.encoding import ExportSettings
from app.layer_pictures import make_pictures
from app.planner import MAX_LAYER_PICTURE, Box, Join, MediaInfo, SegmentInput, plan_render
from app.renderer import Renderer, picture_layouts
from app.scaled_plan import scaled_plan
from app.styles import WatermarkKind, WatermarkPosition, WatermarkStyle
from app.transcript import Word
from app.video_source import SourceMetadata
from test_media_library import make
from test_render import pixels, plain_video, probe  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
STILL = "cd" * 16
LOGO = "ab" * 8
SPOKEN = [Word("podcast", 0.5, 1.4), Word("ini", 1.5, 2.0), Word("seru", 2.1, 3.0)]
_TEXT_LAYER = TypeAdapter(TextLayer)
_SHAPE = TypeAdapter(Shape)


def text_layer(**fields) -> TextLayer:
    given = {"id": "t1", "text": "HALO", "start": 0.0, "secs": 3.0, "transform": {"x": 300, "y": 500}, "style": {"size": 120}}
    return _TEXT_LAYER.validate_python(given | fields)


def shape(**fields) -> Shape:
    given = {"id": "s1", "start": 0.0, "secs": 3.0, "transform": {"x": 760, "y": 500}, "style": {"width": 300, "height": 120}}
    return _SHAPE.validate_python(given | fields)


def thirds(box: Box) -> Box:
    """`box` at 720p: each of its pixels two thirds."""
    return Box(round(box.x * 2 / 3), round(box.y * 2 / 3), round(box.width * 2 / 3), round(box.height * 2 / 3))


# Seam B: the plan at another size


def test_a_plan_at_its_own_size_is_itself():
    plan = plan_render(10, 14, SOURCE, layout=Layout.BLUR, words=SPOKEN, hook="Halo semua")
    assert scaled_plan(plan, (1080, 1920)) is plan


def test_at_720p_every_output_pixel_is_two_thirds_and_source_and_item_pixels_stay():
    decorated = {"radius": 0.25, "border": Border(9, "#FF0000"), "shadow": Shadow(blur=24, x=12, y=18)}
    slide = {KeyProperty.X: [Keyframe(0.0, 200.0), Keyframe(2.0, 800.0)], KeyProperty.SCALE: [Keyframe(0.0, 0.5), Keyframe(2.0, 1.0)]}
    overlay = Overlay("o", STILL, 0.0, 2.0, transform=Transform(x=540, y=960, scale=0.5), keys=slide, **decorated)
    logo = WatermarkStyle(kind=WatermarkKind.LOGO, logo=LOGO, position=WatermarkPosition.TOP_RIGHT, size=200, opacity=1.0)
    plan = plan_render(
        10, 14, SOURCE, layout=Layout.BLUR, words=SPOKEN, hook="Halo semua", hook_kicker="Baru",
        watermark_style=logo, logo_size=(200, 100), text_layers=[text_layer()], shapes=[shape()],
        overlays=[overlay], media_info={STILL: MediaInfo(200, 100, None, False)},
    )
    drawn = scaled_plan(plan, (720, 1280))
    assert (drawn.width, drawn.height) == (720, 1280)
    # Nothing without pixels changes: times, the Source, the frame rate, the styles.
    for field in ("start", "end", "source_width", "source_height", "fps", "caption_style", "hook_style", "watermark_style", "audio", "segments", "transitions"):
        assert getattr(drawn, field) == getattr(plan, field), field

    # Blur's panels: the background over the whole frame, the shot fitted in its middle; their areas
    # scaled (even, as the planner lays them), their crops still in the Source's pixels.
    [scene] = drawn.scenes
    [background, shot] = scene.panels
    [planned_background, planned_shot] = plan.scenes[0].panels
    assert (scene.start, scene.end, scene.layout) == (plan.scenes[0].start, plan.scenes[0].end, plan.scenes[0].layout)
    assert background.area == Box(0, 0, 720, 1280) and planned_background.area == Box(0, 0, 1080, 1920)
    assert planned_shot.area == Box(0, 656, 1080, 608) and shot.area == Box(0, 438, 720, 406)
    for panel, planned in ((background, planned_background), (shot, planned_shot)):
        assert (panel.crop_width, panel.crop_height, panel.path, panel.blur) == (planned.crop_width, planned.crop_height, planned.path, planned.blur)

    # The captions' and the hook's boxes and sizes, for a plan that is whole.
    for event, planned in zip(drawn.captions, plan.captions, strict=True):
        assert (event.text, event.words, event.start, event.end) == (planned.text, planned.words, planned.start, planned.end)
        assert event.area == thirds(planned.area) and event.size == pytest.approx(planned.size * 2 / 3)
    hook, planned_hook = drawn.hook, plan.hook
    assert hook.lines == planned_hook.lines and hook.area == thirds(planned_hook.area)
    assert hook.size == pytest.approx(planned_hook.size * 2 / 3)
    for anchor, planned_anchor in zip(hook.anchors, planned_hook.anchors, strict=True):
        assert anchor == pytest.approx((planned_anchor[0] * 2 / 3, planned_anchor[1] * 2 / 3))
    assert hook.boxes == [thirds(box) for box in planned_hook.boxes]
    assert hook.kicker.text == planned_hook.kicker.text and hook.kicker.box == thirds(planned_hook.kicker.box)
    assert hook.kicker.size == pytest.approx(planned_hook.kicker.size * 2 / 3)
    assert hook.kicker.anchor == pytest.approx((planned_hook.kicker.anchor[0] * 2 / 3, planned_hook.kicker.anchor[1] * 2 / 3))

    # The Logo's area: 400x200 at the top right becomes 267x133.
    assert plan.watermark.area.width == 400 and drawn.watermark.area == thirds(plan.watermark.area)
    assert drawn.watermark.logo == LOGO

    # A keyed, decorated Overlay: its drawn size, centre, bounds, corners, border and shadow in
    # output pixels, its item's pixels as they were, and its centre's Keyframes scaled with it.
    [event], [planned_event] = drawn.overlays, plan.overlays
    picture, planned_picture = event.picture, planned_event.picture
    assert (planned_picture.width, planned_picture.height, planned_picture.centre) == (540, 270, (540, 960))
    assert (picture.width, picture.height, picture.centre) == (360, 180, (360, 640))
    assert picture.bounds == Box(180, 550, 360, 180)
    assert (picture.crop, picture.item_size) == (planned_picture.crop, planned_picture.item_size)
    assert picture.radius == pytest.approx(planned_picture.radius * 2 / 3)
    assert picture.border == Border(6, "#FF0000")
    assert picture.shadow == Shadow(blur=16, x=8, y=12)
    assert picture.unscaled == pytest.approx((1080 * 2 / 3, 540 * 2 / 3))
    assert [(key.at, key.value) for key in picture.motion[KeyProperty.X]] == [(0.0, pytest.approx(200 * 2 / 3)), (2.0, pytest.approx(800 * 2 / 3))]
    assert picture.motion[KeyProperty.SCALE] == planned_picture.motion[KeyProperty.SCALE]
    assert (picture.rotation, picture.opacity, picture.flip_h) == (planned_picture.rotation, planned_picture.opacity, planned_picture.flip_h)

    # Picture layers: rasterised at the output's size (another picture, of the same key), and placed there.
    for event, planned_event in zip(drawn.picture_layers, plan.picture_layers, strict=True):
        assert event.layer == planned_event.layer and (event.start, event.end) == (planned_event.start, planned_event.end)
        assert event.layout.scale == pytest.approx(planned_event.layout.scale * 2 / 3, abs=1e-4)
        assert (event.layout.width, event.layout.height) == (planned_event.layout.width, planned_event.layout.height)
        assert event.image != planned_event.image and event.picture_key == planned_event.picture_key
        assert event.picture.item_size == event.layout.raster and event.picture.crop == Box(0, 0, *event.layout.raster)
        assert event.picture.width == pytest.approx(planned_event.picture.width * 2 / 3, abs=2)
        assert event.picture.centre == pytest.approx((planned_event.picture.centre[0] * 2 / 3, planned_event.picture.centre[1] * 2 / 3), abs=0.01)
        assert event.area == thirds(planned_event.area) and event.bounds == thirds(planned_event.bounds)
    [text], [planned_text] = drawn.texts, plan.texts
    [(x, y)], [(planned_x, planned_y)] = text.anchors, planned_text.anchors
    assert (x, y) == pytest.approx((planned_x * 2 / 3, planned_y * 2 / 3))
    assert text.lines == ["HALO"]

    # The plan itself is as it was: the preview and the plan file are in its pixels.
    assert plan.width == 1080 and plan.overlays[0].picture.centre == (540, 960) and plan.texts[0].layout.scale == 1


def test_at_4k_a_picture_is_rasterised_twice_as_large_under_the_cap():
    # A line 1106 px wide at 4 times its size is past the cap already, so it is rasterised at 3.7.
    huge = text_layer(text="Kalimat yang panjang sekali", transform={"scale": 4}, style={"size": 200})
    plan = plan_render(10, 14, SOURCE, text_layers=[text_layer(), huge], shapes=[shape(transform={"scale": 1.2})])
    drawn = scaled_plan(plan, (2160, 3840))
    small, large = drawn.texts
    assert small.layout.scale == 2 and small.layout.raster == (2 * plan.texts[0].layout.width, 2 * plan.texts[0].layout.height)
    assert plan.texts[1].layout.scale < 4 and max(plan.texts[1].layout.raster) == MAX_LAYER_PICTURE
    assert large.layout.scale == plan.texts[1].layout.scale and max(large.layout.raster) == MAX_LAYER_PICTURE
    # The Shape at 1.2 was rasterised at the next step up, 1.5; at 4K that picture is 3 times its size.
    [figure] = drawn.shapes
    assert (plan.shapes[0].layout.scale, figure.layout.scale) == (1.5, 3)
    assert figure.picture.width == 2 * plan.shapes[0].picture.width


# Seam A: the real ffmpeg

# plain_video: 10 s of a plain grey 640x360 picture, which Blur fits in the frame's middle.
PLAIN = SourceMetadata(duration=10.0, fps=25.0, width=640, height=360, codec="h264")
# The Caption Style's highlight colour: each spoken Word here is a line of its own, highlighted whole.
ORANGE, GREEN, MAGENTA = np.array([0xFF, 0x9F, 0x0A]), np.array([0, 255, 0]), np.array([255, 0, 255])
BLUE, RED = np.array([0, 0, 255]), np.array([255, 0, 0])


@pytest.fixture(scope="session")
def stills(tmp_path_factory) -> dict[str, Path]:
    """A blue 200x100 PNG for an Overlay, and a red one for a Logo."""
    folder = tmp_path_factory.mktemp("sizes")
    for name, colour in (("blue", "0x0000ff"), ("red", "0xff0000")):
        make(folder / f"{name}.png", "-f", "lavfi", "-i", f"color=c={colour}:size=200x100", "-frames:v", "1")
    return {"blue": folder / "blue.png", "red": folder / "red.png"}


def rendered_at(settings, tmp_path: Path, source: Path, plan, resolution: int, files=None, logo: Path | None = None) -> Path:
    """`plan` of `source` rendered at `resolution` (no loudness, which takes a pass of its own), its
    picture layers' pictures made for that size first, as the render worker makes them."""
    export = ExportSettings(resolution=resolution, loudness=None)
    pictures = make_pictures(settings.ffmpeg_bin, picture_layouts(plan, export), tmp_path / "pictures")
    video = tmp_path / f"clip-{resolution}.mp4"
    Renderer(settings.ffmpeg_bin, RenderTuning()).render(
        source, plan, video, tmp_path / f"poster-{resolution}.jpg", logo=logo, files=files, pictures=pictures, export=export,
    )
    return video


def frame(settings, video: Path, at: float) -> np.ndarray:
    """The Clip's frame at `at` seconds, RGB, at its own size."""
    stream = next(s for s in probe(settings, video)["streams"] if s["codec_type"] == "video")
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-ss", f"{at}", "-i", str(video), "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(stream["height"], stream["width"], 3).astype(int)


def extent(picture: np.ndarray, colour: np.ndarray, tolerance: int = 40) -> tuple[list[int], int]:
    """The left, top, right and bottom of the picture's pixels of `colour`, and how many there are."""
    rows, columns = pixels(picture, colour, tolerance)
    assert len(rows), colour
    return [int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1], len(rows)


def test_at_720p_a_caption_a_text_layer_a_shape_an_overlay_and_the_logo_land_at_two_thirds_of_their_places(
    settings, plain_video, stills, tmp_path
):
    # Green words, a magenta figure, a blue picture and a red Logo, each clear of the others and of
    # the captions, over a grey Clip.
    overlay = Overlay("o", STILL, 0.0, 3.0, transform=Transform(x=300, y=800, scale=0.3))
    logo = WatermarkStyle(kind=WatermarkKind.LOGO, logo=LOGO, position=WatermarkPosition.TOP_RIGHT, size=200, opacity=1.0)
    plan = plan_render(
        2.0, 5.0, PLAIN, layout=Layout.BLUR, words=SPOKEN, watermark_style=logo, logo_size=(200, 100),
        text_layers=[text_layer(style={"size": 120, "colour": "#00FF00"})],
        shapes=[shape(transform={"x": 760, "y": 650}, style={"width": 300, "height": 120, "fill": "#FF00FF"})],
        overlays=[overlay], media_info={STILL: MediaInfo(200, 100, None, False)},
    )
    planned = copy.deepcopy(plan)
    frames = {}
    for resolution in (1080, 720):
        video = rendered_at(settings, tmp_path, plain_video, plan, resolution, {STILL: stills["blue"]}, stills["red"])
        frames[resolution] = frame(settings, video, 1.0)
    # The plan is drawn at 720p, not changed: the plan file and the preview stay in its pixels.
    assert plan == planned
    assert frames[1080].shape == (1920, 1080, 3) and frames[720].shape == (1280, 720, 3)
    for name, colour in (("caption", ORANGE), ("text layer", GREEN), ("shape", MAGENTA), ("overlay", BLUE), ("logo", RED)):
        edges, count = extent(frames[1080], colour)
        edges_720, count_720 = extent(frames[720], colour)
        assert edges_720 == pytest.approx([edge * 2 / 3 for edge in edges], abs=3), name
        assert count_720 == pytest.approx(count * 4 / 9, rel=0.15), name


def edge_pixels(picture: np.ndarray, background: np.ndarray, ink: np.ndarray) -> tuple[int, int]:
    """How many of the picture's pixels are `ink`, and how many are between it and `background`
    (its antialiased edge): neither within 40 of the one nor of the other."""
    near_ink = np.abs(picture - ink).max(axis=2) <= 40
    near_background = np.abs(picture - background).max(axis=2) <= 40
    return int(near_ink.sum()), int((~near_ink & ~near_background).sum())


def test_at_1440p_a_text_layers_edge_is_as_wide_as_at_1080_its_picture_rasterised_at_1440(settings, plain_video, tmp_path):
    plan = plan_render(2.0, 4.0, PLAIN, layout=Layout.BLUR, text_layers=[text_layer(text="HALO SEMUA", style={"size": 120, "colour": "#FFFFFF"})])
    [layout] = picture_layouts(plan, ExportSettings())
    [sharp] = picture_layouts(plan, ExportSettings(resolution=1440))
    assert sharp.raster == pytest.approx((layout.raster[0] * 4 / 3, layout.raster[1] * 4 / 3), abs=1) and sharp.name != layout.name
    counts = {}
    for resolution in (1080, 1440):
        picture = frame(settings, rendered_at(settings, tmp_path, plain_video, plan, resolution), 1.0)
        [event] = scaled_plan(plan, (resolution, resolution * 16 // 9)).texts
        box = event.bounds
        grey = picture[box.y + box.height + 20, box.x]
        counts[resolution] = edge_pixels(picture[box.y - 10:box.y + box.height + 10, box.x - 10:box.x + box.width + 10], grey, np.array([255, 255, 255]))
    (ink, edge), (ink_1440, edge_1440) = counts[1080], counts[1440]
    # Its ink is 16/9 as many pixels; its edge, as wide but 4/3 as long, is at most 4/3 as many (a
    # 1080 picture scaled up would make it 4/3 as wide too, about 16/9 as many).
    assert ink_1440 == pytest.approx(ink * 16 / 9, rel=0.1)
    assert edge_1440 <= edge * 4 / 3 * 1.1


def test_at_720p_a_keyed_overlay_and_a_turned_keyed_shape_are_where_their_scaled_keyframes_say(settings, plain_video, stills, tmp_path):
    # A blue picture sliding right, and a magenta bar sliding down as it turns from 0° to 60°.
    slide = {KeyProperty.X: [Keyframe(0.0, 200.0), Keyframe(2.0, 800.0)]}
    overlay = Overlay("o", STILL, 0.0, 2.0, transform=Transform(x=200, y=500, scale=0.5), keys=slide)
    turning = shape(
        transform={"x": 540, "y": 1100}, style={"width": 300, "height": 120, "fill": "#FF00FF"},
        keys={"y": [{"at": 0.0, "value": 1000.0}, {"at": 2.0, "value": 1400.0}], "rotation": [{"at": 0.0, "value": 0.0}, {"at": 2.0, "value": 60.0}]},
    )
    plan = plan_render(2.0, 4.0, PLAIN, layout=Layout.BLUR, shapes=[turning], overlays=[overlay], media_info={STILL: MediaInfo(200, 100, None, False)})
    videos = {resolution: rendered_at(settings, tmp_path, plain_video, plan, resolution, {STILL: stills["blue"]}) for resolution in (1080, 720)}
    for at in (0.5, 1.5):
        for name, colour in (("overlay", BLUE), ("shape", MAGENTA)):
            edges, count = extent(frame(settings, videos[1080], at), colour)
            edges_720, count_720 = extent(frame(settings, videos[720], at), colour)
            assert edges_720 == pytest.approx([edge * 2 / 3 for edge in edges], abs=3), (name, at)
            assert count_720 == pytest.approx(count * 4 / 9, rel=0.15), (name, at)
    # At 1.5 s the picture's centre is 650 at 1080, 433 at 720, as its Keyframes say (within the 8
    # pixels it moves in a frame there).
    left, _, right, _ = extent(frame(settings, videos[720], 1.5), BLUE)[0]
    assert (left + right) / 2 == pytest.approx(650 * 2 / 3, abs=8)


@pytest.mark.parametrize("resolution", [720, 2160])
def test_a_blur_scene_and_a_transition_render_at_720p_and_4k_at_their_size(settings, plain_video, tmp_path, resolution):
    plan = plan_render(
        1.0, 5.0, PLAIN, layout=Layout.BLUR,
        main_track=[SegmentInput(1.0, 2.0), SegmentInput(4.0, 5.0, join=Join(TransitionKind.SLIDELEFT, 0.4))],
    )
    assert plan.transitions
    video = rendered_at(settings, tmp_path, plain_video, plan, resolution)
    width, height = resolution, resolution * 16 // 9
    stream = next(s for s in probe(settings, video)["streams"] if s["codec_type"] == "video")
    assert (stream["width"], stream["height"]) == (width, height)
    # The grey shot in the middle of its darkened, blurred background either side of the Transition;
    # the poster at the Clip's size.
    for at in (0.3, 0.8, 1.3):
        picture = frame(settings, video, at)
        assert picture[height // 2, width // 2].tolist() == pytest.approx([0x4A, 0x55, 0x60], abs=12), at
        assert 0 < picture[height // 10, width // 2].mean() < picture[height // 2, width // 2].mean() - 10, at
    poster = subprocess.run(
        [str(settings.ffmpeg_bin), "-v", "error", "-i", str(tmp_path / f"poster-{resolution}.jpg"), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    assert len(poster) == width * height * 3
