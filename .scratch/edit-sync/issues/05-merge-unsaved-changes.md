# 05: Merge unsaved changes onto a newer Revision

**Parent spec:** `spec.md` in this feature folder (user stories 3–7, 11, 12, 33, 40). Design: ADR 0003.

**What to build:** when the owner has unsaved changes and the Candidate moves on elsewhere, both editors keep the owner's work and the other change together. A same-item clash is decided for the owner, who is told about it.

- **Editors** use the merge module (02):
  - **When a newer Revision arrives with unsaved changes:**
    - Merge base / mine / theirs, and keep the result as the unsaved draft.
    - Save it from the new Revision.
    - Show the notice of ticket 03.
  - **On a 409:**
    - Merge onto the Candidate it returned, and retry the save once with its Revision.
    - If it is refused again, wait for the next event instead of looping.
  - **When the server refuses the merged result as invalid (422):**
    - Adopt theirs.
    - Report that the unsaved change couldn't be applied.
  - **Collisions:** a notice names the colliding items and offers Restore (ticket 04), which brings back the other editor's version.
  - **Undo rebase (Advanced Edit):** when theirs is adopted or merged, the undo history is rebased with the module's rebase. This replaces ticket 03's reset of the undo base, so undo only takes back the owner's own steps and redo survives.
  - Ticket 01's interim "Changed elsewhere, reload" path goes away.
- **MCP server instructions** are corrected:
  - The owner's open editors show the agent's edits live.
  - A simultaneous change by the owner to the same item wins.
  - When an edit is refused as stale, read the Candidate again and redo the change on top of it.

**Blocked by:** 02, 03, 04.

**Status:** ready-for-agent

- [ ] The merge module's Seam C tests still pass. Wiring is checked in the browser:
  - [ ] the agent adds a Music Clip while the owner drags a Text Layer: both survive;
  - [ ] both change the same Text Layer: the owner's wins, a collision notice appears, and its Restore brings back the agent's;
  - [ ] after an agent edit, undo takes back only the owner's steps.
- [ ] A 409 merges and retries once; a 422 on the merged result adopts theirs with a message.
- [ ] Seam A (MCP): the server instructions mention live display and that the owner wins, and the tool list fits the budget.
- [ ] Typecheck and build.
