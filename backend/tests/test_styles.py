"""Style Presets, Style Overrides, and how the Renderer writes a Render Plan's styles as ASS."""

import subprocess
from pathlib import Path

import pytest

from app.planner import Box, Face, FrameFaces, Scene, plan_render
from app.renderer import _ass
from app.styles import (
    BUILTIN_PRESETS,
    DEFAULT,
    BuiltinPreset,
    CaptionStyle,
    Highlight,
    HookStyle,
    InvalidStyle,
    PresetNotFound,
    PresetStore,
    StyleOverrides,
    resolve,
)
from app.transcript import Word
from app.video_source import SourceMetadata

FIXTURES = Path(__file__).parent / "fixtures"
SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
WORDS = [
    Word(text, i * 0.4, i * 0.4 + 0.35)
    for i, text in enumerate(
        "halo semua, apa kabar hari ini? terima kasih banyak ya temanteman_panjangsekalikatanya teman semuanya "
        "luar biasa sekali".split()
    )
]
HOOK = "Setetes racun bisa bunuh perusahaan kamu sekarang juga?"


def plan(**styles):
    # A Track Scene, then a Split one (two faces), so that captions sit in both places.
    faces = [
        FrameFaces(t / 2, [Face(400, 300, 200, 200, 0.9), Face(1300, 300, 200, 200, 0.9)] if t > 6 else [Face(900, 300, 200, 200, 0.9)])
        for t in range(20)
    ]
    return plan_render(100, 110, SOURCE, [Scene(0, 3), Scene(3, 10)], faces, words=WORDS, hook=HOOK, **styles)


def test_the_default_styles_write_v1s_ass_byte_for_byte():
    # The fixture was written by the renderer before styles existed (commit 8d75884).
    assert _ass(plan()) == (FIXTURES / "v1_captions_and_hook.ass").read_text()


def test_the_caption_style_sets_the_ass_style_and_highlight():
    ass = _ass(plan(caption_style=CaptionStyle(
        size=120, colour="#ffe600", active_colour="#00FF00", outline=3, outline_colour="#112233", shadow=4,
        shadow_colour="#445566",
    )))
    assert "Style: Caption,Montserrat ExtraBold,120,&H0000E6FF,&H0000E6FF,&H00332211,&H00665544,0,0,0,0,100,100,0,0,1,3,4,5,0,0,0,1" in ass
    assert "{\\c&H00FF00&}HALO{\\c&H00E6FF&} SEMUA APA" in ass


def test_a_box_highlight_draws_a_box_of_the_active_colour_behind_the_word_under_the_line():
    ass = _ass(plan(caption_style=CaptionStyle(highlight=Highlight.BOX, active_colour="#7C3AED")))
    lines = [line for line in ass.splitlines() if line.startswith("Dialogue:") and ",Caption," in line]
    boxes = [line for line in lines if line.startswith("Dialogue: 0,")]
    texts = [line for line in lines if line.startswith("Dialogue: 1,")]
    assert len(boxes) == len(texts) > 0
    # The box: drawn, in the active colour, without outline or shadow; the text over it plain.
    assert all("\\p1\\bord0\\shad0\\c&HED3A7C&" in line for line in boxes)
    assert all("\\c&" not in line for line in texts)
    # Each Word's box starts further right than the one before, within a line.
    first_line = [line for line in boxes if line.split(",")[1] < "0:00:01.20"]
    lefts = [float(line.split("\\pos(")[1].split(",")[0]) for line in first_line]
    assert lefts == sorted(lefts) and len(set(lefts)) == len(lefts) == 3


def test_no_highlight_shows_each_line_once_for_its_whole_time():
    with_highlight = _ass(plan())
    ass = _ass(plan(caption_style=CaptionStyle(highlight=Highlight.NONE)))
    captions = [line for line in ass.splitlines() if ",Caption," in line and line.startswith("Dialogue")]
    assert len(captions) == len(plan().captions)
    assert len(captions) < sum(",Caption," in line for line in with_highlight.splitlines())
    assert all("\\c&" not in line for line in captions)


def test_the_hook_style_sets_its_font_size_colours_box_and_radius():
    ass = _ass(plan(hook_style=HookStyle(size=70, colour="#000000", box_colour="#FFE600", box_opacity=1.0, radius=10)))
    assert "Style: Hook,Montserrat ExtraBold,70,&H00000000,&H00000000," in ass
    [box] = [line for line in ass.splitlines() if line.startswith("Dialogue: 1,") and ",Hook," in line]
    assert "\\c&H00E6FF&\\alpha&H00&" in box and box.split("}")[1].startswith("m 10 0 ")
    # No box at all when it is fully transparent.
    clear = _ass(plan(hook_style=HookStyle(box_opacity=0)))
    assert not [line for line in clear.splitlines() if line.startswith("Dialogue: 1,") and ",Hook," in line]


