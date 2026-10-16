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

**Status:** done

- [x] Seam E (vitest), worked examples:
  - [x] three Segments with a Text Layer, a Music Clip and the hook give the sorted points with duplicates merged;
  - [x] a hidden Text Track drops its edges;
  - [x] next and previous from a point, from half a frame before a point, and at both ends (nothing).
- [ ] In the Advanced Edit, ↓ repeatedly visits every join and item edge in order, then stops at the end. ↑ goes back.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. The one source is `edgesOf(edits, played, { hidden, moving })` in `frontend/src/pages/job/advanced/timelineView.ts` (tested in `timelineView.test.ts`): the hook's edges, the Text Layers', Music Clips' and Overlays', and each Segment's end as played, leaving out those on a hidden Track (by `TRACK_OF`, so a hidden Video Track drops the joins) and those of a moving Pick of several. The Timeline's snap points are `edgesOf` with the Pick, which replaces `snapPoints` in `AdvancedEdit.tsx`; `editPoints(edits, played, { duration, hidden })` adds 0 and the duration, keeps what is inside the Clip, sorts, and merges edges within 1e-6 s. `nextEditPoint(points, time, fps)` and `previousEditPoint` give the nearest point more than half a frame after or before `time`, or null. The table's new rows are `edit-point-previous` (↑) and `edit-point-next` (↓), under navigation; an item with the focus already kept ↑/↓ (a Text Layer or the Watermark on the stage moves by them), and still does. The jump pauses and seeks to the point on the frame grid, no later than the last frame, so ↓ at the Clip's end lands on End's frame; with no point past either end it does nothing (and still takes the key, so the page doesn't scroll).

Two changes to snapping, as the snap points now come from the same edges. Items no longer snap to the edges of a hidden Track's items (their dimmed rows), nor to the hook's edges while the hook has no text (the Timeline draws no hook then).

Not tried in the browser: ↓ visiting every join and item edge in order and stopping at the end, and ↑ going back, is left for the walkthrough (11).
