"""The Canvas (docs/adr/0022): each aspect's frame in output pixels, its Safe Area and the mapping
from the Reference Space. Pure (Seam B)."""

import pytest

from app.candidates import CueEdit, Keyframe, KeyProperty, Layout, Overlay, Transform
from app.canvas import CANVASES, PORTRAIT, REFERENCE, Aspect, Box, canvas_for
from app.planner import Face, FrameFaces, MediaInfo, SceneLayout, SegmentInput, hook_width, picture_at, plan_render
from app.styles import CaptionPosition, CaptionStyle, HookPosition, HookStyle, WatermarkKind, WatermarkPosition, WatermarkStyle
from app.transcript import Word
from app.video_source import SourceMetadata


def test_each_aspect_has_a_short_side_of_1080() -> None:
    assert {aspect: canvas_for(aspect).size for aspect in Aspect} == {
        Aspect.PORTRAIT: (1080, 1920),
        Aspect.FEED: (1080, 1350),
        Aspect.SQUARE: (1080, 1080),
        Aspect.LANDSCAPE: (1920, 1080),
    }
    assert canvas_for("16:9") is CANVASES[Aspect.LANDSCAPE]
    assert PORTRAIT is canvas_for(Aspect.PORTRAIT) and PORTRAIT.size == REFERENCE


def test_an_unknown_aspect_is_refused() -> None:
    with pytest.raises(ValueError):
        canvas_for("4:3")


def test_the_portrait_safe_area_is_clear_of_the_platforms_buttons() -> None:
    assert PORTRAIT.safe_area == Box(0, 232, 950, 1304)


@pytest.mark.parametrize("aspect", [Aspect.FEED, Aspect.SQUARE, Aspect.LANDSCAPE])
def test_the_other_safe_areas_keep_a_twentieth_clear_at_each_edge(aspect: Aspect) -> None:
    canvas = canvas_for(aspect)
    safe = canvas.safe_area
    assert (safe.x, safe.y) == (round(canvas.width / 20), round(canvas.height / 20))
    assert (safe.x + safe.width, safe.y + safe.height) == (canvas.width - safe.x, canvas.height - safe.y)


def test_portrait_caption_places_are_todays() -> None:
    assert PORTRAIT.seam_captions == Box(130, 860, 820, 200)
    assert PORTRAIT.lower_captions == Box(130, 1296, 820, 200)
    assert PORTRAIT.top_captions == Box(130, 430, 820, 200)
    assert PORTRAIT.split_height == 960


def test_a_place_in_the_reference_space_maps_in_proportion() -> None:
    assert PORTRAIT.from_reference(270, 480) == (270, 480)
    assert canvas_for(Aspect.LANDSCAPE).from_reference(270, 480) == (480, 270)
    assert canvas_for(Aspect.FEED).from_reference(1080, 1920) == (1080, 1350)


def test_a_plan_is_made_on_its_canvas_with_its_safe_area() -> None:
    source = SourceMetadata(duration=3600, fps=25, width=1920, height=1080, codec="h264")
    portrait = plan_render(0, 10, source)
    assert (portrait.width, portrait.height, portrait.safe_area) == (1080, 1920, PORTRAIT.safe_area)
    landscape = canvas_for(Aspect.LANDSCAPE)
    plan = plan_render(0, 10, source, canvas=landscape)
    assert (plan.width, plan.height, plan.safe_area) == (1920, 1080, landscape.safe_area)
    [scene] = plan.scenes
    assert all(panel.area.x + panel.area.width <= 1920 and panel.area.y + panel.area.height <= 1080 for panel in scene.panels)


# The Layouts on each Canvas (canvas-aspect/03): a 1920x1080 Source at 25 fps, whose speaker glides
# from x 500 to 1400 over 3 s.
WIDE = SourceMetadata(duration=3600, fps=25, width=1920, height=1080, codec="h264")
GLIDE = [FrameFaces(round(k * 0.12, 3), [Face(500 + min(900, 300 * k * 0.12) - 150, 300, 300, 300, 0.95)]) for k in range(40)]


