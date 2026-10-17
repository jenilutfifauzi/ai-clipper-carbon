# 03: Wrap width and fixed height

**Parent spec:** `spec.md` (Implementation Decisions "Planner (layout)", "Migration", "Preview and editor": stage grips).

**What to build:** long text wraps instead of shrinking, and the owner shapes the text block on stage.

- **The planner's layout:**
  - It breaks lines at newlines and greedily between words at the wrap width: `wrap_width`, or the frame less TEXT_MARGIN each side when 0, at UAX #14 break opportunities. A word wider than that breaks between characters.
  - The box is at least `fixed_height` high, with the words centred vertically, and grows when the words need more.
  - Padding is added only on an axis the words size.
  - Text is never shrunk.
- **Migration:** a stored layer the planner used to shrink stores that size, and a `wrap_width` that fits its longest line, so it renders as before.
- **Stage:** on a picked Text Layer, side grips set `wrap_width` and top and bottom grips `fixed_height`. Each is drawn live as an outline and saved as one undo step.
- **Inspector:** a Box section for wrap width and fixed height, each with a way back to 0 (auto).
- **MCP:** both fields can be set and merged. The dry run lists the wrapped lines.

**Blocked by:** 02.

**Status:** done

- [x] Planner: a sentence wider than its wrap width breaks between words; newlines are kept; an over-long word breaks between characters; nothing is shrunk.
- [x] Planner: a fixed height taller than the words centres them; a shorter one grows to hold them.
- [x] A stored layer that used to be shrunk plans the same size, lines and bounds after the migration.
- [x] Dragging a side grip rewraps the text in the preview after the next plan, and undo restores it.
- [x] The dry run lists the wrapped lines.

## Comments

**2026-10-17 (agent):** Built.
- **Line breaking** (`backend/app/line_breaks.py`, pure): `broken_lines(text, width, measure)` breaks at newlines, then greedily at the UAX #14 break opportunities the bundled scripts meet (after spaces and ZWSP; after hyphens and dashes, not a hyphen before a digit; before and after ideographs, kana and fullwidth forms; never before CL/CP/EX/IS/NS nor after OP, even across a space; never inside a character and its marks, joiners and variation selectors). A word wider than the width breaks between characters, at least one per line. `measure` is any line-width function, so tickets 04 (tracking) and 10 (runs per Face) only change what they pass in. No dependency added. Tests: `tests/test_line_breaks.py`.
- **Planner** (`planner.py`): `text_event` no longer shrinks. `text_lines(text, style)` (emoji stripped and blank end lines dropped as before, then `broken_lines` at `text_room(style)`, measured with the style's tracking) and `text_box(style, widths)` (the box size and where the lines start in it) are separate functions. The event's `size` is always the style's.
- **Decision: wrap_width and fixed_height are the box's outer size, plate padding included.** The words break at `wrap_width − 2·padding_x`, and the box is `max(widest + 2·padding_x, wrap_width)` wide and `max(words + 2·padding_y, fixed_height)` tall, the words centred down it. So on a sized axis the box is exactly the size asked for (as in Concat), but the padding stays as air inside it rather than the words touching the plate; the box grows past the size, padding and all, when the words need more. This is what lets every migrated layer, left/right-aligned and boxed included, plan exactly as before. With no wrap width, the room is the frame less TEXT_MARGIN and the padding either side, as the old shrink rule measured it.
- **Migration** (`migration.py`, `_shrunk_text`): an old flat layer the planner would have shrunk stores the shrunk size (the tenth below what fit, as before; never under 16) and a `wrap_width` of its widest line plus its plate's saved padding either side, rounded up to the hundredth. Its plate padding and radius are taken at that size (rounded to the hundredth, as ticket 01 did), so its anchors match the old ones to within 0.005 px (`as_before` in test_text_layers.py compares them to 0.01 px, every other field exactly). The 9-layer fixture plans the same lines, size, area and box, and the old-look pixel test still passes. `TextStyle.size` is now a float (16..320) to hold a shrunk size like 59.9; the Text Style line in a picture's ASS is written with `:g`.
- Only layers in the flat shape (before ticket 01) are migrated. A layer saved in the Text Style shape between tickets 01 and 03 (same day, unreleased) isn't re-read: a too-wide one now wraps at the frame instead of shrinking, since nothing marks it apart from a layer made today.
- **Refusals:** `_check_drawn` no longer refuses `wrap_width` or `fixed_height`.
- **MCP:** both fields are merged field by field through the existing style patch. The instructions say how they work, and the dry run's `lines` are the wrapped lines (tested in test_mcp.py).
- **Stage** (`frontend/src/pages/job/editor/TextBoxGrips.tsx`, maths in `textBox.ts`): on a Text Layer picked alone, a Grip in the middle of each edge. Side Grips set `wrap_width` and top and bottom Grips set `fixed_height`. **Decision:** a drag resizes the box about its middle (the opposite edge moves as far the other way), because the planner centres the box on the Transform. So the Transform never changes, which keeps the Grips independent of ticket 05's rotation and ticket 12's keyed position. The dragged box is outlined live and stays outlined until the next plan. Each drag is saved once, on release, with its own `drag:` group, so it is one undo step. `StageItem.onBox` and `StageControls.onBox` carry it. `useStageEdit` now returns `at`. The Grips are hidden while the item is being moved.
- **Inspector:** a Box section in the single Text Layer's fields (`BoxField` in TextLayers.tsx): Wrap width (slider 0..1080) and Fixed height (0..1920), each showing "Auto" at 0, with an Auto button back to 0 when set. A larger value set by the agent widens its slider. The multi-pick inspector doesn't have it.
- **Not checked by hand in a browser:** the Grips' gestures are covered by the pure `textBox` tests and tsc, not by driving the real stage.
