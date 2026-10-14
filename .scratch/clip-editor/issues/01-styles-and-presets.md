# 01: Caption and Hook Styles, Style Presets

**Parent spec:** `spec.md` in this feature folder (user stories 9–17, 18, 27; "Styles").

**What to build:**
- `app/styles.py`:
  - `CaptionStyle` and `HookStyle`, whose defaults are today's constants;
  - `StylePreset`;
  - a `PresetStore` in `DATA_DIR/presets.json`, with built-in Presets in code;
  - `resolve_style(preset, overrides)`.
- **Candidate:** gains `preset_id` and `style_overrides`.
- **Planner:** takes the resolved styles for line breaking, caption position, case, and hook size and position.
- **Renderer:** writes the ASS styles from them, including the highlight box and the shadow.
- **API:** Preset CRUD, and `PATCH` of `preset_id` and `style_overrides`.

**Blocked by:** none.

**Status:** done

- [x] With the Default Preset and no overrides, every existing planner and render test passes unchanged, and the ASS script is byte-identical to v1.
- [x] Line breaking follows `max_chars`, `max_words`, `max_secs` and `pause_secs`. `uppercase: false` keeps the Words' case.
- [x] Caption position `auto` keeps v1 (Split's seam, otherwise the lower third). `top`, `middle`, `bottom` and `custom` place lines inside `SAFE_AREA`.
- [x] Hook position `top` keeps v1. `middle`, `bottom` and `custom` stay inside `SAFE_AREA`.
- [x] Highlight `colour` keeps v1. `box` draws an opaque box behind the active Word. `none` draws no highlight. A shadow draws an ASS shadow.
- [x] Presets:
  - `GET/POST /api/presets`, and `PUT/DELETE /api/presets/{id}`.
  - Built-in Presets are listed first, and `PUT` or `DELETE` on one gives 409.
  - Invalid styles give 422.
- [x] `PATCH` takes `preset_id` (404 for an unknown one) and `style_overrides` (validated by resolving them). A change marks the Candidate edited.
- [x] A Candidate whose Preset was deleted renders with Default.
- [x] A render uses the resolved style. Seam A: the plan file holds it.

## Comments

**2026-10-14: done.** `make test`: 275 passed (about 175 s). Added 6 Seam B planner tests, 8 style/ASS tests (`tests/test_styles.py`), 2 API tests in `test_review.py` and 1 Seam A render test. `test_selection.py`'s exact Candidate dict gained the 2 new fields.

Built:
- **`app/fonts.py`:** the font registry, Montserrat ExtraBold only (ticket 02 adds the rest). `font_metrics(font_id)` reads any registered font.
- **`app/styles.py`:**
  - `CaptionStyle` and `HookStyle`, whose defaults are v1's constants;
  - `StylePreset`, `StyleOverrides` and `resolve`;
  - `PresetStore` (`DATA_DIR/presets.json`);
  - 4 built-in Presets: Default, Yellow pop, Box highlight, Minimal.
- **Planner:**
  - `plan_render(..., caption_style, hook_style)`; the plan keeps both styles.
  - Line breaking follows `max_chars`, `max_words`, `max_secs`, `pause_secs` and `uppercase`.
  - Caption positions: Auto keeps v1, Top is y 430–630 (below a two-line top hook), Middle is the seam, Bottom is the lower third, Custom is centred on `y` and kept in the safe area.
  - Hook positions: Top keeps v1, Middle, Bottom (ends at y 1536), Custom (box top at `y`, clamped).
  - `CaptionEvent.size`: the shrink moved from the renderer into the planner, so the preview can draw the same size.
- **Renderer:** writes the ASS from the plan's styles.
  - Highlight `box`: a rounded box in the active colour, drawn on layer 0 under the plain line and measured from the font's advance widths.
  - Highlight `none`: one event per line.
  - A box opacity of 0 draws no box.
- **API:**
  - `GET/POST /api/presets`, `PUT/DELETE /api/presets/{id}` (409 for built-in Presets);
  - `PATCH` takes `preset_id` (404 if unknown) and `style_overrides` (422 if they don't resolve). Either marks the Candidate edited.
  - Renders resolve the Candidate's style through `PresetStore.styles`, falling back to Default for a deleted Preset.

**Byte-identical check:** `tests/fixtures/v1_captions_and_hook.ass` was written by the renderer at commit 8d75884, before this change. It covers a Track and a Split Scene, a shrunk caption line and a shrunk two-line hook. The default styles reproduce it exactly.

Notes:
- **Fonts are gitignored.** `backend/assets/fonts/` is gitignored, and `scripts/download_assets.py` fetches the font. Ticket 02 adds the new fonts there.
- **Box highlight width.** The box is measured without kerning, like the hook. On a tightly kerned Word it can be a few pixels wider than the glyphs, which the padding hides.
