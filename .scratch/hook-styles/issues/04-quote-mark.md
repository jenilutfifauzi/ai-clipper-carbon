# 04: Quote Mark

**Parent spec:** `spec.md` in this feature folder (user stories 11, 16; "HookEvent", "Drawing").

**What to build:**
- **HookStyle** gains `quote` (`false`) and `quote_colour` (`#22C55E`).
- **Planner:** `HookEvent.quote` is the badge's Box: a square about 0.9 × the hook's size, centred on the top-left corner of the first line's box. With Shape `none` it uses the first line's text box. `area` grows to hold it.
- **Renderer:** a rounded square in `quote_colour` and two white quote marks, as ASS vector drawings (no font glyph, so every font looks the same).
- **Preview:** the same paths in SVG.
- **Style panel:** a toggle and colour in the Box and decoration group.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] `quote: false` gives v1's ASS.
- [ ] Seam B test: badge placement for `block`, `strips` and `none`, in both alignments, inside the safe area.
- [ ] Renderer test: the badge drawing.
- [ ] Browser check: preview and render agree; the badge doesn't cover the first word.
