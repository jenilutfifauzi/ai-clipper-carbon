# 05: Keyed Manual Scenes

**Parent spec:** `spec.md` (user stories 6–7; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Editor actions", "MCP").

**What to build:** a Manual Layout Override's Framing can move: the owner can pan from one speaker to the other in one shot by hand. Its Keyframes are in seconds from its Scene's start on the Source's timeline, so a piece of the Source shown twice moves alike both times, and Segment cuts never move them. The Candidate's own Manual Framing stays still.

- **Model.** `keys` on the Layout Override, for a Manual one only, with the picture properties. `at` need only be ≥ 0.
- **Planner.** The override's Keyframes are mapped from the Source's timeline into Timeline time through every Segment that shows its Scene. A piece shown twice gets two sets. Keyframes outside the visible part stay in the track. The Background follows 04's rule.
- **Renderer.** The Source picture of a keyed Manual Scene comes from the frame process, with its own decode of the Source range.
- **Editor.** A Keyframe on a Manual Scene is set at the playhead's Source time minus its Scene's start. Its diamonds are in its Transform section (with 06). It is never re-anchored by trims.
- **MCP.** The dry run lists a Manual Scene's Keyframes past its Scene's end as ignored.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] a Manual Layout Override's Keyframes come out in Timeline time in each Segment that shows its Scene;
  - [ ] a piece shown twice gets two sets;
  - [ ] a Segment that starts mid-Scene shows the motion from that point.
- [ ] Seam A, real ffmpeg: a Manual Scene keyed in `x` has the Source picture at the sampled position at two times.
- [ ] Seam A, HTTP and MCP:
  - [ ] Keyframes on a non-Manual override, and on the Candidate's Framing, are refused;
  - [ ] the dry run lists Keyframes past the Scene's end as ignored.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
