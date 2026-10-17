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

**Status:** ready-for-agent

- [ ] Planner: a sentence wider than its wrap width breaks between words; newlines are kept; an over-long word breaks between characters; nothing is shrunk.
- [ ] Planner: a fixed height taller than the words centres them; a shorter one grows to hold them.
- [ ] A stored layer that used to be shrunk plans the same size, lines and bounds after the migration.
- [ ] Dragging a side grip rewraps the text in the preview after the next plan, and undo restores it.
- [ ] The dry run lists the wrapped lines.
