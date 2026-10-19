"""Style Presets, Style Overrides, and how the Renderer writes a Render Plan's styles as ASS."""

import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from pydantic import TypeAdapter

from app.planner import Box, Face, FrameFaces, Scene, plan_render
from app.renderer import _ass
from app.styles import (
    BUILTIN_PRESETS,
    DEFAULT,
    LINE_LIMITS,
    BuiltinPreset,
    CaptionStyle,
    DropShadow,
    Highlight,
    HookStyle,
    InvalidStyle,
    PresetNotFound,
    PresetStore,
    StyleOverrides,
    StylePreset,
    WatermarkStyle,
    hard_shadow,
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
    return plan_render(100, 110, SOURCE, [Scene(0, 3), Scene(3, 10)], faces, words=WORDS, **{"hook": HOOK, **styles})


def test_the_default_styles_write_v1s_ass_byte_for_byte():
    # The fixture was written by the renderer before styles existed (commit 8d75884).
    assert _ass(plan()) == (FIXTURES / "v1_captions_and_hook.ass").read_text()


def test_the_caption_style_sets_the_ass_style_and_highlight():
    ass = _ass(plan(caption_style=CaptionStyle(
        size=120, colour="#ffe600", active_colour="#00FF00", outline=3, outline_colour="#112233",
        shadow=hard_shadow(4, "#445566"),
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
    caption, hook, _ = resolve(preset, StyleOverrides(caption={"size": 90, "uppercase": False}, hook={"position": "middle"}))
    assert (caption.size, caption.uppercase, caption.active_colour) == (90, False, preset.caption.active_colour)
    assert (hook.position, hook.box_colour) == ("middle", preset.hook.box_colour)
    assert resolve(DEFAULT, StyleOverrides()) == (CaptionStyle(), HookStyle(), WatermarkStyle())
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
    assert store.styles(made.id, StyleOverrides()) == (CaptionStyle(size=100), HookStyle(), WatermarkStyle())
    store.delete(made.id)
    assert store.styles(made.id, StyleOverrides(caption={"size": 80})) == (CaptionStyle(size=80), HookStyle(), WatermarkStyle())
    with pytest.raises(PresetNotFound):
        store.get(made.id)
    for builtin in BUILTIN_PRESETS:
        with pytest.raises(BuiltinPreset):
            store.update(builtin.id, "x", CaptionStyle(), HookStyle())
        with pytest.raises(BuiltinPreset):
            store.delete(builtin.id)


def test_every_builtin_presets_styles_are_valid():
    for preset in BUILTIN_PRESETS:
        assert resolve(preset, StyleOverrides()) == (preset.caption, preset.hook, preset.watermark)
    assert isinstance(plan(caption_style=BUILTIN_PRESETS[2].caption).captions[0].area, Box)


# Hooks that a Preset's style sets on one line, on several with a Kicker, and smaller.
PRESET_HOOKS = {
    "short": ("Kenapa *gagal*?", ""),
    "kicked": ("Setetes racun bisa *bunuh perusahaan* kamu sekarang juga?", "TERBONGKAR!"),
    "long": (
        "Ini adalah hook yang sangat panjang sekali sehingga harus dipecah menjadi beberapa baris dan mungkin diperkecil ukurannya",
        "Wow",
    ),
}


def preset_plan_view(preset, hook: str) -> dict:
    """The captions and hook of `plan()` in the Preset's styles with the hook PRESET_HOOKS[hook], as
    JSON, and a digest of its ASS script (fixtures/builtin_preset_plans.json was written by this
    before tracking and line height)."""
    from hashlib import sha256

    from pydantic import TypeAdapter

    from app.planner import Box, CaptionWord, HookEvent

    text, kicker = PRESET_HOOKS[hook]
    planned = plan(caption_style=preset.caption, hook_style=preset.hook, hook=text, hook_kicker=kicker)
    # Each Cue as the caption line it was then.
    lines = [
        {"text": cue.text, "start": cue.start, "end": cue.end, "words": TypeAdapter(list[CaptionWord]).dump_python(cue.words, mode="json"),
         "area": TypeAdapter(Box).dump_python(cue.area, mode="json"), "size": cue.size}
        for cue in planned.captions
    ]
    return {
        "captions": lines,
        "hook": TypeAdapter(HookEvent | None).dump_python(planned.hook, mode="json"),
        "ass": sha256(_ass(planned).encode()).hexdigest(),
    }


@pytest.mark.parametrize("preset", BUILTIN_PRESETS, ids=[preset.id for preset in BUILTIN_PRESETS])
@pytest.mark.parametrize("hook", PRESET_HOOKS)
def test_every_builtin_preset_plans_and_writes_its_captions_and_hook_as_before_tracking_and_line_height(preset, hook):
    before = json.loads((FIXTURES / "builtin_preset_plans.json").read_text())
    assert preset_plan_view(preset, hook) == before[f"{preset.id}/{hook}"]


def test_each_registered_font_is_the_file_libass_picks_for_its_family(settings, tmp_path):
    from app.config import FONTS_DIR
    from app.fonts import Faces

    # The bundled ones, whatever an app made earlier imported.
    FONTS = {face.id: face for face in Faces().all()}
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
    # libass says which font it set each family in, by its PostScript name; a family it hasn't got falls
    # back to a system font.
    from fontTools.ttLib import TTFont

    for font in FONTS.values():
        postscript = TTFont(font.file, lazy=True)["name"].getDebugName(6)
        assert f"fontselect: ({font.family}, 400, 0) -> {postscript}, 0," in result.stderr, font


def test_fonts_are_listed_with_their_measures_and_served(client):
    from app.fonts import BUNDLED_IDS, font

    fonts = client.get("/api/fonts").json()
    assert [font["id"] for font in fonts] == BUNDLED_IDS
    by_id = {font["id"]: font for font in fonts}
    montserrat = by_id["montserrat-extrabold"]
    assert (montserrat["family"], montserrat["em"], montserrat["units"], montserrat["cap_height"]) == ("Montserrat ExtraBold", 1000, 1562, 700)
    assert (montserrat["typographic_family"], montserrat["weight"], montserrat["italic"]) == ("Montserrat", 800, False)
    response = client.get(by_id["anton"]["url"])
    assert response.status_code == 200 and response.headers["content-type"] == "font/ttf"
    assert response.content == font("anton").file.read_bytes()
    assert "max-age" in response.headers["cache-control"]
    assert client.get("/api/fonts/anton").headers["cache-control"] == "no-cache"
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


def hook_lines(**style) -> list[str]:
    script = _ass(plan(hook_style=HookStyle(**style)))
    return [line for line in script.splitlines() if line.startswith("Dialogue") and ",Hook," in line]


def test_fading_hooks_are_one_event_each_with_fad():
    lines = hook_lines(animation_in="fade", animation_out="fade", animation_ms=300)
    assert len(lines) == 3 and all("\\fad(300,300)" in line for line in lines)
    assert all("\\fad" not in line for line in hook_lines(animation_out="none"))


def test_a_popping_hook_grows_from_70_percent_and_shrinks_back_split_into_in_hold_and_out():
    lines = hook_lines(animation_in="pop", animation_out="pop", animation_ms=250)
    # Box and two lines, in each of the three parts; the second line comes on 80 ms after the first
    # (hook-styles ticket 05).
    assert len(lines) == 9
    starts = sorted({line.split(",")[1] for line in lines})
    assert starts == ["0:00:00.00", "0:00:00.08", "0:00:00.25", "0:00:00.33", "0:00:02.75"]
    box_in, *_ = [line for line in lines if line.startswith("Dialogue: 1,0:00:00.00")]
    # The popping box is placed by its centre, so that it grows from there, and fades in to its own alpha.
    assert "\\an5\\pos(539.5,304.5)" in box_in
    assert "\\fscx70\\fscy70\\alpha&HFF&\\t(\\fscx100\\fscy100\\alpha&H66&)" in box_in
    line_out = [line for line in lines if line.startswith("Dialogue: 2,0:00:02.75")][0]
    assert "\\t(\\fscx70\\fscy70\\alpha&HFF&)" in line_out
    holds = [line for line in lines if line.split(",")[1] == "0:00:00.25"]
    assert holds and all("\\t(" not in line and "\\fad" not in line for line in holds)


def test_a_sliding_hook_comes_up_from_60_px_below_and_fades_out_with_fad():
    lines = hook_lines(animation_in="slide", animation_out="fade", animation_ms=400)
    box_in = [line for line in lines if line.startswith("Dialogue: 1,0:00:00.00")][0]
    assert "\\an7\\move(130,292,130,232)" in box_in and "\\alpha&HFF&\\t(\\alpha&H66&)" in box_in
    line_in = [line for line in lines if line.startswith("Dialogue: 2,0:00:00.00")][0]
    assert "\\move(539.5,333.3,539.5,273.3)" in line_in
    out = [line for line in lines if line.startswith("Dialogue: 2,0:00:02.60")]
    assert out and all("\\fad(0,400)" in line for line in out)


def test_the_hooks_animations_take_at_most_half_its_time():
    plan_ = plan_render(100, 110, SOURCE, words=WORDS, hook=HOOK, hook_secs=0.6,
                        hook_style=HookStyle(animation_in="pop", animation_out="slide", animation_ms=1000))
    lines = [line for line in _ass(plan_).splitlines() if ",Hook," in line and line.startswith("Dialogue")]
    assert sorted({line.split(",")[1] for line in lines}) == ["0:00:00.00", "0:00:00.30"]


# Hook Shapes (hook-styles ticket 01).


def hook_boxes(lines: list[str]) -> list[str]:
    return [line for line in lines if line.startswith("Dialogue: 1,")]


def test_strips_draw_a_box_behind_each_line_and_each_line_on_its_anchor():
    hook = plan(hook_style=HookStyle(shape="strips", align="left", box_opacity=1.0)).hook
    lines = hook_lines(shape="strips", align="left", box_opacity=1.0)
    boxes = hook_boxes(lines)
    assert len(boxes) == len(hook.boxes) == 2
    for box, drawn in zip(hook.boxes, boxes):
        assert f"\\an7\\pos({box.x},{box.y})" in drawn
        assert drawn.split("}")[1].startswith(f"m {min(24, box.height // 2)} 0 l {box.width - min(24, box.height // 2)} 0 ")
    texts = [line for line in lines if line.startswith("Dialogue: 2,")]
    assert [text.split("}")[1] for text in texts] == hook.lines
    for (x, _), text in zip(hook.anchors, texts):
        assert f"\\an5\\pos({x:g}," in text


def test_a_hook_without_a_box_draws_only_its_text_with_its_outline_and_shadow():
    lines = hook_lines(shape="none", outline=4, outline_colour="#112233", shadow=hard_shadow(3, "#445566"))
    assert not hook_boxes(lines) and len(lines) == 2
    ass = _ass(plan(hook_style=HookStyle(shape="none", outline=4, outline_colour="#112233", shadow=hard_shadow(3, "#445566"))))
    assert "Style: Hook,Montserrat ExtraBold,88,&H00FFFFFF,&H00FFFFFF,&H00332211,&H00665544,0,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1" in ass


def test_an_outlined_hooks_box_has_no_outline_or_shadow_of_its_own():
    [box] = hook_boxes(hook_lines(outline=4, shadow=hard_shadow(3)))
    assert "\\p1\\bord0\\shad0\\c&H000000&" in box


# Emphasis (hook-styles ticket 02).


def test_emphasised_runs_switch_to_the_emphasis_colour_and_back():
    hook = plan_render(0, 5, SOURCE, hook="Ini *pasti iri!* ya", hook_style=HookStyle(colour="#000000", emphasis_colour="#E11D2E"))
    texts = [line.split("}", 1)[1] for line in _ass(hook).splitlines() if line.startswith("Dialogue: 2,") and ",Hook," in line]
    assert texts == ["Ini {\\c&H2E1DE1&}pasti iri!{\\c&H000000&} ya"]


# The Kicker (hook-styles ticket 03).


def test_a_kicker_is_a_pill_of_its_colour_with_its_text_over_it():
    planned = plan_render(0, 5, SOURCE, hook=HOOK, hook_kicker="Fakta", hook_style=HookStyle(
        kicker_colour="#112233", kicker_box_colour="#FFE600", outline=3,
    ))
    kicker = planned.hook.kicker
    lines = [line for line in _ass(planned).splitlines() if line.startswith("Dialogue") and ",Hook," in line]
    pill = [line for line in lines if "\\c&H00E6FF&" in line]
    assert len(pill) == 1 and pill[0].startswith("Dialogue: 1,")
    radius = kicker.box.height // 2
    assert f"\\an7\\pos({kicker.box.x},{kicker.box.y})" in pill[0] and "\\bord0\\shad0" in pill[0] and "\\alpha&H00&" in pill[0]
    assert pill[0].split("}")[1].startswith(f"m {radius} 0 l {kicker.box.width - radius} 0 ")
    [text] = [line for line in lines if line.endswith("}Fakta")]
    assert text.startswith("Dialogue: 2,") and f"\\fs{kicker.size:g}" in text and "\\c&H332211&" in text
    assert f"\\pos({kicker.anchor[0]:g}," in text and "\\bord0\\shad0" in text


# The Quote Mark (hook-styles ticket 04).


def test_a_quote_mark_is_a_badge_of_its_colour_with_white_quote_marks_over_the_box():
    planned = plan_render(0, 5, SOURCE, hook=HOOK, hook_style=HookStyle(quote=True, quote_colour="#22C55E"))
    badge = planned.hook.quote
    lines = [line for line in _ass(planned).splitlines() if line.startswith("Dialogue") and ",Hook," in line]
    [drawn] = [line for line in lines if "\\c&H5EC522&" in line]
    # Both by the badge's top-left corner, the marks' drawing being on the badge's own grid.
    corner = f"\\an7\\pos({badge.x},{badge.y})"
    assert drawn.startswith("Dialogue: 3,") and corner in drawn
    [marks] = [line for line in lines if line.startswith("Dialogue: 4,")]
    assert "\\c&HFFFFFF&" in marks and corner in marks
    # Popping, they grow together from that corner.
    popping = plan_render(0, 5, SOURCE, hook=HOOK, hook_style=HookStyle(quote=True, animation_in="pop"))
    grown = [line for line in _ass(popping).splitlines() if line.startswith(("Dialogue: 3,0:00:00.00", "Dialogue: 4,0:00:00.00"))]
    assert len(grown) == 2 and all(corner in line and "\\fscx70" in line for line in grown)
    # Two marks, each a round dot and its tail: four closed shapes.
    assert marks.split("}")[1].count("m ") == 4
    assert "Dialogue: 3," not in _ass(plan()) and "Dialogue: 4," not in _ass(plan())


# Staggered entrance (hook-styles ticket 05).


def hook_events(hook: str, kicker: str = "", secs: float = 3.0, **style) -> list[str]:
    planned = plan_render(0, 10, SOURCE, hook=hook, hook_kicker=kicker, hook_secs=secs, hook_style=HookStyle(**style))
    return [line for line in _ass(planned).splitlines() if line.startswith("Dialogue") and ",Hook," in line]


def starts(events: list[str], text: str) -> list[str]:
    return sorted({line.split(",")[1] for line in events if line.endswith(text)})


THREE = "Alhamdulillah modal AI aja bisa dapat komisi dari si oren"


def test_the_entrance_comes_kicker_first_then_line_by_line_80_ms_apart_and_leaves_together():
    for animation in ("fade", "pop", "slide"):
        events = hook_events(THREE, "Fakta", shape="strips", max_lines=4, animation_in=animation, animation_ms=200)
        lines = plan_render(0, 10, SOURCE, hook=THREE, hook_style=HookStyle(shape="strips", max_lines=4)).hook.lines
        assert len(lines) == 3
        firsts = [starts(events, "Fakta")[0]] + [starts(events, line)[0] for line in lines]
        assert firsts == ["0:00:00.00", "0:00:00.08", "0:00:00.16", "0:00:00.24"], animation
        # Each strip (the black boxes, not the yellow pill) comes on with its line.
        strips = sorted({line.split(",")[1] for line in events if line.startswith("Dialogue: 1,") and "\\c&H000000&" in line})
        assert strips[:3] == firsts[1:], animation
    # They all go off at once: one exit, at the same time for every element.
    events = hook_events(THREE, "Fakta", shape="strips", max_lines=4, animation_in="pop", animation_out="pop", animation_ms=200)
    exits = {line.split(",")[1] for line in events if "\\t(\\fscx70" in line}
    assert exits == {"0:00:02.80"}


def test_a_block_and_its_quote_mark_come_on_with_the_first_line():
    events = hook_events(HOOK, quote=True, animation_in="fade")
    assert {line.split(",")[1] for line in events if line.startswith(("Dialogue: 1,", "Dialogue: 3,", "Dialogue: 4,"))} == {"0:00:00.00"}
    assert starts(events, "juga?") == ["0:00:00.08"]


def test_without_an_entrance_or_with_one_element_nothing_is_staggered():
    assert {line.split(",")[1] for line in hook_events(HOOK, animation_in="none")} == {"0:00:00.00"}
    assert {line.split(",")[1] for line in hook_events("Kenapa?", animation_in="fade")} == {"0:00:00.00"}


def test_a_short_hook_staggers_less_so_that_everything_is_on_before_it_goes():
    events = hook_events(THREE, "Fakta", secs=0.6, shape="strips", max_lines=4, animation_in="pop", animation_out="pop", animation_ms=250)
    # 0.6 s: 0.25 on and 0.25 off leave 0.1 s for three steps.
    lines = plan_render(0, 10, SOURCE, hook=THREE, hook_style=HookStyle(shape="strips", max_lines=4)).hook.lines
    assert starts(events, lines[-1])[0] <= "0:00:00.10"
    # Every element has popped in by the time they all pop out, at 0.35 s.
    entrances = [line for line in events if "\\fscx70\\fscy70\\alpha&HFF&\\t(" in line]
    # The Kicker's pill and text, three strips and three lines.
    assert len(entrances) == 2 + 3 + 3 and all(line.split(",")[2] <= "0:00:00.35" for line in entrances)


# Shadow and box shape on the Hook and Caption Styles (text-advanced 14). At their defaults every
# built-in Preset plans and writes its ASS as before (above).


def dialogue(ass: str, style: str) -> list[str]:
    return [line for line in ass.splitlines() if line.startswith("Dialogue") and f",{style}," in line]


def pos(line: str) -> tuple[float, float]:
    x, y = line.split("\\pos(")[1].split(")")[0].split(",")
    return float(x), float(y)


def test_the_old_shadow_fields_are_read_as_a_hard_drop_shadow(tmp_path):
    # A Preset saved before drop shadows: a shadow (an offset right and down) and its colour.
    saved = json.loads(TypeAdapter(list[StylePreset]).dump_json([StylePreset("mine", "Mine")]))
    for part, offset in (("caption", 4), ("hook", 0)):
        del saved[0][part]["shadow"]
        saved[0][part] |= {"shadow": offset, "shadow_colour": "#445566"}
    (tmp_path / "presets.json").write_text(json.dumps(saved))
    store = PresetStore(tmp_path / "presets.json")
    mine = store.get("mine")
    assert mine.caption.shadow == hard_shadow(4, "#445566") == DropShadow("#445566", 1.0, 0.0, 4 * 2**0.5, 45.0)
    assert mine.caption.shadow.offset == (4.0, 4.0)
    # None was none: off, its colour kept.
    assert not mine.hook.shadow.on and mine.hook.shadow == DropShadow(colour="#445566")
    # Written back in today's shape.
    store.update("mine", "Mine", mine.caption, mine.hook)
    assert json.loads((tmp_path / "presets.json").read_text())[0]["caption"]["shadow"]["colour"] == "#445566"
    # Overrides saved before them change those fields of the Preset's shadow.
    minimal = next(preset for preset in BUILTIN_PRESETS if preset.id == "minimal")
    overrides = TypeAdapter(StyleOverrides).validate_python({"caption": {"shadow": 0}, "hook": {"shadow": 3, "shadow_colour": "#FF0000"}})
    assert overrides.hook == {"shadow": {"opacity": 1.0, "blur": 0.0, "distance": 3 * 2**0.5, "angle": 45.0, "colour": "#FF0000"}}
    caption, hook, _ = resolve(minimal, overrides)
    assert not caption.shadow.on and hook.shadow == hard_shadow(3, "#FF0000")
    assert resolve(minimal, StyleOverrides(caption={"shadow_colour": "#112233"})).caption.shadow == hard_shadow(4, "#112233")
    # As are a Clip's styles, rendered before them.
    assert TypeAdapter(CaptionStyle).validate_python({"shadow": 2, "shadow_colour": "#00FF00"}).shadow == hard_shadow(2, "#00FF00")


def test_a_migrated_shadow_is_written_as_before():
    # The Style line test_the_caption_style_sets_the_ass_style_and_highlight checks, from the old fields.
    old = TypeAdapter(CaptionStyle).validate_python({
        "size": 120, "colour": "#ffe600", "outline": 3, "outline_colour": "#112233", "shadow": 4, "shadow_colour": "#445566",
    })
    ass = _ass(plan(caption_style=old))
    assert "Style: Caption,Montserrat ExtraBold,120,&H0000E6FF,&H0000E6FF,&H00332211,&H00665544,0,0,0,0,100,100,0,0,1,3,4,5,0,0,0,1" in ass
    # No events of its own.
    assert len(dialogue(ass, "Caption")) == len(dialogue(_ass(plan(caption_style=CaptionStyle(size=120))), "Caption"))


def test_a_shadow_override_changes_only_the_shadows_fields_it_names():
    minimal = next(preset for preset in BUILTIN_PRESETS if preset.id == "minimal")
    caption, _, _ = resolve(minimal, StyleOverrides(caption={"shadow": {"blur": 6, "angle": 90}}))
    assert caption.shadow == DropShadow("#000000", 1.0, 6.0, minimal.caption.shadow.distance, 90.0)
    for overrides, message in (
        (StyleOverrides(hook={"shadow": {"blur": 500}}), "blur"),
        (StyleOverrides(hook={"shadow": {"glow": 1}}), "shadow.glow"),
        (StyleOverrides(caption={"size": {"blur": 1}}), "size"),
        (StyleOverrides(caption={"padding_x": -1}), "padding_x"),
        (StyleOverrides(hook={"padding_y": 500}), "padding_y"),
    ):
        with pytest.raises(InvalidStyle, match=message):
            resolve(DEFAULT, overrides)


def test_a_semi_transparent_hard_shadow_is_the_styles_own_shadow_at_its_opacity():
    shadow = DropShadow("#445566", 0.5, 0.0, 6 * 2**0.5, 45.0)
    ass = _ass(plan(hook_style=HookStyle(shape="none", shadow=shadow), caption_style=CaptionStyle(shadow=shadow)))
    for style in ("Caption", "Hook"):
        [line] = [line for line in ass.splitlines() if line.startswith(f"Style: {style},")]
        fields = line.split(",")
        assert (fields[6], fields[17]) == ("&H80665544", "6"), style
    assert len(dialogue(ass, "Hook")) == 2


SOFT = DropShadow("#0000FF", 0.5, 8.0, 10.0, 45.0)


def test_a_blurred_or_turned_shadow_is_an_event_under_each_hook_line():
    for shadow in (SOFT, DropShadow("#0000FF", 0.5, 0.0, 10.0, 135.0)):
        planned = plan(hook_style=HookStyle(shadow=shadow))
        ass = _ass(planned)
        [style] = [line for line in ass.splitlines() if line.startswith("Style: Hook,")]
        assert style.split(",")[17] == "0"
        events = dialogue(ass, "Hook")
        shadows = [line for line in events if "\\1c&HFF0000&" in line]
        lines = [line for line in events if line.startswith("Dialogue: 2,") and line not in shadows]
        assert len(lines) == len(shadows) == len(planned.hook.lines) == 2
        dx, dy = shadow.offset
        for line, under in zip(lines, shadows):
            # Under its line on the same layer, written before it: the line again, in one colour.
            assert under.startswith("Dialogue: 2,") and events.index(under) < events.index(line)
            assert under.split("}", 1)[1] == line.split("}", 1)[1]
            (x, y), (shadow_x, shadow_y) = pos(line), pos(under)
            assert (shadow_x - x, shadow_y - y) == (pytest.approx(dx, abs=0.06), pytest.approx(dy, abs=0.06))
            assert "\\1a&H80&\\bord0\\shad0" in under and ("\\blur" in under) == bool(shadow.blur)
        # Over the box.
        assert all(events.index(box) < events.index(shadows[0]) for box in hook_boxes(events))


def test_a_blurred_shadow_is_an_event_under_each_caption_line_in_every_highlight():
    for highlight, layer in ((Highlight.COLOUR, 0), (Highlight.BOX, 1), (Highlight.NONE, 0)):
        ass = _ass(plan(caption_style=CaptionStyle(highlight=highlight, shadow=SOFT, outline=4)))
        events = dialogue(ass, "Caption")
        shadows = [line for line in events if "\\blur" in line]
        texts = [line for line in events if "\\blur" not in line and "\\p1" not in line]
        assert len(shadows) == len(texts) > 0, highlight
        for under, text in zip(shadows, texts):
            # The same times and layer, just before it; stroked, so only its stroke shows, over the letters too.
            assert under.split(",")[:3] == text.split(",")[:3] and text.startswith(f"Dialogue: {layer},")
            assert events.index(under) == events.index(text) - 1
            assert "\\1a&HFF&\\3c&HFF0000&\\3a&H80&\\bord4" in under and "\\c&" not in under.split("}", 1)[1]
            assert pos(under)[0] - pos(text)[0] == pytest.approx(SOFT.offset[0], abs=0.06)


def test_a_popping_hooks_shadow_fades_in_with_its_line_its_letters_hidden_under_a_stroke():
    shadow = DropShadow(opacity=0.5, blur=6, distance=8)
    events = hook_events("Kenapa?", shape="none", outline=4, shadow=shadow, animation_in="pop", animation_out="slide")
    [shadow_in] = [line for line in events if line.startswith("Dialogue: 2,0:00:00.00") and "\\blur" in line]
    assert shadow_in.index("\\1a&HFF&") < shadow_in.index("\\3a&HFF&\\t(\\fscx100\\fscy100\\3a&H80&)")
    [shadow_out] = [line for line in events if line.startswith("Dialogue: 2,0:00:02.80") and "\\blur" in line]
    assert "\\t(\\3a&HFF&)" in shadow_out and "\\alpha" not in shadow_out
    # Without a stroke, its letters are what shows.
    plain = hook_events("Kenapa?", shape="none", shadow=shadow, animation_in="pop")
    [shadow_in] = [line for line in plain if line.startswith("Dialogue: 2,0:00:00.00") and "\\blur" in line]
    assert "\\1a&HFF&\\t(\\fscx100\\fscy100\\1a&H80&)" in shadow_in


def test_the_highlight_boxs_padding_and_radius_are_the_caption_styles():
    def boxes(style: CaptionStyle) -> list[tuple[float, float, list[str]]]:
        drawn = [line for line in dialogue(_ass(plan(caption_style=style)), "Caption") if "\\p1" in line]
        return [(*pos(line), line.split("}")[1].split()) for line in drawn]

    style = CaptionStyle(highlight=Highlight.BOX)
    default = boxes(style)
    padded = boxes(replace(style, padding_x=30, padding_y=20, radius=0))
    # Each box's line's size: a line too wide is set smaller, and so is the padding given at the style's.
    sizes = [event.size for event in plan(caption_style=style).captions for word in event.words if round(word.start * 100) < round(word.end * 100)]
    assert len(default) == len(padded) == len(sizes) and min(sizes) < style.size
    for (x, y, path), (padded_x, padded_y, padded_path), size in zip(default, padded, sizes):
        across, down = 30 * size / style.size, 20 * size / style.size
        assert padded_x == pytest.approx(x - (across - 0.12 * size), abs=0.1)
        assert padded_y == pytest.approx(y - (down - 0.08 * size), abs=0.1)
        # "m r 0 l (width - r) 0 ...": square corners, and wider by the padding.
        radius = round(0.12 * size)
        assert padded_path[1] == "0" and path[1] == str(radius)
        assert float(padded_path[4]) - (float(path[4]) + radius) == pytest.approx(2 * (across - 0.12 * size), abs=1)


def test_phrase_and_sentence_are_the_shared_line_limits_and_phrase_is_the_default():
    # The frontend's editor/lineLimits.ts is checked against the same file (lineLimits.test.ts).
    assert LINE_LIMITS == json.loads((FIXTURES / "line_limits.json").read_text())
    default = CaptionStyle()
    assert {field: getattr(default, field) for field in LINE_LIMITS["phrase"]} == LINE_LIMITS["phrase"]
    for limits in LINE_LIMITS.values():
        TypeAdapter(CaptionStyle).validate_python(limits)


def test_the_mcp_instructions_name_phrase_and_sentence_from_the_line_limits():
    from app.mcp_server import INSTRUCTIONS

    flat = " ".join(INSTRUCTIONS.split())
    assert "The editor's Phrase is 1 line, 16 characters, no word limit, 1.4 s, 0.5 s pause;" in flat
    assert "its Sentence 2 lines, 24 characters, no word limit, 5 s, 0.7 s pause." in flat
