# 05: Move a Pick on the Timeline

**Parent spec:** `spec.md` in this feature folder (user stories 21–25).

**What to build:** a picked group of layer items moves together, so a title, its Music Clip and its Overlay keep their timing.

- **Dragging a picked item.**
  - Dragging a picked Text Layer, Music Clip or Overlay moves every picked layer item by the dragged item's snapped delta, as one gesture group (one undo step).
  - The delta is clamped so the whole group stays inside the Clip, keeping its shape.
- **The arrow keys** (Alt for further) move every picked layer item the same way.
- **Picked Segments don't move with the group.** Dragging a Segment reorders that Segment alone, and the Pick becomes that Segment.
- **Trimming an edge** acts on that item alone, and the Pick becomes that item.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Seam D: move shifts layer items by one delta and leaves Segments. It is clamped at the Clip's start and end with the group's shape kept.
- [ ] In the browser:
  - [ ] dragging one of three picked layers moves all three, and one Cmd+Z undoes it;
  - [ ] the arrows move the group;
  - [ ] dragging a picked Segment reorders only it.
- [ ] Typecheck, test, build.
