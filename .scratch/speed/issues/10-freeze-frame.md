# 10: A Freeze frame, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 24–25, 27, 31; Solution "Freeze frame"; Implementation Decisions "The Candidate model", "The planner", "The renderer", "The preview", "The MCP server"); ADR 0009.

**What to build:** the agent can put a Freeze frame on the Main Track: a Segment that holds one frame of the Source or of a video for `hold` seconds, silent, framed as its Segment was at that moment. Through MCP; the action and its editing come in 11.

- **Model.** `hold` on the Segment. With it, `end` equals `start`, `speed` is 1, and `pitch` and `reverse` are false; anything else is refused. Its Timeline length is `hold` (at least 0.1 s). A held Source Segment isn't snapped to Words and has no Keyframes; a held media Segment may have picture Keyframes, not volume ones.
- **Planner.**
  - Of the Source: one Scene with the Layout of the Scene holding `start` (an override there, or the Candidate's), its panels' crop and camera at that instant; no captions.
  - Of a video: drawn as any media Segment from its Framing (and its Keyframes).
- **Renderer.** The video at `start`, one frame, held with `tpad` for `hold` seconds; silence for its sound. Transitions may join into and out of it. Music Clips play on over it.
- **Preview.** A deck (or the media Segment's video) parked and paused at its frame, its time on a clock for `hold`.
- **MCP.** `hold` through the edit tools. The instructions say how to make a Freeze frame: split the Segment at the moment and put a held Segment of that instant between, then move the layers after it. The dry run lists it with its span.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A held media Segment of the test video renders the same frame for its `hold`, at the frame counter of its `start`, in silence.
- [ ] A held Source Segment renders with the Layout of its instant (a Track Scene's crop where the face was) and no captions.
- [ ] A held media Segment with a scale Keyframe zooms over its still.
- [ ] A Transition into and out of a held Segment renders.
- [ ] The API and MCP refuse a `hold` with `reverse` or a Speed, a `hold` under 0.1 s, Keyframes on a held Source Segment and volume Keyframes on a held media Segment.
- [ ] The preview shows the frozen frame for its `hold` and resumes the next Segment on time.
