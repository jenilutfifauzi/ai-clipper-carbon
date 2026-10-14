# 04: Quote Mark

**Parent spec:** `spec.md` in this feature folder (user stories 11, 16; "HookEvent", "Drawing").

**What to build:**
- **HookStyle** gains `quote` (`false`) and `quote_colour` (`#22C55E`).
- **Planner:** `HookEvent.quote` is the badge's Box: a square about 0.9 × the hook's size, centred on the top-left corner of the first line's box. With Shape `none` it uses the first line's text box. `area` grows to hold it.
- **Renderer:** a rounded square in `quote_colour` and two white quote marks, as ASS vector drawings (no font glyph, so every font looks the same).
- **Preview:** the same paths in SVG.
- **Style panel:** a toggle and colour in the Box and decoration group.

**Blocked by:** 01.

**Status:** done

- [x] `quote: false` gives v1's ASS.
- [x] Seam B test: badge placement for `block`, `strips` and `none`, in both alignments, inside the safe area.
- [x] Renderer test: the badge drawing.
- [x] Browser check: preview and render agree; the badge doesn't cover the first word.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_planner.py tests/test_styles.py`: all pass (2 new Seam B tests, 1 renderer test). `npm run typecheck` and `npm run build` pass.

**Changes from the plan:**
- **Placement.** The badge is not centred on the corner. Centred, it reaches 40 px into the box, past the block's 36 px and 26 px padding, so it would cover the first letter. It reaches into the box by `QUOTE_INSET` (0.75) of the box's padding instead. With No box it sits just above and left of the text.
- **Area.** The lines move down by what sticks out above them, never sideways, so the hook stays centred and inside the right safe edge. `area` is widened to the left to hold the badge.
- **Positioning in libass.** The badge and marks are placed `\an7` by the badge's top-left corner, also when popping, so they grow together from that corner. libass places a drawing by its origin under `\an7`, but offsets an off-origin drawing unpredictably under `\an5`; checked by rendering both.

Built:
- **HookStyle:** `quote` and `quote_colour` (`#22C55E`).
- **Renderer:** a rounded square (corners 0.22 of its width) and `_quote_marks`: two "66" marks, each a dot and a tail of cubic Béziers on the badge's 100-unit grid.
- **Preview:** the same path in SVG (`quoteMarks`).
- **Style panel:** a "Quote mark" group with a switch and the badge colour.

**Checks:**
- libass, white block in Poppins Black: reference 4. Strips with a Kicker: reference 2, the badge between the Kicker and the first strip.
- Browser: the badge previews on the first strip's corner.