@pytest.mark.parametrize(("aspect", "crop"), [(Aspect.SQUARE, (1080, 1080)), (Aspect.FEED, (864, 1080)), (Aspect.PORTRAIT, (608, 1080))])
def test_track_crops_the_full_height_at_the_canvass_shape_and_follows_the_face(aspect, crop):
    canvas = canvas_for(aspect)
    plan = plan_render(100, 105, WIDE, faces=GLIDE, layout=Layout.TRACK, canvas=canvas)
    [scene] = plan.scenes
    [panel] = scene.panels
    assert (panel.crop_width, panel.crop_height) == crop
    assert panel.area == Box(0, 0, *canvas.size)
    # It follows the speaker to the right.
    assert panel.path[-1].x > panel.path[0].x


def test_track_on_16_9_with_a_16_9_source_shows_the_whole_source_without_moving():
    canvas = canvas_for(Aspect.LANDSCAPE)
    plan = plan_render(100, 105, WIDE, faces=GLIDE, layout=Layout.TRACK, canvas=canvas)
    [scene] = plan.scenes
    [panel] = scene.panels
    assert (panel.crop_width, panel.crop_height, panel.area) == (1920, 1080, Box(0, 0, 1920, 1080))
    assert [(point.x, point.y) for point in panel.path] == [(0, 0)]


def test_blur_fits_the_source_over_its_blurred_cover_as_a_band_on_1_1_and_alone_on_16_9():
    square = plan_render(100, 105, WIDE, layout=Layout.BLUR, canvas=canvas_for(Aspect.SQUARE))
    [background, shot] = square.scenes[0].panels
    assert background.blur and (background.area, background.crop_width, background.crop_height) == (Box(0, 0, 1080, 1080), 1080, 1080)
    # The band: the whole Source, 1080 wide, in the middle.
    assert (shot.area, shot.crop_width, shot.crop_height) == (Box(0, 236, 1080, 608), 1920, 1080)

    wide = plan_render(100, 105, WIDE, layout=Layout.BLUR, canvas=canvas_for(Aspect.LANDSCAPE))
    [background, shot] = wide.scenes[0].panels
    # The Source covers the whole Canvas: nothing of its blur shows.
    assert shot.area == Box(0, 0, 1920, 1080) and (shot.crop_width, shot.crop_height) == (1920, 1080)


def test_a_manual_scene_without_a_framing_is_centred_on_its_canvas():
    plan = plan_render(100, 105, WIDE, layout=Layout.MANUAL, canvas=canvas_for(Aspect.LANDSCAPE))
    [scene] = plan.scenes
    assert scene.picture.centre == (960, 540)
    assert plan_render(100, 105, WIDE, layout=Layout.MANUAL).scenes[0].picture.centre == (540, 960)


def test_a_keyed_centre_is_held_on_the_frame_it_is_drawn_on():
    keys = {KeyProperty.X: [Keyframe(0.0, 100.0), Keyframe(1.0, 1800.0)]}
    overlay = Overlay("o", "cd" * 16, 0.0, 2.0, transform=Transform(x=960, y=540, scale=0.5), keys=keys)
    plan = plan_render(100, 105, WIDE, overlays=[overlay], media_info={"cd" * 16: MediaInfo(200, 100, None, False)}, canvas=canvas_for(Aspect.LANDSCAPE))
    [event] = plan.overlays
    assert picture_at(event.picture, 1.5, (plan.width, plan.height)).centre[0] == 1800
    # On 9:16 the same Keyframe is held at the frame's right edge.
    assert picture_at(event.picture, 1.5).centre[0] == 1080


# Split, portrait Sources and captions on Auto on each Canvas (canvas-aspect/06): two speakers who
# hold still, the right one detected first, their faces' centres at x 700 and 1220, y 600.
PAIR = [FrameFaces(round(k * 0.12, 3), [Face(1070, 450, 300, 300, 0.95), Face(550, 450, 300, 300, 0.9)]) for k in range(40)]
WORDS = [Word("halo", 0.2, 0.6), Word("semua", 0.6, 1.0)]


