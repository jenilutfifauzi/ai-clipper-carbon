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

**Status:** done

- [x] A media Segment at 2× of a generated test video (frame counter and tone) renders at half its range's length and shows every other frame.
- [x] At 0.5× with the pitch kept the tone stays at its frequency; with `pitch` on it is at half.
- [x] At 4× and at 0.25× the `atempo` chain is two stages, and the soundtrack is as long as the picture (also at 1.5×).
- [x] Volume Keyframes on a 2× media Segment are heard at their Timeline seconds.
- [x] The API and MCP refuse a Speed outside 0.0625–16, a Clip over the longest on the Timeline, a media Segment under 0.1 s on the Timeline, and a Speed change that leaves a Keyframe past the end.
- [x] The dry run shows the Segment's Timeline span; Text Layers placed after it can be moved by the agent to follow.
- [x] In the preview, a 2× media Segment plays in half the time with its pitch kept, and the playhead leaves it at its Timeline end.

## Comments

**2026-10-17: done.**

**What was built:**
- `Segment.speed` (0.0625–16, the `Speed` type with `MIN_SPEED`/`MAX_SPEED` in `candidates.py`, for 04's Overlay to reuse) and `Segment.pitch`, on their own two lines after `volume`. The Timeline length, the Keyframe check, the 0.1 s minimum and `check_length` already went through `segment_time` (01), so they needed nothing more. The API refuses an out-of-range Speed through pydantic ("greater than or equal to 0.0625").
- `pitch` on the planner's `SegmentInput` and `SegmentPlan` (and `api.ts`'s `SegmentPlan`, `ClipSegment` gets `speed` and `pitch`). `candidate_plan` now also passes a Source Segment's `id` into its `SegmentPlan` (it was `""`), so that the dry run names every Segment.
- Renderer: `speed_filters` and `tempo_stages` (public, tested directly). In `_segmented`, a sped Segment's input gets `setpts=(PTS-STARTPTS)/speed,fps=<Clip's rate>` before its Scenes are drawn; in `_source_inputs`, its sound gets the speed filters before `asetpts` and its volume (or volume Keyframes, in Timeline seconds), and a sped Segment is never on the plain concat path. The loudness pass and the encode both put `aresample=<audio rate>` on the mixed sound before `loudnorm` (the encode already ended in one). `frames.VideoDecode` divides its video's times by `shown.speed`, so a keyed media Segment's frame process reads its video at the Speed.
- `scripts/check_ffmpeg.py` requires `setpts`, `atempo`, `asetrate`, `aresample` (10 adds `tpad`).
- MCP: a paragraph on a video Segment's `speed` and `pitch` (and that a stranding Speed is refused until its keys, times old ÷ new, are sent with it). The dry run's `segments` (10's list: id, Timeline span, source range, media, hold) also give `speed` and `pitch` when not the default. The tool list is 60 521 bytes, within 10's budget of 61 000.
- Merged with 10: `_check_held` reads `speed` and `pitch` directly (only `reverse` still by `getattr`, for 06), and `test_a_freeze_frame_has_no_speed_pitch_or_reverse` runs, its Reverse case waiting for 06's field. In `_segmented` a held Segment's `tpad` comes instead of the speed filters (it is at 1× anyway). The stranded-Keyframe refusal is the model's own `checked_keys` against the Timeline length, so it covers a Speed change with no new code.
- Preview: `follow` sets `playbackRate` to the preview rate × `previewSpeed(speed)` (clamped to 0.25–4) and `preservesPitch` to `!pitch`; `MediaSegment` passes `pitch` along with the pace. A media Segment's time already ran on the clock in Timeline seconds, so the playhead leaves it at its Timeline end. The fake video of the playback harness has `preservesPitch`.

**Decided differently / left for later:**
- **A Speed on a Source Segment isn't refused.** The model and the renderer treat any Segment alike (its picture and sound are sped), but its Words, Scenes and camera path are still placed 1:1 and its one-Segment Clip still folds into `start`/`end`, and the decks don't play it at its rate: that is 03. The MCP instructions speak of a video's Segment only; 03 should widen them.
- **Outside 0.25–4× the preview plays at the nearest of those** while `follow` reads the time through the mapping, so the video is moved back in step whenever it drifts (every 0.15 s or so): jumpy until 09's copies.
- **Only a sped Segment is brought to the Clip's frame rate.** Unsped media Segments still keep their own (30 fps after the Media Library's normalization) when there are no Transitions, as before; so a Clip of a 25 fps Source mixes rates. The test renders from a 30 fps Source to read frames one to one.
- **Tests:** `backend/tests/test_sped_media_segments.py` (planner, `tempo_stages`, API and MCP refusals and the dry run, real renders of a generated 30 fps frame counter with a 1 kHz tone: every other frame at 2× drawn plainly and keyed, the tone's pitch at 0.5×, the soundtrack's length at 1.5×, 4× and 0.25×, volume Keyframes at 2×); `playback.test.ts` "speed".
