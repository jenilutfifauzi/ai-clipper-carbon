# 09: Detach and Reattach

**Parent spec:** `spec.md` in this feature folder (user stories 24–32, 58, 61, 64; Solution "Detach and Reattach"; Implementation Decisions "Model", "API rules", "Editor actions", "Inspector", "MCP"); ADR 0016; GLOSSARY "Detach".

**What to build:** on the desktop, the owner Detaches a Segment's sound from its context menu or inspector. The sound moves onto a Music Clip that is heard exactly as before, and the Segment is Muted. That sound can then be slid for a J-cut or an L-cut. Reattach, from either side, puts things back. The agent does the same with ordinary edits. (The phone comes in 14.)

- **Model and API.**
  - `detached_from` (a Segment id or null) on Music Clip.
  - It must name a Segment of the Candidate when it is added or changed.
  - One that already carried it in the current Revision keeps it after the Segment is gone.
- **Detach** (an editor action, one undo step, on each picked Segment that allows it):
  - A new Music Clip of the Segment's sound: the Source's for a Source Segment, the video's for a media Segment.
  - It starts where the Segment's sound starts on the Timeline (a Transition's overlap included) and is as long.
  - It copies the range, Speed, pitch, Reverse, volume, fades and volume Keyframes (same `at`), sets `detached_from`, and doesn't duck.
  - The Segment is Muted. The Pick moves to the new Music Clips.
- **Detach is not offered** on a Freeze frame, a Muted Segment, a video Segment without sound, or a Segment that already has a Detached sound.
- **Reattach** is offered on the Segment and on any Music Clip Detached from it, while the Segment exists. It deletes every Music Clip Detached from that Segment and unmutes it, as one undo step. Nothing is copied back.
- **Split:**
  - a Muted Segment's tail stays Muted;
  - both parts of a split Detached sound keep `detached_from`.
- **Clipboard.** `detached_from` is dropped when pasting into another Candidate.
- **Inspector.**
  - A Segment shows Detach audio or Reattach audio.
  - A Detached Music Clip shows "Detached from Segment N" with Reattach.
- **MCP.**
  - The instructions spell out Detach: add a Music Clip with `detached_from`, the Segment's range and fields, then set the Segment's `muted`.
  - They spell out Reattach: remove those Music Clips, then clear `muted`.
  - A `detached_from` naming no Segment is refused.

**Blocked by:** 02, 04, 06, 08.

**Status:** ready-for-agent

- [ ] Detaching a Source Segment at 1.5× with fades and volume Keyframes renders the same sound as before the Detach (within tolerance, tone), now from a Music Clip, and the Segment is Muted.
- [ ] Moving the Detached sound 1 s later is heard 1 s later in the render.
- [ ] Detach on a Segment with a Transition at its start covers the overlap.
- [ ] Reattach after the Detached sound was split removes both parts and unmutes the Segment, as one undo step.
- [ ] Detach is not offered on a Freeze frame, a Muted Segment or a silent video Segment.
- [ ] The API and MCP refuse a new `detached_from` naming no Segment, and keep a stored one whose Segment was deleted.
- [ ] Editor action tests cover Detach over a Transition, Reattach and split.
