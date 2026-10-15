# 02: Merge module with Vitest

**Parent spec:** `spec.md` in this feature folder (user stories 4, 5, 11, 12, 42). Design: ADR 0003.

**What to build:** the pure logic that merges an editor's unsaved changes onto a newer Revision, and rebases the undo history. It is checked by the frontend's first automated tests. Nothing in the UI uses it yet; ticket 05 wires it in.

- **Vitest** in the frontend. It runs beside the typecheck, and the build script runs it.
- **Merge:** a pure module shared by both editors.
  - Input: base (the edits at the Revision the editor started from), mine (the current unsaved edits) and theirs (the newer Candidate's edits).
  - Output: the merged edits and a list of collisions, each naming the part and the item.
  - **Keyed lists** (the MCP merge tool's keys): Segments, Text Layers, Music Clips and Overlays by `id`; Transitions by `after`; Word Edits and Layout Overrides by `at`. Item by item:
    - Changed on one side only: that side's version.
    - Added on either side: kept.
    - Deleted on one side and unchanged on the other: deleted.
    - Deleted on one side and changed on the other: a collision; mine wins.
    - Changed differently on both sides: a collision; mine wins.
  - **The Main Track's order:** mine if I reordered, otherwise theirs, with items added by the other side placed after the item they followed.
  - **Style Overrides:** section by section (caption, hook, watermark), then field by field.
  - **Other fields** (hook text, Kicker, hook timing, source volume, range, Layout, Preset): field by field; both changed is a collision, and mine wins.
  - Nothing unsaved (mine equals base): theirs as is, with no collisions.
- **Undo rebase:** given an undo history of snapshots and what changed elsewhere (base → theirs), it replaces those parts and items with theirs in every past and future snapshot, and leaves the rest alone.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam C, as worked examples:
  - [x] disjoint changes in one list both survive;
  - [x] an add on each side keeps both;
  - [x] same-item changes: mine wins, collision reported;
  - [x] a delete against an unchanged item deletes it;
  - [x] a delete against a change: a collision, mine wins;
  - [x] the Main Track order follows my reorder, and their new Segment lands after its predecessor;
  - [x] Style Overrides merge per field within a section;
  - [x] scalar fields merge;
  - [x] nothing unsaved returns theirs;
  - [x] the undo rebase touches only what changed elsewhere.
- [x] `npm run build` runs the tests; typecheck passes.

## Comments

**2026-10-15: done.**

**Checks:**
- `src/pages/job/editor/merge.test.ts`: 15 worked examples covering every case in the checklist, plus the same change on both sides (no collision), a Main Track reordered by them only, an override removed on one side, and the keys of Word Edits (`at`) and Transitions (`after`).
- `npm run build` runs them (`tsc`, `vitest run`, then `vite build`).

**Changes from the plan:**
- **Vitest 5.0.3,** pinned like the other dev dependencies.
  - npm 10.9 crashes resolving Vitest's optional browser peers (`Cannot read properties of null (reading 'edgesOut')`), so it was installed with `--legacy-peer-deps`.
  - `npm ci` from the lockfile isn't affected.
- **The module is `pages/job/editor/merge.ts`,** beside the other code both editors share.
  - `mergeEdits(base, mine, theirs)` returns `{ merged, collisions }`. Each Collision names its `field` (the Candidate field, such as `text_layers`) and, for lists and Style Overrides, its `item` (the key, or `section.field`). Ticket 03 maps fields to the parts the UI names.
  - It merges only the fields `mine` has, so the clip editor can merge its smaller drafts.
- **Order:** the list order rule applies to every keyed list, not only the Main Track. Text Layers and Overlays are drawn in list order.
- **`rebaseHistory`** is the same merge with the sides swapped (theirs wins), applied to every snapshot.
