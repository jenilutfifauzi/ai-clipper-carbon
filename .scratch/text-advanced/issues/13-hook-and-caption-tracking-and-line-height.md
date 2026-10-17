# 13: Tracking and line height on the Hook and Caption Styles

**Parent spec:** `spec.md` (Solution "Hook and Caption Styles"; Implementation Decisions "Renderer": their new fields).

**What to build:** the hook and captions can be spaced like Text Layers.

- **The Hook Style and the Caption Style gain:**
  - `tracking` (px, may be negative), rendered as `\fsp`, and measured by the hook's fit and by caption line breaking;
  - `line_height`, a multiple of the size, which replaces the fixed leading between their lines.
- Defaults reproduce today's look exactly, so stored Style Presets and Style Overrides render as before.
- The clip editor's style fields, and Style Overrides through MCP, take both.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Planner: a hook with positive tracking fits onto more lines (or a smaller size) where it no longer fits on fewer. Caption lines break earlier.
- [ ] Planner: line height changes the gap between a two-line hook's anchors and between caption lines.
- [ ] A rendered frame shows wider letter spacing with positive tracking.
- [ ] Every built-in Style Preset's Render Plan is unchanged at the defaults.
- [ ] A Style Override of `tracking` set through MCP shows in the dry run.
