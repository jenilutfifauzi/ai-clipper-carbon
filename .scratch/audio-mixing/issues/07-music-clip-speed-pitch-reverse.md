# 07: Speed, pitch and Reverse on Music Clips

**Parent spec:** `spec.md` in this feature folder (user stories 35–37, 60; Solution "Music Clips get Speed, pitch and Reverse"; Implementation Decisions "Model", "Planner, other", "Renderer", "Editor actions"); ADR 0016 (amends 0009).

**What to build:** a Music Clip plays at a Speed from 0.0625× to 16×, its pitch kept unless "Change pitch with speed" is on, and may play in Reverse, as a video Overlay does. This works in the render, the preview, the inspector and through the agent.

- **Model.**
  - `speed`, `pitch` and `reverse` on Music Clip (defaults 1, false, false).
  - Its read of the item, `secs × speed` from `offset`, must lie within the item.
  - Volume Keyframes are checked against its Timeline length.
- **Planner.** `audio_events` carries the Music Clip's Speed, pitch and Reverse, and places it with the existing `overlay_time` mapping.
- **Renderer.** The existing speed filters (`atempo` stages, or `asetrate`). Reverse reads a Retimed copy. Retimed copies must also be made for an audio-only Media Library item (a song), not only for videos.
- **Preview.** `playbackRate` and `preservesPitch` within 0.25–4×, and the Retimed copy beyond that and in Reverse, as for Overlay sound.
- **Editor.**
  - The inspector shows the Overlay's Speed fields on a Music Clip.
  - A Speed change is a trim at the Music Clip's end: its start stays, and its volume Keyframes scale by old ÷ new.
  - Split and ripple handle a sped Music Clip by its Timeline length, keeping its `offset` in file seconds.
  - Waveforms follow the Speed and Reverse.
- **MCP.** The fields through the edit tools. The instructions and dry run cover them.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Music Clip at 2× of a tone lasts half as long and keeps its frequency; with `pitch` on, it is an octave up.
- [ ] A reversed Music Clip of a sweep plays it backwards in the render (from a Retimed copy of a song).
- [ ] The API and MCP refuse a Speed outside 0.0625–16, a read past the item's end at a Speed, and a Speed change that strands a Keyframe.
- [ ] In the editor, changing a Music Clip's Speed moves its end and scales its Keyframes, as one undo step.
- [ ] Splitting a 2× Music Clip at the playhead gives a tail whose `offset` advanced by twice the head's Timeline length.
- [ ] The preview plays a 2× Music Clip in half the time with its pitch kept.
