# 01: Revisions: stale saves are refused

**Parent spec:** `spec.md` in this feature folder (user stories 3, 26, 27, 34–37, 41, 43). Design: ADR 0003.

**What to build:** every Candidate has a Revision, and no editor or agent can save over a change it hasn't seen.

- **Model:**
  - `revision` on the Candidate. A stored Candidate without it reads as 1.
  - It goes up by one on every save that changes the Candidate's content.
  - Changing only `selected`, or a save whose result equals what is stored, keeps it.
- **Saving:**
  - The Candidate update takes an optional `revision`. If it isn't the current one, the save is refused with 409, nothing changes, and the body carries the current Candidate.
  - Without `revision`, the save is applied as today.
  - The check and the write happen under the store's existing lock.
  - Each save carries its source (Advanced Edit, Clip editor, Agent; missing or unknown is Unknown) and a tab id, sent beside the body. They are accepted and passed through, ready for the Candidate stream (03) and the Revision History (04).
- **Editors:**
  - The clip editor and the Advanced Edit send the Revision they last loaded or saved, plus their source and a per-tab id.
  - They keep the Revision from each save's answer.
  - Until merging lands (05), a 409 shows in the save status as "Changed elsewhere" with a Reload action. Unsaved work isn't silently dropped.
- **MCP:**
  - Every tool that returns a Candidate includes `revision`.
  - `edit_candidate` takes an optional `revision`. A 409 comes back as a tool error that carries the current Candidate.
  - `merge_candidate_items` and `remove_candidate_items` send the Revision of the Candidate they read, so two calls can't overwrite each other.
  - Saves are sent with source Agent.
  - The tool list stays within its size budget test.
- **Glossary:** Revision is already defined. Check that the code and UI copy use it.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam A: a save with the current Revision raises it; a stale Revision gets 409 with the current Candidate and changes nothing; no Revision means last write wins; `selected`-only and no-change saves keep the Revision; a legacy Candidate reads as Revision 1.
- [x] Seam A (MCP): tools return `revision`; `edit_candidate` with a stale Revision fails with the current Candidate; two racing `merge_candidate_items` calls lose neither change; the tool list fits the budget.
- [x] Both editors send `revision`, source and tab id; a 409 shows "Changed elsewhere" with Reload.
- [x] Typecheck and build; browser walkthrough: save in two tabs, see the second refused.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_revisions.py`:
  - each change raises the Revision;
  - a stale save gets 409 with the current Candidate and changes nothing;
  - a preview of a draft from an older Revision is still planned;
  - choosing for rendering and a no-change save keep the Revision;
  - no Revision means last write wins;
  - a legacy Candidate reads as Revision 1;
  - MCP: the tools tell the Revision, a stale `edit_candidate` fails with the Candidate, and three racing `merge_candidate_items` calls keep all three.
- Full backend suite. One run had a timing flake in `test_resilience`; it passes on its own and in two reruns of its file.
- `npm run build`.
- **Browser** (a copy of one Job in a scratch data dir):
  - an Advanced Edit save raises the Revision;
  - after an agent PATCH, the next Advanced Edit save is refused with "changed elsewhere" + Reload, and the agent's hook survives (before this change, the Advanced Edit's save would have overwritten it);
  - in the clip editor, a hook edit after an agent change is refused, and the latest Candidate is shown.

**Changes from the plan:**
- **The clip editor has no Reload button.** On a 409 it shows the Candidate as it is now (the 409 carries it), with "Not saved: changed elsewhere… Showing the clip as it is now", and edits on from there. A save queued before the refusal is dropped rather than sent with the newer Revision.
- **Choosing a Candidate for rendering (`selected` only) is sent without a Revision,** so ticking a clip in the list is never refused.
- **The source (`X-Edit-Source`) and tab id (`X-Edit-Tab`) headers** are sent by both editors and by MCP (`agent`), but the backend doesn't read them yet: ticket 03 does.
- **MCP:** `merge_candidate_items` and `remove_candidate_items` send the Revision they read. When refused, they apply their patch again to the Candidate the refusal carries, up to 5 times. Their patches only touch the fields and items they name, so a retry never writes back anything the agent didn't ask to change. On the very field it names, the agent's later save wins.
- **Leaving the Advanced Edit after a refused save** asks first (ConfirmDialog), so unsaved edits are never dropped silently.

**Known until 05:**
- The clip editor's text drafts (`useDraftSave`) keep showing what was typed after a refusal, including fields the other editor changed (such as the Kicker). The next keystroke then saves that draft from the newer Revision.
- Ticket 05's merge replaces this.
