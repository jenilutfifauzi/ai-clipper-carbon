# 01: Text Layers take the Text Style and Transform shape

**Parent spec:** `spec.md` in this feature folder (Implementation Decisions "Domain and model", "Migration"); GLOSSARY (Text Layer, Text Style); docs/adr/0010-text-layers-are-rasterised-pictures.md.

**What to build:** a prefactor that changes the shape but not the look. A Text Layer becomes its `id`, `text`, `start`, `secs`, a `transform` (ADR 0007: centre, scale, rotation and opacity; stretch and flip refused unless at their defaults) and a `style`: a Text Style. Every reader moves onto the new shape: the planner, the renderer (still ASS in this ticket), the preview, the Advanced Edit's inspector, actions and Clipboard, and the MCP tools. The owner sees nothing new, and every stored Clip renders as it did.

- **The Text Style:**
  - Face id (`font`, existing ids kept), `size`, `colour`;
  - `stroke_width` and `stroke_colour` (today's outline);
  - `plate` (`shape` none or block, `colour`, `opacity`, `radius` and `padding_x`/`padding_y` in px: today's box, with its constants converted at the layer's size);
  - `line_height` (today's leading), `tracking` (0) and `align`;
  - `wrap_width` and `fixed_height`, both 0 for now and not yet acted on.
  - The shadow, Strips and the new behaviours come in later tickets. The model holds only what this ticket renders.
- **Migration:** stored Candidates and their Revision History, as the existing Candidate migration does. A stored layer's `x`/`y` move into `transform`; its look fields move into `style`.
- **MCP:** `edit_candidate` takes the new shape. `merge_candidate_items` merges `style` and `transform` field by field. The tool descriptions use Text Style.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A stored Candidate with Text Layers (box, outline, every alignment, animations) migrates, and its Render Plan's text events and a rendered frame are the same as before the migration.
- [ ] A Revision restored from before the migration reads in the new shape.
- [ ] `merge_candidate_items` changing only `style.colour` keeps every other style and transform field.
- [ ] A Text Layer given `transform.stretch_x` other than 1, or a flip, is refused with a clear message.
- [ ] The inspector, the Text tab's 4 looks, duplicate, split, the Clipboard and undo all work on the new shape (existing frontend tests pass, updated to the shape).
- [ ] Every existing backend and frontend test passes, updated only for the shape.
