# 0004: In the editors, layers ripple with the Main Track

Status: accepted
Date: 2026-10-15

Amends 0002 ("Cutting the Main Track leaves them where they are on the output").

## Context

ADR 0002 anchors the hook, Text Layers, Music Clips and Overlays to Timeline time, so that cutting the Main Track leaves them where they are. The captions follow the speech, because the planner makes them from each Segment's Words. The layers don't.

So deleting a Segment from the middle moves every later caption earlier, but a Text Layer written for a sentence stays at its second, over another sentence. A song's cue and an Overlay drift the same way. Concat's magnetic timeline (`TrimClip.ripple`, `RemoveClips.ripple`, Shift+Delete) closes the gap a delete or a trim leaves. Our Main Track is always back to back, so it has no gap to close. What drifts is everything on top of it.

## Decision

- **A Magnetic timeline switch in the Advanced Edit,** on by default and remembered by the browser. While it is on, a change that makes the Main Track shorter or longer at one point moves the layers with it. That change is deleting, trimming or inserting Segments (paste, duplicate, a drop).
  - Text Layers, Music Clips, Overlays and the hook after the point move by the change.
  - Those across a cut lose the part that was cut. A song's or a video's offset is kept where it goes on.
  - Those wholly inside a cut are deleted, with a notice; undo brings them back. The hook is never deleted: it moves to the join, no shorter than its minimum.
  - Reordering Segments and adding or changing Transitions move nothing.
- **Ripple delete (Shift+Delete) ripples whatever the switch says.** On a Segment, the layers follow. On a Text Layer, Music Clip or Overlay, the later items of its Track move up by its length.
- **The clip editor's trim of an uncut Clip follows the same switch and rule.**
- **Rippling is an editing action, not a model.** It is a pure function beside the other actions (`actions.ts`). It computes new Timeline times, which are saved like any other edit. Candidates store nothing new; the planner, the renderer and the Revision merge are unchanged.
- **The MCP server doesn't ripple.** Its tools change exactly what they are told. Its instructions say that removing or trimming Segments leaves the layers where they are.
- **Locked Tracks ripple too.** A lock stops hand edits, not the layers' following the speech.

## Considered options

- **Anchor layers to the Source, as Word Edits are.** A layer would follow its words through any cut, including a reorder. But a layer can sit over a media Segment, over a Transition or over a stretch shown twice, and Music Clips are not about words at all. It would also change the model, the planner and every saved Candidate.
- **Persist which Segment a layer belongs to (connected clips).** Reorders would carry layers too. But a layer often spans several Segments, and the link would be one more thing to merge and keep valid.
- **Ripple in the backend too, behind a `ripple` flag on the MCP tools.** A second copy of the rule, in Python, to keep in step with the editor's.
- **Each layer Track closing its own gaps (Concat's literal magnetic).** Gaps between Text Layers are on purpose. Following the speech is what goes wrong today.

## Consequences

- With the switch on (the default), deleting a Segment now moves and may delete layers. This changes what the Advanced Edit did before this ADR.
- An edit by the agent and the same edit in the editor can end differently. The MCP instructions say so.
- Rippling is one change of the edits, so one step of undo, and it merges by Revision like any other edit.
