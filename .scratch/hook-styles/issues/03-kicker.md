# 03: Kicker

**Parent spec:** `spec.md` in this feature folder (user stories 9, 16, 17; "Kicker on the Candidate", "HookEvent", "Drawing").

**What to build:**
- **Candidate** gains `hook_kicker: str = ""`: at most 24 characters, whitespace collapsed. PATCH takes it and a change marks the Candidate edited. `preview-plan`'s draft takes it too.
- **HookStyle** gains `kicker_colour` (`#000000`) and `kicker_box_colour` (`#FFE600`).
- **Planner:** `HookEvent.kicker = (text, box, size)`:
  - its size is 0.55 × the hook's set size, on one line, shrunk if too wide;
  - it sits above the first line, aligned like the hook, with a 0.25 × size gap;
  - `area` grows to hold it, so positions keep the whole hook in the safe area;
  - emoji are stripped and `uppercase` applies.
- **Renderer:** a pill (radius = half its height) with its text.
- **Preview:** the same pill.
- **Staleness:** `RenderedClip.hook_kicker` is recorded and compared. Old `clips.json` files read it as `""`.
- **HookEditor:** a Kicker input above the hook, with a 24-character counter, saved like the hook text.
- **Style panel:** the Kicker colours go in the Box and decoration group.

**Blocked by:** 01.

**Status:** done

- [x] An empty Kicker gives v1's plan and ASS.
- [x] Seam B tests: Kicker placement for each position and alignment, inside the safe area.
- [x] Seam A tests: PATCH validation (25 characters refused); a draft Kicker in `preview-plan`; a render's plan file holds it; a changed Kicker marks the Clip changed.
- [x] Browser check: preview and render agree.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_review.py tests/test_selection.py tests/test_styles.py tests/test_planner.py`: 137 passed; the new Seam A test in `test_render.py` passes. `npm run typecheck` and `npm run build` pass.

**Changes from the plan:**
- The Kicker colours have their own "Kicker" group in the Style panel, after Box, outline and shadow, rather than sharing it: they are found by name.
- A Kicker with no hook text shows nothing, like the hook.

Built:
- **Candidate.hook_kicker** (""): PATCH `hook_kicker` (at most 24 characters as sent, saved with whitespace collapsed) marks the Candidate edited. The preview-plan draft takes it. `RenderedClip.hook_kicker` ("" for old `clips.json`) is compared in `changedSince`.
- **Planner:** `_kicker` sets the Kicker at `KICKER_SCALE` 0.55 of the hook's size, in a pill padded by `KICKER_PAD_X` 0.5 and `KICKER_PAD_Y` 0.28 of its own size, shrunk to the captions' width. It sits `KICKER_GAP` 0.25 hook sizes above the lines: centred over them, or from their left edge (the box's, or the text's for No box). `HookEvent.kicker` holds its text, size, pill and anchor; `area` holds it, so every position keeps it in the safe area.
- **Renderer:** the pill is an opaque rounded drawing (radius half its height) in `kicker_box_colour`. Its text is set at its size in `kicker_colour`, both without outline or shadow, animated with the hook.
- **Preview:** the same pill and text.
- **HookEditor:** a Kicker field with a counter over its right edge; saving as it is typed now uses one `useTypedText` hook for both fields.

**Checks:** Browser (scratch clone): typing "Terbongkar!" previewed a yellow pill above left-aligned strips, saved after the pause.
