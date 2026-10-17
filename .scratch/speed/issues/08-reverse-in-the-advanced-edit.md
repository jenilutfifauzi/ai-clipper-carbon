# 08: Reverse in the Advanced Edit, and a reversed video Overlay

**Parent spec:** `spec.md` in this feature folder (user stories 17–19, 22; Solution "Reverse", "The Timeline", "Editing"; Implementation Decisions "The Advanced Edit"); ADR 0009.

**What to build:** on the desktop, the owner reverses a Segment or a video Overlay with the Reverse switch (or R) and edits it truly on the Timeline.

- **The Reverse switch** in the Speed section, with the copy's progress. R toggles it on the item picked alone. One step of undo.
- **A reversed video Overlay:** `reverse` on the Overlay (refused on an image), its copy of `offset .. offset + (end − start) × speed`, rendered and previewed as a reversed media Segment is (06), its sound reversed with it.
- **Trim:** on a reversed item the left edge moves `end` and the right edge `start`.
- **Split** of a reversed Segment: the left half on the Timeline is the later part of the range; both keep `reverse`; no new copy is made.
- **Filmstrip and Waveform** are counted from `end` and mirrored. **A badge** ◀ (with the Speed if not 1).
- **The Clipboard** carries `reverse`.

**Blocked by:** 04, 05, 06, 07.

**Status:** ready-for-agent

- [ ] Toggling Reverse on a Segment shows the progress in the section and on the Segment, then plays it backwards; undo turns it off.
- [ ] Dragging the left edge of a reversed Segment changes its range's end; the Source end snaps to Words on save.
- [ ] Splitting a reversed Segment gives two halves whose joined playback equals the whole's, and no new copy is requested.
- [ ] A reversed video Overlay renders and previews backwards with its sound.
- [ ] The Filmstrip of a reversed Segment shows its last frame at its left edge.
- [ ] R with nothing picked or with several items picked does nothing.