@pytest.mark.parametrize(
    ("aspect", "panels", "crop"),
    [
        (Aspect.PORTRAIT, (Box(0, 0, 1080, 960), Box(0, 960, 1080, 960)), (960, 854)),
        (Aspect.FEED, (Box(0, 0, 1080, 675), Box(0, 675, 1080, 675)), (960, 600)),
        (Aspect.SQUARE, (Box(0, 0, 540, 1080), Box(540, 0, 540, 1080)), (540, 1080)),
        (Aspect.LANDSCAPE, (Box(0, 0, 960, 1080), Box(960, 0, 960, 1080)), (960, 1080)),
    ],
)
def test_split_stacks_on_9_16_and_4_5_and_sets_its_panels_side_by_side_on_1_1_and_16_9(aspect, panels, crop):
    plan = plan_render(100, 105, WIDE, faces=PAIR, layout=Layout.SPLIT, canvas=canvas_for(aspect))
    [scene] = plan.scenes
    first, second = scene.panels
    assert (first.area, second.area) == panels
    # Each crop has its panel's shape.
    assert (first.crop_width, first.crop_height) == (second.crop_width, second.crop_height) == crop
    # The left face is in the top or the left panel.
    assert first.path[0].x + crop[0] / 2 == pytest.approx(700, abs=2)
    assert second.path[0].x + crop[0] / 2 == pytest.approx(1220, abs=2)


def test_the_face_rises_above_the_middle_only_of_a_stacked_panel():
    # A 4:3 Source leaves Split's crops room to move up and down on 16:9 as well as on 4:5.
    four_three = SourceMetadata(duration=3600, fps=25, width=1440, height=1080, codec="h264")
    pair = [FrameFaces(round(k * 0.12, 3), [Face(210, 450, 300, 300, 0.95), Face(930, 450, 300, 300, 0.9)]) for k in range(40)]
    stacked = plan_render(100, 105, four_three, faces=pair, layout=Layout.SPLIT, canvas=canvas_for(Aspect.FEED)).scenes[0].panels[0]
    beside = plan_render(100, 105, four_three, faces=pair, layout=Layout.SPLIT, canvas=canvas_for(Aspect.LANDSCAPE)).scenes[0].panels[0]
    # Stacked, the face's centre is at 40% of the crop; side by side, in its middle.
    assert stacked.path[0].y + 0.4 * stacked.crop_height == pytest.approx(600, abs=2)
    assert beside.path[0].y + 0.5 * beside.crop_height == pytest.approx(600, abs=2)


@pytest.mark.parametrize("aspect", [Aspect.PORTRAIT, Aspect.LANDSCAPE])
def test_split_with_fewer_than_two_faces_shows_the_sources_halves_in_the_same_panels(aspect):
    canvas = canvas_for(aspect)
    [scene] = plan_render(100, 105, WIDE, faces=GLIDE, layout=Layout.SPLIT, canvas=canvas).scenes
    first, second = scene.panels
    assert (first.area, second.area) == canvas.split_panels
    assert first.path[0].x + first.crop_width / 2 == 480 and second.path[0].x + second.crop_width / 2 == 1440


def test_track_on_a_canvas_wider_than_the_source_crops_its_full_width_at_the_canvass_shape():
    four_three = SourceMetadata(duration=3600, fps=25, width=1440, height=1080, codec="h264")
    [scene] = plan_render(100, 105, four_three, layout=Layout.TRACK, canvas=canvas_for(Aspect.LANDSCAPE)).scenes
    [panel] = scene.panels
    # The Source's whole width and as much of its height as keeps 16:9, from its middle: never stretched.
    assert (panel.crop_width, panel.crop_height, panel.area) == (1440, 810, Box(0, 0, 1920, 1080))
    assert [(point.x, point.y) for point in panel.path] == [(0, 136)]


def test_a_media_segment_without_a_framing_is_fitted_at_the_canvass_centre():
    canvas = canvas_for(Aspect.LANDSCAPE)
    video = SegmentInput(0, 2, media="ab" * 16, width=1280, height=720)
    plan = plan_render(10, 12, WIDE, main_track=[SegmentInput(10, 12), video], canvas=canvas)
    picture = plan.scenes[1].picture
    assert picture.centre == (960, 540) and (picture.width, picture.height) == (1920, 1080)


TALL = SourceMetadata(duration=3600, fps=25, width=1080, height=1920, codec="h264")


