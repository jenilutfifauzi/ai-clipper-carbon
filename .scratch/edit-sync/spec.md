# Edit sync: Revisions, live Candidate updates and Revision History

Status: done
Created: 2026-10-15

## Problem Statement

The owner edits a Candidate in the clip editor or the Advanced Edit while the agent edits the same Candidate through the MCP server. Sometimes the owner also has a second tab open. Today every save simply replaces what is stored:

- **The Advanced Edit overwrites the most.** It sends the hook, the Style Overrides, the Word Edits and every list it edits on each save, so a single nudge of a Text Layer also wipes the Music Clips, Overlays or Word Edits the agent just added. Nobody is told.
- **Neither editor shows changes made elsewhere.** The Job's event stream ends once the Job is in review. The clip editor and the Advanced Edit keep showing the Candidate as they loaded it, and their next save restores that old state.
- **Undo can take back someone else's work.** Undo restores a whole snapshot of the edits, so it can also remove changes made elsewhere.
- **The undo history is lost on reload,** and nothing can take back an edit the agent made.
- **The agent's merges can race.** `merge_candidate_items` reads, merges and writes, so two of its calls can overwrite each other.
- **The MCP server's instructions are wrong.** They tell the agent that the owner's browser "shows these edits as they are saved", which isn't true.
- **Clips don't go stale on Advanced Edit changes.** A Clip is marked stale only when the range, hook text, Layout or Preset changed. An Advanced Edit change doesn't make it stale.

## Solution

- **Revisions.** Every Candidate has a **Revision**: a number that goes up with each saved change. Both editors and the agent save "from" a Revision. A save made from an older Revision is refused, and the current Candidate comes back with the refusal.
- **Merging.** The editor then merges its unsaved changes onto the newer Revision, item by item:
  - A Text Layer the owner moved and a Music Clip the agent added both survive.
  - Only when both changed the same item does the owner's change win. A notice then names the items and offers to bring the other version back.
- **Live updates.** Both editors receive every saved change of their Candidate live, from any editor, tab, the agent or a CLI process.
  - A change from elsewhere appears at once.
  - A short notice names who changed what ("Agent changed Text Layers, Music"), with **Restore** to undo it.
  - The changed items are briefly highlighted on the Timeline and the preview.
  - Undo and redo keep working and only ever take back the owner's own steps.
- **Revision History.** The server keeps each Candidate's **Revision History**: its last 50 states, one per stretch of saving from one editor, labelled with the time and the editor (Advanced Edit, Clip editor, Agent, Restore, Another tab).
  - A History button in both editors lists them, with the parts that changed ("Text Layers, Music").
  - Restore brings the whole Candidate back to that state as a new Revision.
  - The agent can list and restore Revisions too.
- **Clips.** A Clip remembers the Revision it was rendered from, so the Clips list marks it stale after any change, including Advanced Edit changes.

## User Stories

