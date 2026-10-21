# 07: Safe Areas per aspect, and Styles in the Reference Space

**Parent spec:** `../spec.md` (Implementation Decisions "Two coordinate spaces", "Planner": hook and Watermark, "Frontend": dragging captions, "API and MCP": documentation); GLOSSARY (Reference Space, Safe Area).

**What to build:** captions, the hook and the Watermark sit right on every aspect, from one Style Preset.
- **Safe Areas:** 4:5, 1:1 and 16:9 use their own Safe Area from the Canvas module.
  - Captions' Top, Bottom and Custom places, the hook's places and the Watermark's nine places are clamped to the Safe Area or resolved against it.
  - The stage's guides show it.
- **The Reference Space:** Caption, Hook and Watermark Styles' `x`, `y` and Custom places, in Presets and Style Overrides, stay in 1080×1920.
  - The planner maps them onto the Canvas in proportion.
  - Sizes are not mapped.
  - Existing Presets are untouched.
- **Widths:** caption and hook widths come from the Safe Area, capped at their 9:16 widths.
- **Dragging on the stage:** dragging a caption, the hook or the Watermark converts the stage's Canvas pixels into the Reference Space before writing the Style Override. The drop shows exactly where it was dropped.
- **MCP documentation:** rewrite the tools' text that says "0..1080, 0..1920" and "1080x1920 frame". Candidate positions are in the Canvas's pixels, and Style positions are in the Reference Space.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Seam B tests: a Custom caption y and a Watermark x mapped on 16:9; the hook's Top inside the 16:9 Safe Area; the nine Watermark places inside each Safe Area; caption and hook widths capped on 16:9; 9:16 unchanged.
- [ ] Seam A: on a 16:9 render, a caption lands at its mapped place inside the Safe Area (sampled pixels).
- [ ] vitest: the caption and hook drag conversion to the Reference Space round-trips on 16:9 and 4:5.
- [ ] MCP test: the tool documentation mentions the Canvas and the Reference Space, not 1080x1920.
