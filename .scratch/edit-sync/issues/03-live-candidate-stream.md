# 03: Live Candidate stream: editors show changes from elsewhere

**Parent spec:** `spec.md` in this feature folder (user stories 1, 2, 8, 10, 13–15, 29–32).

**What to build:** an open clip editor or Advanced Edit shows, live, every change saved to its Candidate by another editor, another tab, the agent or a CLI run.

- **Stream:**
  - A new server-sent stream of a Job's Candidate events, alive for as long as the Job exists.
  - Each `candidate` event carries the full Candidate (with its Revision), the save's source and tab id, and the changed parts.
  - Parts are named as the UI names them: range, Segments, Text Layers, Music, Overlays, Transitions, hook, style, Word Edits, Layout, Layout Overrides, source volume.
  - It sends nothing old on connect.
  - The store's change listeners feed it. It also rereads the Candidates every 2 seconds, so another process's changes are sent with source Unknown.
  - A `deleted` event ends it when the Job is deleted; a Candidate that disappears is sent as `removed`.
  - The Job progress stream is unchanged.
- **Editors:** both subscribe for the open Candidate.
  - **A newer Revision from elsewhere, with nothing unsaved:** adopt it.
    - A short notice names the source (Advanced Edit, Clip editor, Agent, Restore, Another tab, Unknown) and the changed parts.
    - The changed items are briefly highlighted on the Timeline and the preview.
  - **Echoes:** the editor's own saves (its tab id, or a Revision it already has) are ignored.
  - **Unsaved changes when a newer Revision arrives:** keep them. Their save meets the 409 of ticket 01 until merging lands (05).
  - **Connection:** a lost stream shows in the save status. On reconnect the editor fetches the Candidate once and handles it like an event if it is newer.
  - **Job deleted:** the editor becomes read-only with a message.
  - **Candidate removed:** a message with a link back to the Job.
  - Advanced Edit only: adopting theirs also resets the undo history's base, so undo can't reach back over the change. Real rebasing comes with ticket 05.

**Blocked by:** 01.

**Status:** done

- [x] Seam A (uvicorn on a free port, like the events tests): a save over HTTP and one through MCP each produce a `candidate` event with Revision, source, tab id and changed parts; a change written by another process is sent within the reread interval; deleting the Job sends `deleted`.
- [x] Both editors adopt a change made by the agent with a notice and a highlight, ignore their own echoes, show a lost connection, and go read-only when the Job is deleted.
- [x] Typecheck and build; browser walkthrough with two tabs and an MCP edit.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_candidate_events.py` (uvicorn on a free port):
  - a save tells its Revision, editor, tab and parts (`Hook`; `Range`, `Layout`);
  - a save through MCP is told as `agent` (`Text Layers`);
  - a change written to disk by "another process" is found on the reread, as `unknown`;
  - deleting the Job sends `deleted` and ends the stream.
- `npm run build`.
- **Browser** (a copy of one Job in a scratch data dir; the Advanced Edit and the clip editor in two tabs):
  - an agent PATCH appears in both at once, with "Agent changed Text Layers, Hook"; the Advanced Edit's Timeline shows the new Text Layer, and the clip editor's Hook fields show the new words;
  - a Label added in the Advanced Edit shows in the clip editor as "Advanced Edit changed Text Layers", with no notice in the Advanced Edit itself;
  - deleting the Job turns both into "This Job was deleted".

**Changes from the plan:**
- **The stream starts with a `ready` event carrying the Candidates as they are.** It replaces "sends nothing old" plus a fetch after reconnecting. Without it, a save made between loading the page and the stream starting would be missed. Editors compare Revisions, so an unchanged Candidate in `ready` does nothing.
- **Who saved a Revision is kept in memory by the store (`edit_of`),** keyed by Job and Candidate. A Revision written by another process, or before a restart, is `unknown`. The Revision History (04) keeps it on disk.
- **Parts are sent as the editors name them,** from one table in `app/revisions.py`.
- **The clip editor takes a change from elsewhere unless a save of that Candidate is unanswered.**
  - Its drafts (style, hook timing, hook words, trim) start again from it, through a `synced` count in their keys.
  - Only the open Candidate gets a notice; the others in the list update quietly.
  - A Candidate added elsewhere joins the list; one removed elsewhere leaves it.
- **The Advanced Edit takes a change from elsewhere unless edits are waiting to be saved or a save is unanswered.**
  - Taking it starts the undo history again; 05 rebases instead.
  - It also clears the "changed elsewhere, Reload" state of ticket 01.
- **Only the Timeline highlights changed items** (Text Layers, Overlays, Segments, Music, the hook), with a fading ring. The preview doesn't yet.