@pytest.mark.parametrize("aspect", [Aspect.FEED, Aspect.SQUARE, Aspect.LANDSCAPE])
def test_a_portrait_source_on_a_wider_canvas_is_shown_over_its_blur(aspect):
    canvas = canvas_for(aspect)
    [scene] = plan_render(100, 105, TALL, canvas=canvas).scenes
    assert scene.layout is SceneLayout.BLUR
    background, shot = scene.panels
    # The blur fills the Canvas with a crop of its shape; the Source is whole, as tall as the Canvas.
    assert background.blur and background.area == Box(0, 0, *canvas.size)
    assert background.crop_width / background.crop_height == pytest.approx(canvas.width / canvas.height, abs=0.01)
    assert (shot.crop_width, shot.crop_height, shot.area.height) == (1080, 1920, canvas.height)
    assert shot.area.x + shot.area.width / 2 == canvas.width / 2


def test_a_portrait_source_is_still_passed_through_on_9_16_and_on_a_canvas_its_own_shape():
    [scene] = plan_render(100, 105, TALL).scenes
    assert scene.layout is SceneLayout.PASSTHROUGH and scene.panels[0].area == Box(0, 0, 1080, 1920)
    feed = SourceMetadata(duration=3600, fps=25, width=1080, height=1350, codec="h264")
    assert plan_render(100, 105, feed, canvas=canvas_for(Aspect.FEED)).scenes[0].layout is SceneLayout.PASSTHROUGH


@pytest.mark.parametrize("aspect", [Aspect.PORTRAIT, Aspect.FEED])
def test_captions_on_auto_sit_on_the_seam_of_a_stacked_split(aspect):
    canvas = canvas_for(aspect)
    plan = plan_render(100, 105, WIDE, faces=PAIR, layout=Layout.SPLIT, words=WORDS, canvas=canvas)
    [cue] = plan.captions
    assert cue.area == canvas.seam_captions and cue.area.y + cue.area.height / 2 == canvas.height / 2


@pytest.mark.parametrize("aspect", [Aspect.SQUARE, Aspect.LANDSCAPE])
def test_captions_on_auto_sit_in_the_lower_third_of_a_side_by_side_split(aspect):
    canvas = canvas_for(aspect)
    [cue] = plan_render(100, 105, WIDE, faces=PAIR, layout=Layout.SPLIT, words=WORDS, canvas=canvas).captions
    assert cue.area == canvas.lower_captions


def test_captions_on_auto_sit_under_blurs_band_where_there_is_room_and_in_the_lower_third_where_not():
    feed = plan_render(100, 105, WIDE, layout=Layout.BLUR, words=WORDS, canvas=canvas_for(Aspect.FEED))
    band = feed.scenes[0].panels[-1].area
    [cue] = feed.captions
    assert cue.area.y >= band.y + band.height
    # On 9:16 that is today's lower third, under the band.
    [cue] = plan_render(100, 105, WIDE, layout=Layout.BLUR, words=WORDS).captions
    assert cue.area == PORTRAIT.lower_captions == Box(130, 1296, 820, 200)
    # On 1:1 the band leaves too little room below it in the Safe Area.
    square = canvas_for(Aspect.SQUARE)
    [cue] = plan_render(100, 105, WIDE, layout=Layout.BLUR, words=WORDS, canvas=square).captions
    assert cue.area == square.lower_captions


@pytest.mark.parametrize("aspect", list(Aspect))
@pytest.mark.parametrize("layout", [Layout.TRACK, Layout.SPLIT, Layout.BLUR])
@pytest.mark.parametrize("source", [WIDE, TALL])
def test_captions_on_auto_stay_inside_the_safe_area(aspect, layout, source):
    canvas = canvas_for(aspect)
    safe = canvas.safe_area
    [cue] = plan_render(100, 105, source, faces=PAIR, layout=layout, words=WORDS, canvas=canvas).captions
    assert safe.y <= cue.area.y and cue.area.y + cue.area.height <= safe.y + safe.height
    assert safe.x <= cue.area.x and cue.area.x + cue.area.width <= safe.x + safe.width


# Styles in the Reference Space, placed in each Safe Area (canvas-aspect/07).
LANDSCAPE = canvas_for(Aspect.LANDSCAPE)


