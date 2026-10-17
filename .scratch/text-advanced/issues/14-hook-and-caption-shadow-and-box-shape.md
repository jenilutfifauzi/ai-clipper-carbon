# 14: Shadow and box padding and radius on the Hook and Caption Styles

**Parent spec:** `spec.md` (Solution "Hook and Caption Styles"; Implementation Decisions "Renderer": their new fields).

**What to build:** the hook and captions share the Text Layers' shadow and plate shapes, so that all text on a Clip can share one look.

- **The Hook Style and the Caption Style take the shadow value type** of ticket 04 (colour, opacity, blur, distance, angle).
  - The Caption Style's existing shadow fields migrate into it.
  - The renderer draws it as an event below each line, offset and `\blur`red, wherever it can't be a plain `\shad`.
- **Padding and radius:** the hook's box (Block and Strips) and the caption highlight box gain `padding_x`, `padding_y` and `radius` in px, replacing their constants.
- Defaults (and the migration) reproduce today's look, so stored Style Presets render as before.
- The clip editor's style fields and Style Overrides through MCP take them.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] A hook with a shadow at 45° and some blur shows a soft shadow down and to the right in a rendered frame.
- [ ] A caption shadow migrated from the old fields renders as before.
- [ ] A larger hook box radius rounds its corners. Larger padding widens it in the plan and the frame.
- [ ] Every built-in Style Preset's Render Plan and a rendered frame are unchanged at the defaults.
