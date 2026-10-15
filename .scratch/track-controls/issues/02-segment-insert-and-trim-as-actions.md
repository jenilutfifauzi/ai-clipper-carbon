# 02: Prefactor: inserting and trimming a Segment become actions

**Parent spec:** `spec.md` in this feature folder (Implementation Decisions "Actions that ripple": insert Segment and trim Segment edge move into the actions module).

**What to build:** the Advanced Edit works exactly as it does today. But inserting a Segment and trimming a Segment's edge now run through the pure actions module, so that ticket 03 can make them ripple and Seam D can test them.

- **Insert Segment.** Today the Advanced Edit component does it for a Media Library drop on the Video Track and for "add to clip" of a Source range or a video. It becomes an action: given the context, the new Segment and its place (by default, after the Segment at the playhead), it returns the edits with the Segment inserted and the Segment picked.
- **Trim a Segment's edge.** Today the component's drag handler does it, from the drag's origin. It becomes an action that takes the drag's origin (its Segments, the Main Track as played then, and the planned track), the Segment, the moved range and the edge. It returns the edits, so that every step of one drag is computed from one origin and stays one gesture group.
- **Dragging a Segment to reorder it** stays as it is, routed the same way if that is simpler. It never ripples.

**Blocked by:** None (can start immediately).

**Status:** done

- [ ] Dropping a video on the Video Track, "add to clip" from the Source and from the Media Library, trimming either edge of a Source or media Segment, and reordering all behave as before, with the same Pick and undo.
- [x] Seam D:
  - [x] an insert at the playhead lands after the Segment there, and at a given place lands there;
  - [x] two steps of one trim drag from one origin give the same edits as the last step alone.
- [x] `npm run typecheck`, `npm test`, `npm run build`.

## Comments

**2026-10-15: done.** Built as specified. Only trimming a Segment's end was driven in the browser; drops, "add to clip" and reorder are left for the walkthrough (10).
