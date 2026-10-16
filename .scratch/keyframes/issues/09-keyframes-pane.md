# 09: The Keyframes pane

**Parent spec:** `spec.md` (user stories 9–10, 27–32; Solution "The Keyframes pane"; Implementation Decisions "The bottom tabs").

**What to build:** on the desktop, the bottom of the Advanced Edit has two tabs, Timeline and Keyframes. The browser remembers the choice.

With no single item picked, the Keyframes pane says "Pick one item to edit its Keyframes". With one item, it has:
- **A tool strip:**
  - Dopesheet / Curves;
  - ‹ ◆ › for the active row;
  - the Ease of the Keyframe at the playhead, or of the next eased one: Linear, Ease in, Ease out, Ease in-out, or Custom;
  - Clear all Keyframes.
- **A row per keyable property,** with its value field and its own ‹ ◆ ›. Clicking a row makes it the active row, the one K acts on.
- **A ruler in the item's own seconds.** Clicking or dragging it moves the playhead.
- **The Dopesheet:** a lane per row. Diamonds are clicked to jump and dragged to retime, snapped to frames and never past a neighbour.
- **The Curves:** each keyed row's curve, faint and scaled to its own range, and the active row's drawn bold with its range's labels.
  - A Keyframe's dot drags in time and value.
  - Two Ease handles per span; dragging one makes the Ease Custom.
- **The playhead,** drawn over both views.

Each drag, and Clear all, is one step of undo. The tab bar is minimal, so that `workspace-layout` (roadmap #22) can absorb it later.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] setting an Ease by preset stores its four numbers, and a handle drag stores Custom ones, `x` kept within 0..1;
  - [ ] Clear all removes every property's Keyframes;
  - [ ] a dopesheet drag moves one Keyframe, snapped, never past a neighbour.
- [ ] The Curves' drawing of a span matches the sampling module at a few points: a pure test of the curve path against the shared Ease vectors.
- [ ] By hand: an overshoot made with the Ease handles plays the same in the preview and the Clip.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
