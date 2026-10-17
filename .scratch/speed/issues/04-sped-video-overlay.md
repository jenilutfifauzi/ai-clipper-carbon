# 04: A sped video Overlay

**Parent spec:** `spec.md` in this feature folder (user story 12; Solution "Speed": an Overlay keeps its place on the Timeline; Implementation Decisions "The Candidate model", "The renderer", "The preview"); ADR 0009.

**What to build:** the agent can give a video Overlay a Speed and pitch. It keeps its start and end on the Timeline and shows `(end − start) × speed` of its video from its offset, with its sound at the same Speed. Through MCP; the editor UI comes in 05.

- **Model.** `speed` and `pitch` on the Overlay, for a video; an image's are refused. Its end is kept within its video at `(duration − offset) ÷ speed` from its start, in the planner and the API's check.
- **Renderer.** The Overlay's read covers its span × Speed, its picture is sped as a Segment's, and its sound (when not muted) gets the 02 chain. A keyed video Overlay's frame decode reads through the same rate.
- **Preview.** The Overlay's video follows at `playbackRate` = Speed × the preview rate, mapping its time through its Speed; its sound plays at the same rate with `preservesPitch`.
- **MCP.** The fields through the edit tools and merge; the instructions' Overlay paragraph mentions them; the dry run's Overlay entry shows what of its video it reads.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A 4 s video Overlay at 2× with offset 1 renders frames 1–9 s of its video over its 4 s.
- [ ] An Overlay whose sped span would pass the video's end is clamped in the plan, and refused by the API when given past it.
- [ ] Its unmuted sound at 0.5× keeps its pitch; with `pitch` on it is an octave lower.
- [ ] A keyed video Overlay at 2× moves on the frames its Keyframes were set on.
- [ ] The API and MCP refuse a Speed on an image Overlay.
- [ ] The preview plays a 2× Overlay in sync with the render's frames at its start, middle and end (within a frame's drift).
