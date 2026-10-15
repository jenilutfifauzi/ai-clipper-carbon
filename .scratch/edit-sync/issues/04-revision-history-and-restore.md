# 04: Revision History and Restore

**Parent spec:** `spec.md` in this feature folder (user stories 9, 16–25, 38, 39).

**What to build:** every Candidate keeps a Revision History of its last 50 states. The owner and the agent can see who changed what and restore any entry.

- **Revision History:**
  - Kept per Candidate in the Job's directory, and removed with the Job.
  - An entry holds the full Candidate content (without `selected`), its Revision, when it was saved, its source and tab id, and the parts changed against the previous entry.
  - **Grouping:** a save from the same source and tab within 2 minutes of that source's last save updates the newest entry in place. Any other save starts a new entry.
  - Before a save from another source or tab, the state it replaces is always kept as an entry.
  - Beyond 50, the oldest entries are dropped.
- **Endpoints:**
  - list a Candidate's history, newest first, without the full contents;
  - get one entry;
  - restore one entry.
- **Restore** saves the entry's content, with the Candidate's current `selected`, as the next Revision with source Restore, through the same checks as any edit. It takes an optional `revision` and is refused with 409 when stale.
- **Editors:**
  - A History button in the top bar of both editors opens a popover: time, source label, changed parts.
  - Restore asks for confirmation and saves unsaved changes first.
  - The notice for a change from elsewhere (03) gets a Restore button, which restores the entry kept just before that change.
- **MCP:**
  - `list_candidate_revisions` and `restore_candidate_revision` (optional `revision`).
  - The tool list stays within its size budget.
- **Glossary:** Revision History is already defined. In code and UI, call it Revision History, never plain "history" (the Job's `StatusChange` history is something else).

**Blocked by:** 01, 03.

**Status:** done

- [x] Seam A:
  - [x] saves from one source within 2 minutes form one entry;
  - [x] another source or tab starts a new one;
  - [x] the state before another source's save is always kept;
  - [x] the history caps at 50;
  - [x] Restore saves a new Revision with the entry's content and the current `selected`;
  - [x] a stale Restore gets 409;
  - [x] deleting the Job removes the histories.
- [x] Seam A (MCP): listing and restoring Revisions work; the tool list fits the budget.
- [x] Both editors show the History popover and restore with confirmation; the notice's Restore takes back an agent edit.
- [x] Typecheck and build; browser walkthrough.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_revisions.py`:
  - saves from one editor and tab make one entry, and another editor or tab starts one;
  - the Candidate as Selection made it is kept first, as `original`;
  - after a pause a new entry starts, and only the newest `HISTORY_MAX` are kept (both set with `monkeypatch`);
  - Restore saves the entry as the next Revision with source `restore`, keeps `selected`, and keeps the restored entry;
  - a stale Restore gets 409 with the Candidate; an unknown Revision gets 404; deleting the Job takes the histories with it;
  - MCP: `list_candidate_revisions` and `restore_candidate_revision`, including a stale one; the tool list fits its budget.
- `npm run build`.
- **Browser** (scratch copy):
  - the agent changes the hook, and the notice's Restore brings the hook back while keeping the Text Layer just added;
  - the History dialog lists Restore, Agent, Advanced Edit and Original with their parts;
  - in the clip editor, History → Restore of the Original brings back Revision 1's content as Revision 5.

**Changes from the plan:**
- **Entries are kept in `revisions/<candidate id>.json`** in the Job's directory, by the store, inside the same lock as the save. The grouping is the pure `recorded()` in `app/revisions.py`.
- **The first entry is the state before the first save,** with source `original` ("Original"), whatever made it (Selection, or the owner for a manual one).
- **Restore is `POST …/revisions/{revision}/restore`.** It builds an update from the entry's content (its Main Track, and every other field an edit changes but `selected`) and runs it through the PATCH route, so it gets every check an edit gets.
- **The History is a dialog, not a popover,** so it works the same on a phone.
  - It opens from a History button in the Advanced Edit's top bar and beside "Edit Advanced" in the clip editor.
  - Restore asks inline ("Restore this version?").
  - The Advanced Edit saves its waiting edits first. The clip editor waits for its saves under way, but not for a draft typed in the last 0.7 s.
- **The notice's Restore restores the entry of the Revision the editor had before the change came in.**

**2026-10-15: review fixes.**
- **An entry is stamped with when its state was saved.** A kept "before" state is stamped with when it was saved; the Original, with when Selection made it, when that was this process. When that isn't known, `at` is null and no time is shown, instead of the time of the next save.
- **A notice's Restore finds its entry once it is clicked.**
  - "Before" restores the newest entry older than the change.
  - "Theirs" restores the oldest entry from the change on.
  - Saves keep going into the newest entry, so a Revision named in the notice may no longer have its own.
- **The button reads "Revision History",** the glossary's term.
