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

**Status:** done

- [x] Seam D: move shifts layer items by one delta and leaves Segments. It is clamped at the Clip's start and end with the group's shape kept.
- [x] In the browser:
  - [x] dragging one of three picked layers moves all three, and one Cmd+Z undoes it;
  - [x] the arrows move the group;
  - [ ] dragging a picked Segment reorders only it (in code; the test Candidate had one Segment, left for the walkthrough, 11).
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** A drag (or an arrow key) of a picked layer item with others picked hands its step, as a delta from where the item is now, to the Pick's `move`, which clamps it for the whole group. While several are picked, their own edges are left out of the snap points, so the group doesn't snap to itself. Checked in the browser with two Text Layers: a drag of 2 s and an arrow press move both, each undone in one step.
