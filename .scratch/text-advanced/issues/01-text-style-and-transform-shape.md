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

**Status:** done

- [x] A stored Candidate with Text Layers (box, outline, every alignment, animations) migrates, and its Render Plan's text events and a rendered frame are the same as before the migration.
- [x] A Revision restored from before the migration reads in the new shape.
- [x] `merge_candidate_items` changing only `style.colour` keeps every other style and transform field.
- [x] A Text Layer given `transform.stretch_x` other than 1, or a flip, is refused with a clear message.
- [x] The inspector, the Text tab's 4 looks, duplicate, split, the Clipboard and undo all work on the new shape (existing frontend tests pass, updated to the shape).
- [x] Every existing backend and frontend test passes, updated only for the shape.

## Comments

**2026-10-17 (agent):** Built.
- **Model** (`backend/app/candidates.py`): `Plate` (shape from `HookShape`, colour, opacity, radius, padding_x, padding_y, all px, floats), `TextStyle` (font, size, colour, stroke_width, stroke_colour, plate, line_height, tracking, align, wrap_width, fixed_height) and `TextLayer` (id, text, start, secs, `transform: Transform`, `style: TextStyle`, animations). `TextAlign` moved below `Transform`.
- **Refusals:** stretch and flip are refused for good (`_check_text_transform`). `_check_drawn` also refuses, for now, what the ASS path doesn't draw: a Transform scale ≠ 1, rotation ≠ 0 or opacity ≠ 1, and a style's tracking, wrap_width or fixed_height ≠ 0, or a Strips plate. Each refusal names the fields. **Tickets 02/04/05/03 should delete the matching lines of `_check_drawn`** as they draw them. I chose this so that MCP callers aren't told a value was saved when nothing draws it.
- **Migration** (`backend/app/migration.py`, `migrated_text_layer`): it runs for Candidates, Revision History and rendered Clips' outputs. x/y move into the transform. Look fields move into the style (outline → stroke). The box becomes a Block or `none` plate, keeping its colour and opacity. Padding and radius are today's constants (0.35/0.22/0.25 sizes) converted to px at the layer's size, rounded to 0.01. line_height is 1.1. The old constants now live there; the planner's `TEXT_LEADING`/`TEXT_PAD_*`/`TEXT_RADIUS` are gone. `TEXT_MARGIN` stays.
- **Planner:** shrinking is kept (ticket 03 replaces it). A shrunk layer's plate padding and corners shrink with it (`padding / style.size × size`), as before. `TextEvent` gains `radius` (the drawn corner radius), so neither the renderer nor the preview recomputes it.
- **Proof of identical rendering:** `backend/tests/fixtures/text_layers_before_text_style.{json,ass}` were written by the code *before* this change. They hold 9 old layers (box, outline, every align, fade/pop/slide, a shrunk one, a corner one, an odd size) with their planned events and Text ASS lines. The migrated layers plan the same events and write byte-identical ASS lines. A Seam A test also reads an old stored Candidate and its Revision History from disk, plans it, restores the old Revision, and renders an old boxed layer.
- **API/MCP:** an old flat shape is refused with a message naming transform/style (`no_old_text_layers`). `merge_candidate_items` merges style, plate and transform field by field (via the existing generic patch models). The MCP instructions describe the Text Style.
- **Frontend:** the types are in `api.ts` (`Plate`, `TextStyle`, `TextLayer`, `TextEvent.radius`). `advanced/textStyle.ts` holds `plateAt`, `textStyle`, `atSize` and `styled`. Changing the size in the inspector or on stage scales the plate's padding and radius in proportion, so the look behaves as before. The 4 looks are rebuilt on the new shape. In the multi-pick inspector, `shared` takes a reader and `restyle` takes a change function.
- **MCP tool budget:** the nested Text Style and Plate (in both the full and the patch schemas) grow the tool list to 64.3 KB, so `TOOLS_BUDGET_BYTES` goes from 61,500 to 65,000. The look details went into field comments rather than docstrings, which keeps the schemas short.
- **Left:** nothing for this ticket.
