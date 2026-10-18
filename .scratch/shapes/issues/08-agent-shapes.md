# 08: The agent adds, changes and removes Shapes

**Parent spec:** `../spec.md` (Implementation Decisions "Agent (MCP)"); GLOSSARY (Shape, Shape Style, Shape Kind).

**What to build:** the MCP tools take Shapes.
- **`edit_candidate` and `merge_candidate_items` take `shapes`.** The merge merges `style` and `transform` field by field.
- **The dry run lists each Shape's id, times, bounds and picture URL,** as it does for Text Layers.
- **The tool descriptions name the seven Shape Kinds,** what width, height and stroke mean for a line and an arrow, the stacking order (over the captions, under the Text Layers), and the refusals.

**Blocked by:** 04

**Status:** done

- [x] The agent can add a pill under a Text Layer in one `edit_candidate`, and the dry run shows both with bounds and picture URLs.
- [x] `merge_candidate_items` changing only a Shape's fill keeps every other field.
- [x] A Shape the model refuses comes back as a clear tool error.

## Comments

**2026-10-18, agent:** Built (in parallel with 04: tested against `rectangle`, the one kind the model takes today).
- **What 02 had wired:** `edit_candidate` already took `shapes` (through `CandidateUpdate`) and the dry run already listed each Shape's id, times, bounds, picture URL and Keyframes (`_layer_view`). `merge_candidate_items` silently ignored a `shapes` argument.
- **`merge_candidate_items` and `remove_candidate_items` take `shapes`** (`app/mcp_server.py`): `_KEYS["shapes"] = "id"` and `_PATCHES["shapes"]` from `Shape`, so `style` (its `shadow` too) and `transform` merge field by field through `_merged_fields`, as a Text Layer's; `fill: null` makes an outline alone. A new Shape takes no Preset (there are none).
- **Descriptions:** `SHAPES_SCHEMA` in `app/api.py` is the one-line schema shared by `CandidateUpdate.shapes` and the merge's `shapes`, now naming the seven Shape Kinds. The rest is a "Shape" bullet in the server's `INSTRUCTIONS`, beside the Text Layer's: the kinds and how each points, width/height/fill/stroke/radius/shadow, a line's and an arrow's width (length), stroke_width (thickness), colour (stroke's, or the fill's) and unused height, the refusals (nothing to draw; stretch and flips), the stacking (over the captions, under the Text Layers) and what the dry run lists. Shapes added to the Times, Edits, Magnetic-timeline and Keyframes bullets.
- **Budget:** `TOOLS_BUDGET_BYTES` 68_500 -> 69_000 (the tools measure 68_863, from 68_499): the merge's `shapes` parameter and the kinds in the schema line. Ticket 04 changes no tool schema (the kind enum is hidden behind `SHAPES_SCHEMA`).
- **Refusals** come back as tool errors naming the field: "shapes.0: Value error, Shape pill has nothing to draw: give its style a fill or a stroke (stroke_width)", "...can't be stretched...", an unknown kind as `shapes.0.style.kind: Input should be ...`, a new Shape without times as `shapes.1.secs: Field required`.
- Tests (`backend/tests/test_mcp.py`, "Shapes"): a pill under a Text Layer in one `edit_candidate` and both in the dry run with bounds and fetchable pictures; fill, shadow angle and rotation merged alone keeping the rest, fill null leaving an outline, remove by id; the refusals (nothing to draw through edit and merge, stretch, flip, unknown kind, missing times) saving nothing; the budget test checks the seven kinds are named in `edit_candidate`'s schema.
- For the coordinator after 04: extend `test_a_shape_the_model_refuses_is_a_clear_tool_error` with a line of `stroke_width` 0, and add a line or ellipse to the pill test.
