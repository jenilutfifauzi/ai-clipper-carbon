# 03: ↑/↓ jump between Edit Points

**Parent spec:** `spec.md` in this feature folder (user stories 10–15; Implementation Decisions "Navigation math: Edit Points"; GLOSSARY "Edit Point").

**What to build:** ↓ moves the playhead to the next Edit Point, and ↑ to the previous one. The owner goes from cut to cut, and from item edge to item edge, without dragging.

- **The points** are those items snap to:
  - the hook's edges;
  - the edges of Text Layers, Music Clips and Overlays;
  - each Segment's end as played;
  - 0 and the Clip's duration.

  They are sorted and de-duplicated, and items on hidden Tracks are dropped. The Edit Points and the snap points are built from one source, so they cannot disagree.
- **next/previous** take a time and give the nearest point strictly after or before it, past a tolerance of half a frame (02's grid). At either end they give nothing, so the jump doesn't wrap.
- **The jump** pauses playback, and the Timeline keeps the playhead in view.
- **The table.** The rows `edit-point-previous` and `edit-point-next` appear on the sheet.

**Blocked by:** 02 (frame grid).

**Status:** ready-for-agent

- [ ] Seam E (vitest), worked examples:
  - [ ] three Segments with a Text Layer, a Music Clip and the hook give the sorted points with duplicates merged;
  - [ ] a hidden Text Track drops its edges;
  - [ ] next and previous from a point, from half a frame before a point, and at both ends (nothing).
- [ ] In the Advanced Edit, ↓ repeatedly visits every join and item edge in order, then stops at the end. ↑ goes back.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
