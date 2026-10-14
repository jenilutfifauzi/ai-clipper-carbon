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

**Status:** done

- [x] Default styles give v1 plans and the v1 ASS fixture byte for byte. Existing tests pass unchanged.
- [x] Seam B tests: 3- and 4-line fits are balanced; `strips` boxes fit each line; `left` alignment; `area` encloses all boxes.
- [x] Renderer tests: strip boxes; `none` with outline and shadow.
- [x] Shape cards are native radios, keyboard-operable, with a visible focus ring. Override markers work on every new field.
- [x] Browser check: each Shape × alignment, previewed and rendered, agree.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_planner.py tests/test_styles.py`: 87 passed (6 new Seam B and 3 renderer tests); the v1 ASS fixture is unchanged. `npm run typecheck` and `npm run build` pass.

**Change from the plan:** `HookEvent.lines` stays a list of strings, so the Timeline and v1's tests are untouched. The plan instead gains `anchors` (each line's middle and baseline) and `boxes` (what is drawn behind). Emphasis (ticket 02) will add its own field rather than turn lines into runs.

Built:
- **HookStyle:** `shape`, `max_lines`, `uppercase`, `align`, `outline` and `shadow` with their colours.
- **Planner:** `fit_hook` takes the fewest lines up to `max_lines` that fit, balanced by a minimax split over the words (`_balanced`). `_hook` lays out blocks (v1's padding and leading) and strips (`STRIP_PAD_X` 0.25, `STRIP_PAD_Y` 0.14, `STRIP_GAP` 0.06 sizes), left or centred.
- **Renderer:** a box per entry of `boxes` (`\bord0\shad0` on boxes only when the text has an outline or shadow, so v1's bytes stay); lines at their anchors; the Hook Style line carries the outline and shadow.
- **Preview:** the same boxes and anchors, with outline and shadow drawn like the captions'.
- **Style panel:** `HookShapePicker` (radio cards with thumbnails in the style's colours and alignment), then the Text, Box/outline/shadow, Position and Animation groups. Box controls are hidden for No box. `Segmented` gained a `marker` slot, so lines, alignment and position show their reset button.

**Checks:** Browser (1d5d363bec2e, scratch clone on :8010): Strips + Left previewed as left-aligned strips. libass frames of strips (white, black text, 4 lines) and No box with a shadow match references 2 and 5.
