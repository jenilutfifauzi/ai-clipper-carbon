# 08: The agent adds, changes and removes Shapes

**Parent spec:** `../spec.md` (Implementation Decisions "Agent (MCP)"); GLOSSARY (Shape, Shape Style, Shape Kind).

**What to build:** the MCP tools take Shapes.
- **`edit_candidate` and `merge_candidate_items` take `shapes`.** The merge merges `style` and `transform` field by field.
- **The dry run lists each Shape's id, times, bounds and picture URL,** as it does for Text Layers.
- **The tool descriptions name the seven Shape Kinds,** what width, height and stroke mean for a line and an arrow, the stacking order (over the captions, under the Text Layers), and the refusals.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The agent can add a pill under a Text Layer in one `edit_candidate`, and the dry run shows both with bounds and picture URLs.
- [ ] `merge_candidate_items` changing only a Shape's fill keeps every other field.
- [ ] A Shape the model refuses comes back as a clear tool error.

## Comments
