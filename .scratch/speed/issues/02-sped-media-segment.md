# 02: A sped media Segment, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 2, 4–6, 11, 14, 29–30; Solution "Speed", "The preview"; Implementation Decisions "The Candidate model", "The renderer", "The preview", "The MCP server"); ADR 0009.

**What to build:** the agent can give a Segment of a Media Library video a Speed from 0.0625× to 16×, with its pitch kept or changed. The rendered Clip plays it at that Speed, sound included, and the preview plays it the same way within 0.25–4×. There is no editor UI yet (05).

- **Model.** `speed` (0.0625–16, 1 by default) and `pitch` (false by default) on the Segment. Its Timeline length is `(end − start) ÷ speed` through the mapping (01). Keyframes are checked against the Timeline length. The minimum of 0.1 s and the longest-clip limit apply on the Timeline.
- **Renderer.**
  - picture: `setpts` divided by the Speed, then the Clip's frame rate;
  - sound with the pitch kept: a chain of `atempo` stages each within 0.5–2; with the pitch changed: `asetrate` between two `aresample`s;
  - the Segment's volume and volume Keyframes after the speed filters, in Timeline seconds;
  - the mixed soundtrack ends in `aresample=48000`; the loudness pass builds the same chain;
  - the ffmpeg check requires the filters used.
- **Preview.** The media Segment's videos play at `playbackRate` = Speed × the preview rate, `preservesPitch` = not `pitch`, and their time is read through the mapping. Speeds outside 0.25–4× play at the nearest of those until 09.
- **MCP.** The fields through the edit tools and merge. The instructions explain a Segment's Timeline length at a Speed and the pitch switch. The dry run lists each Segment's span on the Timeline. A Speed change that strands a Keyframe is refused, naming it.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A media Segment at 2× of a generated test video (frame counter and tone) renders at half its range's length and shows every other frame.
- [ ] At 0.5× with the pitch kept the tone stays at its frequency; with `pitch` on it is at half.
- [ ] At 4× and at 0.25× the `atempo` chain is two stages, and the soundtrack is as long as the picture (also at 1.5×).
- [ ] Volume Keyframes on a 2× media Segment are heard at their Timeline seconds.
- [ ] The API and MCP refuse a Speed outside 0.0625–16, a Clip over the longest on the Timeline, a media Segment under 0.1 s on the Timeline, and a Speed change that leaves a Keyframe past the end.
- [ ] The dry run shows the Segment's Timeline span; Text Layers placed after it can be moved by the agent to follow.
- [ ] In the preview, a 2× media Segment plays in half the time with its pitch kept, and the playhead leaves it at its Timeline end.
