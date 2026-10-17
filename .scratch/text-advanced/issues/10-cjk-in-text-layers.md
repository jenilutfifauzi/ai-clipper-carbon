# 10: CJK in Text Layers

**Parent spec:** `spec.md` (Solution "Emoji and CJK"; Implementation Decisions "Planner (layout)", "Rasteriser", "Faces"); docs/adr/0010-text-layers-are-rasterised-pictures.md (explicit fallback).

**What to build:** Japanese or Chinese words in a Text Layer show real glyphs, laid out correctly, the same on any host.

- `make setup` downloads one CJK Face (Noto Sans JP or SC, OFL, one weight). It is registered as a bundled fallback Face, not offered in the picker, and recorded in THIRD_PARTY_NOTICES.
- **The planner splits each line into runs by Face.** A character the style's Face lacks goes to the CJK Face if that Face has it; otherwise it is left out. Each run is measured with its own Face.
  - The line pitch stays the style's Face's.
  - Wrapping breaks between CJK characters as UAX #14 allows.
- **The rasteriser** sets each fallback run with an explicit `\fn`, so libass's own (system) fallback is never used.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Planner: a line mixing Latin and Japanese has a run per Face, measured so that the line's width matches the rendered ink within a few px.
- [ ] Planner: the line pitch is the same with and without a CJK run.
- [ ] A rendered frame has ink where each CJK run is planned, and none of libass's missing-glyph boxes.
- [ ] A character neither Face has is left out, and the layout closes up around it.
