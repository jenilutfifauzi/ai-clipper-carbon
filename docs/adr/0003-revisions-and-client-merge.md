# 0003: Candidates have Revisions; a stale edit is refused and the editor merges it item by item

Status: proposed
Date: 2026-10-15

## Context

A Candidate can be edited from several places at once:
- the clip editor;
- the Advanced Edit;
- another browser tab of either;
- the agent, through the MCP server.

Each of them saves by PATCH, and the last save wins. The Advanced Edit sends every field it edits on every save: the hook, Style Overrides, Word Edits and all of its lists. So a save that only moved one Text Layer also replaces whatever the agent changed in the meantime, with no one told. Neither editor hears about changes made elsewhere while the Job is in review, because the Job's event stream ends there. `merge_candidate_items` reads, merges and writes, so two agent calls can race the same way.

## Decision

- **Every Candidate has a Revision.** It is an integer from 1, raised by each save that changes the Candidate's content. Choosing it for rendering (`selected`) and a save that changes nothing don't raise it.
- **A stale save is refused.** A save may name the Revision it was made from. If the Candidate has moved on, the server refuses with 409 and sends the current Candidate back. A save that names no Revision is applied as before, so older callers and the CLI keep working.
- **The editor merges, not the server.** It merges its unsaved changes onto the newer Candidate three ways (the Revision it started from, its own changes, theirs):
  - item by item in the keyed lists (Segments, Text Layers, Music Clips and Overlays by id, Transitions by `after`, Word Edits and Layout Overrides by `at`);
  - section by section in Style Overrides;
  - field by field elsewhere.

  Where both sides changed the same item, **the owner's change wins**, and they are told which items, with a way to restore the other version. The merge is a pure function with its own tests.
- **Changes are pushed live.** A Candidate stream sends each changed Candidate with its Revision as long as the Job exists. It also rereads the files now and then, to catch other processes. The undo history is rebased onto what came in, so undo only takes back the owner's own steps.
- **The server keeps a Revision History** of each Candidate: its last 50 states, one per stretch of saving from one editor, labelled with that editor. Restoring an entry saves it as the next Revision.

## Considered options

- **Last write wins, plus a notice.** Simplest, but the lost edit is already gone when the notice comes.
- **The server merges.** It would need each save to say which items it changed, or a log of changes per Revision. The editor already knows what the owner touched, and can tell the owner what collided.
- **Real-time collaboration (OT/CRDT).** Far more than one person, a few tabs and an agent need.
- **Timestamps instead of Revisions.** Clock resolution and skew make "changed since" unreliable, and a timestamp can't key a history.

## Consequences

- Every editor save names its Revision. Every edit tool of the MCP server returns one, and `edit_candidate` accepts one.
- A Clip records the Revision it was rendered from. It is stale when the Candidate's Revision differs.
- Candidates saved before this ADR start at Revision 1, with an empty history.
