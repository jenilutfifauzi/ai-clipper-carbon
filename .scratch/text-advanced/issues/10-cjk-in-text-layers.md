# 10: CJK in Text Layers

**Parent spec:** `spec.md` (Solution "Emoji and CJK"; Implementation Decisions "Planner (layout)", "Rasteriser", "Faces"); docs/adr/0010-text-layers-are-rasterised-pictures.md (explicit fallback).

**What to build:** Japanese or Chinese words in a Text Layer show real glyphs, laid out correctly, the same on any host.

- `make setup` downloads one CJK Face (Noto Sans JP or SC, OFL, one weight). It is registered as a bundled fallback Face, not offered in the picker, and recorded in THIRD_PARTY_NOTICES.
- **The planner splits each line into runs by Face.** A character the style's Face lacks goes to the CJK Face if that Face has it; otherwise it is left out. Each run is measured with its own Face.
  - The line pitch stays the style's Face's.
  - Wrapping breaks between CJK characters as UAX #14 allows.
- **The rasteriser** sets each fallback run with an explicit `\fn`, so libass's own (system) fallback is never used.

**Blocked by:** 02.

**Status:** done

- [x] Planner: a line mixing Latin and Japanese has a run per Face, measured so that the line's width matches the rendered ink within a few px.
- [x] Planner: the line pitch is the same with and without a CJK run.
- [x] A rendered frame has ink where each CJK run is planned, and none of libass's missing-glyph boxes.
- [x] A character neither Face has is left out, and the layout closes up around it.

## Comments

**2026-10-17 (agent):** Built.
- **The Face:** Noto Sans SC Bold (Noto CJK release Sans2.004, its SubsetOTF, 8.5 MB, OFL), downloaded by `make setup` (`backend/scripts/download_assets.py`) with its licence as `OFL-notosanssc.txt`, and recorded in THIRD_PARTY_NOTICES. In `app/fonts.py` it is `FALLBACK_FONT` (`noto-sans-sc-bold`): `find`, `get`, `file` and `gather` know it, but `ids()` and `all()` leave it out, so no style can name it (FontId refuses it), the Faces API doesn't list it, and DELETE refuses it as bundled. Its hash is of its file as it is (writing its 30 000 glyphs out through fontTools, as the other bundled Faces are hashed, takes seconds). A missing bundled file now says "run make setup".
- **Planner** (`app/planner.py`):
  - `TextRun(text, font, x, width)`. `TextLayout.runs` holds each line's runs, placed from the picture's left edge; `TextLayout.faces` is the style's Face plus the runs' Faces, and its `name` hashes all their files.
  - `text_runs(line, font_id)` splits a line by Face, not yet placed: a character in the style's Face, else in `FALLBACK_FONT` (`_run_face`), else left out, with the whitespace collapsed as `without_emoji` does, so the line closes up. A space joins the run it follows.
  - `runs_width(runs, size, tracking)` measures a line, each run in its own Face. `placed_runs(runs, left, size, tracking)` places a line's runs one after another. A run's drawn text and width leave out its trailing space, because libass trims a line's end spaces before centring it.
  - `text_event` measures and places lines with those. The line pitch, the height and the anchors' baselines are still the style's Face's alone. `TextEvent.lines` and `layout.lines` are the closed-up lines.
- **Rasteriser** (`app/text_pictures.py`): one event per run, `\an5` at the run's planned middle. Each run is centred vertically by its own Face's ascent, so every run stands on the line's baseline. A fallback run carries `\fn<its family>`. The fonts dir is `gather(layout.faces)`. A line that is a single run is drawn exactly as before (centred on its anchor).
- **Tests** (`tests/test_cjk_text.py`): runs and their measures, the same pitch, left-out characters closing up, the Face not offered; the picture has ink where each run is planned and the line's ink spans its planned width. "日日" draws two alike halves and "日本" two different ones; without the `\fn`, libass's system fallback draws the Japanese at another size and both checks fail. A Seam A render has ink in each of 4 runs' boxes.

Decisions:
- **SC, not JP.** Noto Sans SC's subset holds the kana and the Japanese kanji I tried (働, 込, 畑), the traditional forms (對, 說, 話) and the simplified ones (们, 这, 说). Noto Sans JP lacks the simplified ones. So one Face covers Japanese and Chinese, with Chinese glyph shapes for the shared kanji. Hangul is in neither Face, so it is left out (Korean stays Out of Scope).
- **Size:** a fallback run is set at the same `\fs`. libass scales each Face so that its ascent plus descent equals the size, so the CJK em is about 0.69 of the size, and the planner measures it that way. This is how libass's own fallback set it before.
- **Wrapping** at UAX #14 opportunities between CJK characters is not done here: main has no wrapping yet (ticket 03). Ticket 03 should split lines into runs with `text_runs` first (leaving out what no Face has), then measure candidate lines with `runs_width`, and place each wrapped line with `placed_runs`. A proper UAX #14 breaker gives breaks between ideographs (class ID) for free. Breaks before closing (CL, e.g. 、。」) and after opening (OP, 「) punctuation stay forbidden.
- **For ticket 04 (tracking):** `runs_width` and `placed_runs` already take `tracking` (0 today). The rasteriser needs `\fsp` per run. It should check whether libass counts the spacing after a run's last glyph when it centres the run: the planner's drawn width doesn't.
- **For ticket 11 (emoji):** add an emoji kind of run (e.g. a `TextRun` kind field, or a pseudo-Face id). `text_runs` should first cut the line into clusters, keeping emoji sequences whole, and give an emoji cluster that kind instead of `_run_face`. `without_emoji` then leaves the Text Layer path. `runs_width` and `placed_runs` measure an emoji run at 1.0 em each, and the rasteriser skips it in the ASS and composites its image at `x`, `width`.