def test_overrides_replace_fields_of_the_presets_styles_and_are_validated():
    preset = BUILTIN_PRESETS[1]
    caption, hook = resolve(preset, StyleOverrides(caption={"size": 90, "uppercase": False}, hook={"position": "middle"}))
    assert (caption.size, caption.uppercase, caption.active_colour) == (90, False, preset.caption.active_colour)
    assert (hook.position, hook.box_colour) == ("middle", preset.hook.box_colour)
    assert resolve(DEFAULT, StyleOverrides()) == (CaptionStyle(), HookStyle())
    for overrides, message in (
        (StyleOverrides(caption={"size": 10}), "size"),
        (StyleOverrides(caption={"colour": "orange"}), "colour"),
        (StyleOverrides(caption={"font": "comic-sans"}), "comic-sans"),
        (StyleOverrides(hook={"glow": 3}), "glow"),
        (StyleOverrides(hook={"box_opacity": 2}), "box_opacity"),
    ):
        with pytest.raises(InvalidStyle, match=message):
            resolve(DEFAULT, overrides)


def test_the_owners_presets_are_kept_after_the_builtin_ones_which_cant_change(tmp_path):
    store = PresetStore(tmp_path / "presets.json")
    assert store.all() == BUILTIN_PRESETS
    made = store.create("Brand", CaptionStyle(active_colour="#00AAFF"), HookStyle(radius=0))
    assert PresetStore(tmp_path / "presets.json").all() == [*BUILTIN_PRESETS, made]
    changed = store.update(made.id, "Brand 2", CaptionStyle(size=100), HookStyle())
    assert (changed.id, changed.name, store.get(made.id)) == (made.id, "Brand 2", changed)
    # A Candidate's styles: its Preset's, or Default's once that is deleted.
    assert store.styles(made.id, StyleOverrides()) == (CaptionStyle(size=100), HookStyle())
    store.delete(made.id)
    assert store.styles(made.id, StyleOverrides(caption={"size": 80})) == (CaptionStyle(size=80), HookStyle())
    with pytest.raises(PresetNotFound):
        store.get(made.id)
    for builtin in BUILTIN_PRESETS:
        with pytest.raises(BuiltinPreset):
            store.update(builtin.id, "x", CaptionStyle(), HookStyle())
        with pytest.raises(BuiltinPreset):
            store.delete(builtin.id)


def test_every_builtin_presets_styles_are_valid():
    for preset in BUILTIN_PRESETS:
        assert resolve(preset, StyleOverrides()) == (preset.caption, preset.hook)
    assert isinstance(plan(caption_style=BUILTIN_PRESETS[2].caption).captions[0].area, Box)


def test_each_registered_font_is_the_file_libass_picks_for_its_family(settings, tmp_path):
    from app.config import FONTS_DIR
    from app.fonts import FONTS

    styles = [
        f"Style: {font.id},{font.family},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1"
        for font in FONTS.values()
    ]
    events = [f"Dialogue: 0,0:00:00.00,0:00:01.00,{font.id},,0,0,0,,HALO" for font in FONTS.values()]
    script = tmp_path / "fonts.ass"
    script.write_text("\n".join([
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 320", "PlayResY: 240", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        *styles, "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", *events,
    ]) + "\n")
    result = subprocess.run(
        [str(settings.ffmpeg_bin), "-hide_banner", "-nostdin", "-v", "debug", "-f", "lavfi", "-i", "color=black:s=320x240:d=0.1",
         "-vf", f"ass={script}:fontsdir={FONTS_DIR}", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    # libass says which file it set each family in; a family it hasn't got falls back to a system font.
    for font in FONTS.values():
        assert f"fontselect: ({font.family}, 400, 0) -> {font.file.stem}, 0," in result.stderr, font


def test_fonts_are_listed_with_their_measures_and_served(client):
    from app.fonts import FONTS

    fonts = client.get("/api/fonts").json()
    assert [font["id"] for font in fonts] == list(FONTS)
    montserrat = fonts[0]
    assert (montserrat["family"], montserrat["em"], montserrat["units"], montserrat["cap_height"]) == ("Montserrat ExtraBold", 1000, 1562, 700)
    response = client.get("/api/fonts/anton")
    assert response.status_code == 200 and response.headers["content-type"] == "font/ttf"
    assert response.content == FONTS["anton"].file.read_bytes()
    assert "max-age" in response.headers["cache-control"]
    assert client.get("/api/fonts/nope").status_code == 404
    assert client.get("/api/fonts/..%2Fconfig.py").status_code == 404


def test_another_fonts_metrics_set_the_caption_size_and_the_hook():
    from app.planner import font_metrics

    anton, montserrat = font_metrics("anton"), font_metrics()
    assert anton.width("HALO", 110) != montserrat.width("HALO", 110)
    caption = CaptionStyle(font="anton", size=130)
    [event] = plan_render(0, 2, SOURCE, words=[Word("W" * 18, 0.0, 0.5)], caption_style=caption).captions
    assert event.size < 130 and anton.width(event.text, event.size) + 2 * caption.outline <= event.area.width
    hook = plan_render(0, 5, SOURCE, hook=HOOK, hook_style=HookStyle(font="bebas-neue")).hook
    bebas = font_metrics("bebas-neue")
    assert 740 < max(bebas.width(line, hook.size) for line in hook.lines) <= 748
    assert hook.size != plan_render(0, 5, SOURCE, hook=HOOK).hook.size
