# 08: Undo agent edits: Revert/Restore per turn and Ctrl+Z

**Parent spec:** `spec.md` (Solution "Agent Turns", "Undo"); ADR 0028.

**What to build:** the owner undoes the agent's work either a turn at a time from the chat, or step by step with Ctrl+Z in the tab that started it.

- **Backend.**
  - `POST …/agent/turns/{turn}/revert` restores the Revision before the turn's `first_revision`.
  - `POST …/agent/turns/{turn}/restore` restores its `last_revision`.
  - Both go through the existing Revision restore (`api.py` revisions routes), so a restore is itself a new Revision with source `restore`.
  - A turn with no Revisions gets a 409.
- **`useEditHistory.adopt(value, group)`.** Takes an outside value as a new undo step with that group. It doesn't save it again: the Revision already exists, and the next local save carries the adopted revision. Redo drops as with any new step.
- **`AdvancedEdit.tsx`.**
  - The Candidate events handler (around `useCandidateEvents`) checks each incoming Revision.
  - When its source is `agent` and its tab is `agent:<turn>` for a turn this tab started (`useAgentStream` keeps the set), the Revision goes through `adopt` with group `agent:<turn>:<revision>`.
  - Every other Revision keeps going through `elsewhere()`.
  - The Candidate events need to carry the Revision's `source` and `tab` if they don't already; add them on the backend event.
- **Turn actions.** `TurnView` shows Revert and Restore on finished turns that made Revisions. Each has a confirm-free action and a notice after.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Backend: revert and restore produce the expected Candidate and a `restore` Revision; a turn with no Revisions is a 409.
- [ ] `useEditHistory`: after `adopt`, undo returns the value before it and redo brings it back; `elsewhere` behaviour is unchanged (existing tests pass).
- [ ] The routing function that chooses `adopt` vs `elsewhere` is pure and tested: own turn → adopt, other tab's turn → elsewhere, non-agent source → elsewhere.
- [ ] Only the touched test files are run.