def inside(box: Box, area: Box) -> bool:
    return area.x <= box.x and box.x + box.width <= area.x + area.width and area.y <= box.y and box.y + box.height <= area.y + area.height


def test_a_custom_caption_place_is_mapped_from_the_reference_space():
    style = CaptionStyle(position=CaptionPosition.CUSTOM, x=270, y=1280)
    [cue] = plan_render(100, 105, WIDE, words=WORDS, caption_style=style, canvas=LANDSCAPE).captions
    # (270, 1280) of 1080x1920 is (480, 720) of 1920x1080; its font size isn't mapped.
    assert (cue.area.x + cue.area.width / 2, cue.area.y + cue.area.height / 2) == (480, 720)
    assert cue.size == style.size
    [cue] = plan_render(100, 105, WIDE, words=WORDS, caption_style=style).captions
    assert (cue.area.x + cue.area.width / 2, cue.area.y + cue.area.height / 2) == (270, 1280)


def test_a_cue_edits_place_is_the_candidates_own_on_its_canvas():
    edit = CueEdit(at=100.4, x=1500, y=300)
    style = CaptionStyle(position=CaptionPosition.CUSTOM, x=270, y=1440)
    [cue] = plan_render(100, 105, WIDE, words=WORDS, caption_style=style, cue_edits=[edit], canvas=LANDSCAPE).captions
    assert (cue.area.x + cue.area.width / 2, cue.area.y + cue.area.height / 2) == (1500, 300)


def test_a_custom_watermark_place_is_mapped_from_the_reference_space_and_keeps_its_size():
    style = WatermarkStyle(kind=WatermarkKind.LOGO, logo="ab" * 8, position=WatermarkPosition.CUSTOM, x=270, y=480, size=100)
    area = plan_render(100, 105, WIDE, watermark_style=style, logo_size=(200, 100), canvas=LANDSCAPE).watermark.area
    assert area == Box(480 - 100, 270 - 50, 200, 100)


def test_a_custom_hook_place_is_mapped_from_the_reference_space():
    style = HookStyle(position=HookPosition.CUSTOM, x=270, y=960)
    hook = plan_render(100, 105, WIDE, hook="Halo semua", hook_style=style, canvas=LANDSCAPE).hook
    assert (hook.area.x + hook.area.width // 2, hook.area.y) == pytest.approx((480, 540), abs=1)


@pytest.mark.parametrize("aspect", list(Aspect))
def test_the_hook_at_the_top_is_inside_the_safe_area(aspect):
    canvas = canvas_for(aspect)
    hook = plan_render(100, 105, WIDE, hook="Setetes racun bisa bunuh perusahaan kamu sendiri", canvas=canvas).hook
    assert hook.area.y == canvas.safe_area.y and inside(hook.area, canvas.safe_area)


@pytest.mark.parametrize("aspect", list(Aspect))
@pytest.mark.parametrize("position", [position for position in WatermarkPosition if position is not WatermarkPosition.CUSTOM])
def test_the_watermarks_nine_places_are_inside_each_safe_area(aspect, position):
    canvas = canvas_for(aspect)
    style = WatermarkStyle(kind=WatermarkKind.TEXT, text="@podcast", position=position)
    assert inside(plan_render(100, 105, WIDE, watermark_style=style, canvas=canvas).watermark.area, canvas.safe_area)


def test_captions_and_the_hook_are_no_wider_on_16_9_than_on_9_16():
    assert (LANDSCAPE.caption_width, hook_width(LANDSCAPE)) == (PORTRAIT.caption_width, hook_width(PORTRAIT)) == (820, 748)
    # Centred in the frame.
    assert LANDSCAPE.lower_captions == Box(550, 786, 820, 200)
    long = "Racun kecil yang dibiarkan lama-lama pasti mematikan perusahaan kamu sendiri"
    wide, tall = (plan_render(100, 105, WIDE, hook=long, canvas=canvas).hook for canvas in (LANDSCAPE, PORTRAIT))
    assert (wide.lines, wide.size, wide.area.width) == (tall.lines, tall.size, tall.area.width)
    assert wide.area.x + wide.area.width // 2 == 960
