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

**Status:** ready-for-agent

- [ ] Seam C, as worked examples:
  - [ ] disjoint changes in one list both survive;
  - [ ] an add on each side keeps both;
  - [ ] same-item changes: mine wins, collision reported;
  - [ ] a delete against an unchanged item deletes it;
  - [ ] a delete against a change: a collision, mine wins;
  - [ ] the Main Track order follows my reorder, and their new Segment lands after its predecessor;
  - [ ] Style Overrides merge per field within a section;
  - [ ] scalar fields merge;
  - [ ] nothing unsaved returns theirs;
  - [ ] the undo rebase touches only what changed elsewhere.
- [ ] `npm run build` runs the tests; typecheck passes.
