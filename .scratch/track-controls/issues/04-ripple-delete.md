# 04: Ripple delete (Shift+Delete)

**Parent spec:** `spec.md` in this feature folder (user stories 50–56; Implementation Decisions "Ripple delete").

**What to build:** Shift+Delete (and Shift+Backspace) deletes the Pick and closes the gap, whatever the Magnetic switch says. It is one undo step.

- **Picked Text Layers, Music Clips and Overlays** close their Track first.
  - For each kind, every item of that kind starting at or after a deleted item's end moves up by the deleted item's length.
  - Deleted spans are taken from the latest to the earliest.
  - Items overlapping a deleted item stay where they are. Other kinds are untouched.
- **Picked Segments** then ripple the layers by the ripple rule, as if magnetic were on.
- **The hook, the captions or a join, alone:** the same as Delete.
- **On a phone,** the picked items' bar gains a Ripple delete button.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] with magnetic off, ripple delete of a Segment still moves the later layers up;
  - [ ] ripple delete of a Text Layer moves the later Text Layers up by its length, leaves an overlapping one in place, and leaves Music Clips and Overlays alone;
  - [ ] a mixed Pick of a Segment and a Music Clip gives both effects in one outcome;
  - [ ] the hook alone behaves like Delete.
- [ ] Shift+Delete and Shift+Backspace work, and typing in a field is left alone.
- [ ] The phone's picked items' bar has Ripple delete.
- [ ] `npm run typecheck`, `npm test`, `npm run build`.