1. As the owner, I want a change the agent makes to my open Candidate to appear in the Advanced Edit at once, so that I see what it did without reloading.
2. As the owner, I want a change the agent makes to appear in the clip editor at once, so that both editors stay current.
3. As the owner, I want my next save not to wipe the Text Layers the agent just added, so that our work adds up instead of replacing each other.
4. As the owner, I want my unsaved changes and the agent's saved changes to be merged item by item, so that we can work on different items of the same Candidate at the same time.
5. As the owner, I want my change to win when the agent and I changed the same item, so that what I just did in front of me never disappears.
6. As the owner, I want a notice naming the items where my change replaced the agent's, so that I know something of theirs was set aside.
7. As the owner, I want that notice to let me bring the agent's version back, so that I can change my mind.
8. As the owner, I want a short notice when another editor changes my Candidate, naming who (Agent, Clip editor, Advanced Edit, Another tab) and what (Text Layers, Music, Segments, hook…), so that a change never happens silently.
9. As the owner, I want a Restore button in that notice, so that I can take back an unwanted agent edit in one click.
10. As the owner, I want the items changed elsewhere briefly highlighted on the Timeline and the preview, so that I can find them.
11. As the owner, I want undo to take back only my own steps after an edit from elsewhere, so that undo never removes the agent's work by accident.
12. As the owner, I want redo to keep working after an edit from elsewhere, so that my own history isn't thrown away.
13. As the owner, I want my own saves not to show up as changes from elsewhere, so that the notices only report other editors.
14. As the owner, I want a second tab of the same Candidate to stay in step with the first, so that two tabs never save over each other.
15. As the owner, I want a change made by a CLI run to appear in the open editor, so that every source of changes is covered.
16. As the owner, I want a History button in the Advanced Edit, so that I can see the Candidate's earlier states.
17. As the owner, I want the same History in the clip editor, so that I don't have to open the Advanced Edit to restore something.
18. As the owner, I want each history entry to show when it was saved, by which editor, and which parts changed, so that I can recognise the state I want.
19. As the owner, I want Restore to bring back the whole Candidate as it was in that entry, so that the result is a state I actually saw.
20. As the owner, I want Restore to ask me to confirm first, so that I don't replace my work by a misclick.
21. As the owner, I want a Restore to be saved as a new Revision, so that restoring is itself undoable from the history.
22. As the owner, I want Restore not to change which Candidates are chosen for rendering, so that restoring an edit doesn't unselect a clip.
23. As the owner, I want the history to survive closing and reopening the editor, so that I can take back yesterday's change.
24. As the owner, I want a long drag not to fill the history with dozens of near-identical entries, so that the history stays readable.
25. As the owner, I want the state just before another editor's change always kept in the history, so that I can always return to my version.
26. As the owner, I want choosing Candidates for rendering not to count as an edit, so that ticking a clip in the list doesn't disturb an open editor.
27. As the owner, I want a save that changes nothing not to create a Revision, so that the history only has real changes.
28. As the owner, I want the Clips list to mark a Clip stale after any change to its Candidate, including Advanced Edit changes, so that I know which Clips to render again.
29. As the owner, I want an editor to become read-only with a message when its Job is deleted, so that I don't keep editing something that is gone.
30. As the owner, I want a message and a way back to the Job when the Candidate I am editing disappears, so that I am not left on a broken page.
31. As the owner, I want editing to keep working while Clips render, as it does today, so that sync doesn't take anything away.
32. As the owner, I want the editor to say when its live connection drops and when it is back, so that I know whether I am seeing the latest state.
33. As the owner, I want a lost save (because the Candidate moved on) to be retried automatically after merging, so that I don't have to redo anything.
34. As the agent, I want every edit tool to return the Candidate's Revision, so that I can say which state my next edit builds on.
35. As the agent, I want `edit_candidate` to accept the Revision I read, so that my edit is refused instead of overwriting a change the owner made meanwhile.
36. As the agent, I want a refused edit to tell me the current Candidate, so that I can redo my change on top of it.
37. As the agent, I want `merge_candidate_items` and `remove_candidate_items` to send the Revision they read, so that two calls can never silently overwrite each other.
38. As the agent, I want to list a Candidate's Revision History, so that I can see what changed and who changed it.
39. As the agent, I want to restore a Revision, so that I can take back my own mistaken edit.
40. As the agent, I want the server's instructions to describe the owner's browser truthfully (it shows my edits live, and the owner's simultaneous change to the same item wins), so that I behave correctly.
41. As a CLI or older caller that sends no Revision, I want my save applied as before, so that nothing that works today breaks.
42. As a developer, I want the merge as a pure function with tests, so that the riskiest logic is checked without a browser.
43. As a developer, I want Candidates saved before this change to start at Revision 1 with an empty history, so that no migration step is needed.

## Implementation Decisions

The design is recorded in ADR 0003 (Revisions, stale saves refused, client-side merge). The terms Revision and Revision History are in the glossary.

**Candidate model**
- A new `revision` integer field. A Candidate stored without it reads as 1.
- It goes up by one on every save that changes the Candidate's content. The `selected` flag is not content: changing only it keeps the Revision. A save whose result equals the stored Candidate keeps the Revision and adds no history.
- The existing `edited` flag is unchanged.

**Saving (PATCH of a Candidate)**
- The update body takes an optional `revision`: the Revision the edit was made from.
  - If given and it isn't the current Revision, the save is refused with 409 and nothing is changed. The body carries the current Candidate, so the client needs no second request.
  - If it is omitted, the save is applied as today (last write wins).
- The check and the write happen together under the store's existing lock, inside the existing change-the-Candidates path.
- Each save says which editor made it: Advanced Edit, Clip editor, Agent or Restore. It is sent alongside the body (a request header). An unknown or missing source is recorded as unknown, which covers the CLI.
- Each browser tab also sends a tab id. The history and the events then tell "Another tab" apart from the same editor in this tab. Echoes of a tab's own saves are recognised by Revision.

**Revision History (new module in the backend, beside the Candidate store)**
- Each Candidate keeps up to 50 entries in the Job's directory. An entry is the full Candidate content (without `selected`), its Revision, when it was saved, its source, its tab id, and the parts that changed against the previous entry.
- "Parts" are the Candidate's top-level fields grouped as the UI names them: range, Segments, Text Layers, Music, Overlays, Transitions, hook (text, Kicker, timing), style (Preset, Style Overrides), Word Edits, Layout, Layout Overrides, source volume.
- **Grouping:** a save from the same source and tab within 2 minutes of that source's last save updates the newest entry in place. Any other save starts a new entry. Before a save from a different source or tab, the state it replaces is always kept as an entry.
- The oldest entries are dropped beyond 50.
- **Restore** of an entry saves its content (keeping the Candidate's current `selected`) as the next Revision, with source Restore, through the same checks as any edit. Restore takes an optional `revision` too, so it can be refused when stale.
- **Endpoints:**
  - list a Candidate's history (newest first, without the full contents);
  - get one entry in full;
  - restore one entry.
- Deleting a Job removes its histories with it.

**Candidate events (new stream)**
- `GET` of a Job's Candidate events: a server-sent stream that lives for as long as the Job exists.
- Each `candidate` event carries the full Candidate (with its Revision), the source and tab id of the save, and the changed parts.
- On connect, the stream sends nothing old. The client already has what it loaded, and compares Revisions.
- The store's existing change listeners feed the stream; it is told which Candidate changed. Like the Job progress stream, it also rereads the Candidates every 2 seconds, so changes made by another process (a CLI run) are sent. A reread that finds a Revision ahead of the last one sent emits it with source unknown.
- A `deleted` event ends the stream when the Job is deleted. A Candidate that no longer exists is sent as a `removed` event with its id.
- The existing Job progress stream is unchanged.

**Clips**
- A finished render records the Candidate's Revision it was made from.
- The Clips list marks a Clip stale when the Candidate's Revision differs from it, replacing today's field-by-field comparison.
- A Clip rendered before this change has no Revision. It falls back to the old comparison.

**Merge (new pure frontend module, shared by both editors)**
- Input: the base (the Candidate edits at the Revision the editor started from), mine (the editor's current unsaved edits) and theirs (the newer Candidate).
- Output: the merged edits, plus the list of collisions, each naming the part and the item.
- **Keyed lists:** Segments, Text Layers, Music Clips and Overlays by `id`; Transitions by `after`; Word Edits and Layout Overrides by `at`. They are the same keys the MCP merge tool uses. Item by item:
  - Changed on one side only: that side's version.
  - Added on either side: kept.
  - Deleted on one side and unchanged on the other: deleted.
  - Deleted on one side and changed on the other: a collision, and the owner's side wins.
  - Changed on both sides, differently: a collision, and the owner's version wins.
  - **The Main Track's order:** the owner's order if they reordered, otherwise theirs, with items added by the other side placed after the item they followed.
- **Style Overrides** merge section by section (caption, hook, watermark), and field by field within a section.
- **Other fields** (hook text, Kicker, hook timing, source volume, range, Layout, Preset) merge field by field. Both changed means a collision, and the owner wins.
- **The result goes through the server's normal checks** when saved. If it is refused as invalid (422, for example because a Transition's join no longer exists), the editor adopts theirs and reports that its unsaved change couldn't be applied.

**Editor sync (frontend)**
- Both editors subscribe to the Candidate stream for the open Candidate, and every save sends `revision`.
- **On a `candidate` event with a newer Revision from elsewhere:**
  - Nothing unsaved: adopt it.
  - Unsaved changes: merge, keep the merge as the unsaved draft, and save it from the new Revision.
  - In both cases, show the notice (source + changed parts + Restore) and highlight the changed items.
- **On a 409:** merge onto the Candidate it returned, and retry the save once with the new Revision. If it is refused again, repeat on the next event rather than looping.
- **Undo rebase (Advanced Edit):** when theirs is adopted or merged, every past and future snapshot in the undo history has the parts and items that changed elsewhere replaced by theirs. Undo then only reverts the owner's own steps. The clip editor has no undo, so it doesn't need this.
- **The notice's Restore** restores the history entry kept just before that change.
- **The collision notice** names the colliding items and offers the same Restore, which brings back the other editor's version.
- **History popover** in the top bar of both editors: the list (time, source label, changed parts) and Restore with a confirmation. Unsaved changes are saved first. There is no preview of an entry in this release.
- **Connection state:** a lost stream shows in the save status. On reconnect the editor fetches the Candidate once and handles it like an event if its Revision is newer.
- **Job or Candidate gone:** when the Job is deleted, the editor becomes read-only with a message. When the Candidate is removed, a message with a link back to the Job.
- **Source labels:** Advanced Edit, Clip editor, Agent (any MCP client), Restore, Another tab (the same editor in another tab), Unknown.

**MCP server**
- Every tool that returns a Candidate returns its `revision`.
- `edit_candidate` takes an optional `revision`. A 409 comes back as a tool error that carries the current Candidate and tells the agent to redo its change on top of it.
- `merge_candidate_items` and `remove_candidate_items` send the Revision of the Candidate they read.
- New tools: `list_candidate_revisions` and `restore_candidate_revision` (with an optional `revision`).
- Its saves are sent with source Agent.
- The server instructions are corrected. The owner's open editors show the agent's edits live. A simultaneous change by the owner to the same item wins, so the agent should read the Candidate again when told its edit was refused. The tool list must stay within the existing MCP size budget test.

## Testing Decisions

A good test checks behaviour at a public boundary: what a caller sends and what comes back or is seen. It survives a refactor of the internals. Expected values come from worked examples, not from recomputing them the way the code does.

Two seams, agreed with the owner:

**Seam A: the app over HTTP, server-sent events and MCP (existing)**
- Prior art:
  - the Job and review API tests that drive a TestClient;
  - the events tests, which serve the app with uvicorn on a free port, because a TestClient only hands over a streamed body once it ends;
  - the MCP tests.
- Cases:
  - A save with the current Revision raises it.
  - A save with an older Revision gets 409 with the current Candidate and changes nothing.
  - A save without a Revision is applied (last write wins).
  - Changing only `selected` and a no-change save keep the Revision.
  - A legacy Candidate reads as Revision 1.
  - The history groups saves from one source within 2 minutes into one entry, starts a new one for another source or tab, and always keeps the state before another source's save.
  - The history caps at 50.
  - Restore saves a new Revision with the entry's content and the current `selected`, and is refused when stale.
  - The Candidate stream sends a `candidate` event with the Revision, source and changed parts for a save made over HTTP and for one made through MCP.
  - It also picks up a change written by another process within its reread interval.
  - It sends `deleted` when the Job is deleted.
  - A render records the Revision on its Clip.
  - MCP: the tools return `revision`; `edit_candidate` with a stale Revision fails with the current Candidate; two `merge_candidate_items` calls racing don't lose either change; listing and restoring Revisions work; the tool list stays within its size budget.

**Seam C: the frontend merge module (new; Vitest is added to the frontend for it)**
- The first frontend tests. Vitest runs beside the typecheck, and the build script runs it.
- Cases, as worked examples of base / mine / theirs:
  - Disjoint changes in one list both survive.
  - An add on each side keeps both.
  - The owner wins a same-item change and the collision is reported.
  - A delete against an unchanged item deletes it.
  - A delete against a change is a collision the owner wins.
  - The Main Track order follows the owner's reorder, and the other side's new Segment lands after its predecessor.
  - Style Overrides merge per field within a section.
  - Scalar fields merge.
  - Nothing unsaved means theirs is returned as is.
  - The undo rebase replaces only the parts and items changed elsewhere in past and future snapshots.

Not automated:
- the editors' wiring (notice, highlight, History popover, read-only state);
- a two-tab plus agent walkthrough in the browser.

These are checked by a browser walkthrough, as for earlier features.

## Out of Scope

- Real-time collaboration between several people (presence, cursors, OT/CRDT).
- A server-side merge. The server only refuses stale saves.
- Previewing a history entry before restoring it, and restoring only some parts of an entry.
- An undo history in the clip editor.
- Persisting the browser's undo stack. The Revision History is the persistent record.
- Revisions or history for anything other than Candidates (Style Presets, the Media Library, Channel Profiles).
- Any change to the Job progress stream.

## Further Notes

- **This spec comes first in the Advanced Edit v2 roadmap.** Every later feature adds more editing, and with it more chances to overwrite.
- **The Transition clash.** The glossary already notes that "Transition" (Advanced Edit) and `StatusChange` (Job history) were split. The Revision History is a third kind of history, so name it Revision History in code and UI, never plain "history" or "changes".
- **The `edited` flag.** It stays as it is. Whether Revision 1 versus later Revisions could replace it is a later clean-up, not part of this work.
