# 01: Prefactor: the Pick replaces the single picked item

**Parent spec:** `spec.md` in this feature folder (user stories 59–61; Implementation Decisions "Pick", "One module for actions on a Pick", "The Advanced Edit's edits").

**What to build:** the Advanced Edit works exactly as it does today, but its single picked item has become a **Pick**. The actions run through one pure module, which later tickets extend to groups.

- **The Pick model** is one of:
  - a non-empty set of timed items (Segment, Text Layer, Music Clip or Overlay, by kind and id);
  - the hook alone;
  - the captions alone;
  - a join alone;
  - nothing.

  Its helpers:
  - toggle and replace;
  - prune against the edits;
  - the stage ids picked;
  - the kinds picked.
- **The actions module** takes the edits, the Pick, the playhead, the Main Track as played, the duration and the Word gap function. It returns `{ edits, pick, notice? }`, or nothing when the action can't apply. Today's single-item remove, duplicate and split move into it unchanged, and the editor applies the result as one change.
- **Pruning.** The Pick is not part of the undo history. After undo, redo, a merge of a newer Revision, or a change from elsewhere, it is pruned to the ids that still exist.
- **`layout_overrides` joins the Advanced Edit's edits.** It is loaded, saved and merged (ADR 0003 already keys it by `at`), though nothing edits it yet.
- **A Seam D test file** for the module, with item helpers in the style of the merge tests.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Every current gesture and key behaves as before: picking, delete, Cmd+D, Cmd+B, drag, trim, the stage, the phone toolbar.
- [x] Seam D:
  - [x] single-item remove, duplicate and split give the same edits and Pick as before;
  - [x] pruning keeps ids that exist and empties the Pick when none do.
- [x] An undo that removes the picked item leaves nothing picked. An agent deleting the picked Text Layer does the same.
- [x] Layout Overrides survive a save from the Advanced Edit, and a merge.
- [x] `npm run typecheck`, `npm test`, `npm run build`.

## Comments

**2026-10-15: done.** The Pick lives in its own module beside the edits; the actions on it are pure functions over a Scene (the edits, the Pick, the Main Track as played, the Clip's length, the Word gap and an id source) returning an Outcome, which the Advanced Edit applies as one change. The Pick is pruned against the edits on every render, so undo, redo and changes from elsewhere drop items that are gone.
