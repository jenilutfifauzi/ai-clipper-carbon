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

**Status:** done

- [x] The merge module's Seam C tests still pass. Wiring is checked in the browser:
  - [x] the agent adds a Music Clip while the owner drags a Text Layer: both survive;
  - [x] both change the same Text Layer: the owner's wins, a collision notice appears, and its Restore brings back the agent's;
  - [x] after an agent edit, undo takes back only the owner's steps.
- [x] A 409 merges and retries once; a 422 on the merged result adopts theirs with a message.
- [x] Seam A (MCP): the server instructions mention live display and that the owner wins, and the tool list fits the budget.
- [x] Typecheck and build.

## Comments

**2026-10-15: done.**

**Checks:**
- Seam C: `merge.test.ts` has 16 cases, adding `fieldsOf` and `collidedParts`.
- `tests/test_revisions.py`: the MCP server instructions now say the owner's editors show the agent's edits as they are saved, that the owner's change wins a clash, and that `list_candidate_revisions` exists. The tool list fits its budget.
- `npm run build`.
- **Browser** (scratch copy):
  - A Title is added in the Advanced Edit while the agent sets the Kicker, within the 0.7 s before the Title is saved: both are saved.
  - A Text Layer is retyped in the inspector while the agent retypes the same layer: the owner's words win, with "Your changes to Text Layers replaced Agent's" and Restore.
  - A Label is added and saved, the agent changes the hook, then Undo: the Label goes and the agent's hook stays.
  - In the clip editor, the hook is retyped while the agent changes the Kicker: both are saved.

**Changes from the plan:**
- **Advanced Edit.** One `incoming` handles a change from elsewhere and a refusal.
  - It merges the edits waiting here (all of them, on a refusal) from `savedEdits`, the edits as last saved here, onto theirs.
  - It rebases every undo step (`useEditHistory.elsewhere`) and saves the merge from the new Revision.
  - A change that comes while a save is unanswered waits for the answer (`postponed`), so it is never lost.
  - After a second refusal in a row it stops and shows "changed elsewhere again" with Reload. The next change from elsewhere puts it back in step.
  - A 422 on the merged result takes theirs and says the latest change couldn't be applied.
- **Clip editor.** It keeps each Candidate as last saved or taken (`server`), which replaces ticket 01's Revision and refusal maps.
  - A save remembers what it was made from. If a newer Revision came in before it is sent, it is merged onto it (only the fields it changes) and sent from it. On a 409 it is merged onto the Candidate the refusal carries and sent once more.
  - A change from elsewhere that comes while a save is under way updates `server` only; the save's answer shows it.
  - A second refusal, or a 422, shows the clip as it is now with a message.
- **Collisions are named by part** (`collidedParts`). The notice's Restore restores the other editor's Revision.

**Known limit:** in the clip editor, a style or hook-timing draft typed less than 0.7 s before a change from elsewhere arrives is saved as a whole when its editor starts again. On the fields of that draft, it wins over the other change.
