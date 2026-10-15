# 07: Locked Tracks

**Parent spec:** `spec.md` in this feature folder (user stories 18–27, 59; Implementation Decisions "Lock is enforced at the Pick and the gestures").

**What to build:** each Track header gets a lock button. A locked Track is view-only by hand in the Advanced Edit, but its items still follow the Main Track.

- **The Pick.** The actions module's context gains `locked`.
  - Click, toggle, the rubber band and select all skip items of locked kinds.
  - Locking a Track drops its items from the Pick, as pruning does.
  - The Video Track's lock covers Segments and joins.
- **The Timeline.** Items on a locked Track don't drag, trim or take drops. The header shows a lock, and the items the default cursor.
- **The stage.** A locked Text Track's or Overlay Track's items can't be picked on the preview. A locked hook can't be moved, resized or retyped. Locked captions refuse inline edits and drags.
- **Adding and pasting.**
  - Adding to a locked Track is refused with a notice. This covers an asset panel drop, the add buttons, and "add to clip" when the Video Track is locked.
  - A paste leaves out the Clipboard's items of locked Tracks, with a notice.
- **Split all** (ticket 05) skips locked kinds.
- **Ripple ignores locks:** the ripple rule and ripple delete still move locked items.
- **The agent and the clip editor are unaffected.** An agent's change to a locked Track's item still shows.

**Blocked by:** 05, 06.

**Status:** done

- [x] Seam D:
  - [x] click, toggle, band and select all skip locked kinds;
  - [x] locking prunes the Pick;
  - [x] a paste leaves out locked kinds with a notice;
  - [x] split all skips locked kinds but not hidden ones;
  - [x] a remove with magnetic on still moves a locked Text Layer.
- [ ] On a locked Track, dragging, trimming, dropping and the stage handles do nothing, and adding gives a notice.
- [x] Locks are gone after a reload, and never enter the undo history.
- [x] `npm run typecheck`, `npm test`, `npm run build`.

## Comments

**2026-10-15: done.** Built as specified. In the browser, a Text Layer on the locked Text Track couldn't be picked, and adding a text gave "The Text Track is locked." Drags, drops and the stage handles on locked Tracks are left for the walkthrough (10).
