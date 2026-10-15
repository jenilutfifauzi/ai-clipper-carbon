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

**Status:** ready-for-agent

- [ ] Seam A:
  - [ ] saves from one source within 2 minutes form one entry;
  - [ ] another source or tab starts a new one;
  - [ ] the state before another source's save is always kept;
  - [ ] the history caps at 50;
  - [ ] Restore saves a new Revision with the entry's content and the current `selected`;
  - [ ] a stale Restore gets 409;
  - [ ] deleting the Job removes the histories.
- [ ] Seam A (MCP): listing and restoring Revisions work; the tool list fits the budget.
- [ ] Both editors show the History popover and restore with confirmation; the notice's Restore takes back an agent edit.
- [ ] Typecheck and build; browser walkthrough.
