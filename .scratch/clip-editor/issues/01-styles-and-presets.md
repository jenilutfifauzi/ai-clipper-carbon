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

**Status:** ready-for-agent

- [ ] With the Default Preset and no overrides, every existing planner and render test passes unchanged, and the ASS script is byte-identical to v1.
- [ ] Line breaking follows `max_chars`, `max_words`, `max_secs` and `pause_secs`. `uppercase: false` keeps the Words' case.
- [ ] Caption position `auto` keeps v1 (Split's seam, otherwise the lower third). `top`, `middle`, `bottom` and `custom` place lines inside `SAFE_AREA`.
- [ ] Hook position `top` keeps v1. `middle`, `bottom` and `custom` stay inside `SAFE_AREA`.
- [ ] Highlight `colour` keeps v1. `box` draws an opaque box behind the active Word. `none` draws no highlight. A shadow draws an ASS shadow.
- [ ] Presets:
  - `GET/POST /api/presets`, and `PUT/DELETE /api/presets/{id}`.
  - Built-in Presets are listed first, and `PUT` or `DELETE` on one gives 409.
  - Invalid styles give 422.
- [ ] `PATCH` takes `preset_id` (404 for an unknown one) and `style_overrides` (validated by resolving them). A change marks the Candidate edited.
- [ ] A Candidate whose Preset was deleted renders with Default.
- [ ] A render uses the resolved style. Seam A: the plan file holds it.

## Comments
