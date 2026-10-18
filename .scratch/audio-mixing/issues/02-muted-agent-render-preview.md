# 02: Muted, for the agent, the render and the preview

**Parent spec:** `spec.md` in this feature folder (user stories 18–19, 60; Solution "Muted"; Implementation Decisions "Model", "Planner, other", "Renderer", "Preview", "MCP"); ADR 0016; GLOSSARY "Muted".

**What to build:** the agent can mute a Segment, a Music Clip or a video Overlay. The rendered Clip and the preview are silent there, whatever the item's volume or volume Keyframes say. The item keeps its volume, Keyframes and fades, so unmuting brings back what it had. There is no editor UI yet (03).

- **Model.** `muted` (default false) on Segment, Music Clip and Overlay. A stored Candidate reads as unmuted.
- **Planner.** `SegmentPlan` and `AudioEvent` carry `muted`. An Overlay's `muted` reaches its sound event.
- **Renderer.**
  - A Muted Segment's sound is silence of its Timeline length, as a held one's is. The plain `concat` path requires no Muted Segment.
  - A Muted Music Clip or Overlay is left out of the mix.
  - The loudness passes measure what is left.
- **Preview.** A Muted sound is held at gain 0: the decks' Source sound for a Muted Source Segment, and the event's element for a Music Clip, an Overlay or a media Segment. Keyed curves of a Muted item are not followed.
- **Track mute stays the editor's alone.** The heard draft still mutes Tracks by volume 0 and never writes `muted`.
- **MCP.** `muted` passes through `edit_candidate` and `merge_candidate_items`. The instructions say what Muted keeps. The dry run marks Muted items.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A render with a Muted Source Segment between two heard ones is silent for exactly its Timeline span (generated video with a tone).
- [ ] A Muted Music Clip with volume Keyframes is not heard. A Muted video Overlay with volume 1 is not heard.
- [ ] Unmuting the same items brings their sound back at their volume and Keyframes.
- [ ] A stored Candidate without `muted` renders the same ffmpeg command as before (the unkeyed command fixture).
- [ ] The preview's gain for a Muted item is 0 at every time, keyed or not.
- [ ] The MCP tools set and clear `muted`. The dry run shows it. The tool descriptions stay within the budget.
