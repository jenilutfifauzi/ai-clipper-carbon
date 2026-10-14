# 01: Hook Shapes, alignment, lines, and the hook section's new layout

**Parent spec:** `spec.md` in this feature folder (user stories 1–5, 14–16, 18; "HookStyle fields", "Line fitting", "HookEvent", "Drawing", "Style panel").

**What to build:**
- **HookStyle** gains `shape` (`block`, `strips`, `none`), `align` (`center`, `left`), `max_lines` (1–4), `uppercase`, `outline`, `outline_colour`, `shadow` and `shadow_colour`. All default to v1's look.
- **Planner:**
  - `fit_hook` picks the fewest balanced lines, up to `max_lines`, then shrinks the font as now.
  - `HookEvent` gains `line_boxes` (a strip per line, or the shared block). `lines` become lists of runs, all unemphasised here.
  - `left` aligns lines and strips to the widest line's left edge, with the hook still centred in the frame.
- **Renderer:** a box per line for `strips`, no box for `none`, and `\bord` / `\shad` with their colours on the text.
- **Preview:** `ClipPreview`'s `Hook` draws `line_boxes`, alignment, outline and shadow at the planned Boxes.
- **Style panel:** the hook section is restructured with the emil skills (`emil-component-design`, `emil-forms-and-inputs`, `emil-design-foundations`). Groups in order, under subheadings:
  1. **Shape:** three radio cards with SVG thumbnails in the current colours.
  2. **Text.**
  3. **Box and decoration.**
  4. **Position.**
  5. **Animation.**

  Controls that don't apply to the Shape are hidden but keep their values.

**Blocked by:** none.

**Status:** ready-for-agent

- [ ] Default styles give v1 plans and the v1 ASS fixture byte for byte. Existing tests pass unchanged.
- [ ] Seam B tests: 3- and 4-line fits are balanced; `strips` boxes fit each line; `left` alignment; `area` encloses all boxes.
- [ ] Renderer tests: strip boxes; `none` with outline and shadow.
- [ ] Shape cards are native radios, keyboard-operable, with a visible focus ring. Override markers work on every new field.
- [ ] Browser check: each Shape × alignment, previewed and rendered, agree.
