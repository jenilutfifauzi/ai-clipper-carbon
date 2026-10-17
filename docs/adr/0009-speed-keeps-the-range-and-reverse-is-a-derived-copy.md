# 0009: Speed keeps a Segment's range; Reverse plays a derived copy

Status: accepted
Date: 2026-10-17

Amends 0002 (a Segment's Timeline length is its range's length), 0006 (one rate for the decks) and 0008 (Keyframes stay put when an item's length changes at its end).

## Context

The `speed` feature (`.scratch/speed/spec.md`) brings Concat's constant speed (`SetClipSpeed`, 0.0625–16×), its "Change pitch with speed" switch, its reverse (`concat-host/src/reverse.rs`) and its freeze frame (`Command::FreezeFrame`) to the Advanced Edit, for Segments and video Overlays.

Today:
- **A Segment's range is its length.** `start` and `end` are seconds of the Source or the video, and its Timeline length is `end − start` (ADR 0002). Every mapping between Timeline time and Source time, in the backend and the frontend, is `source_start + (t − start)`.
- **A Source Segment is tied to the Transcript.** Its ends snap to Words, its captions come from its range's Words, and Word Edits and Layout Overrides find it by Source time.
- **Browsers can't play a video backwards,** and mute or stutter far from 1×.
- **ffmpeg's `reverse` and `areverse` hold the whole input in memory.** At 1080p, a second of yuv420p frames is about 90 MB.

Four questions had to be settled:
- what a sped Segment stores;
- what a reversed item plays from;
- what a freeze frame is;
- how the preview follows.

## Decision

- **A Segment keeps its range; Speed divides it.** New fields `speed` (0.0625–16), `pitch` and `reverse`.
  - A Segment's Timeline length is `(end − start) ÷ speed`. Its ends still snap to Words on the Source, and the longest-clip limit still applies both to a Source range and to the Clip on the Timeline.
  - An Overlay keeps `start`/`end` in Timeline time and reads `(end − start) × speed` of its video from `offset`. Each item keeps the data it is placed by today.
- **One mapping between Timeline and Source time per Segment** (forward, reversed, held), in Python and in TypeScript, pinned by a shared fixture. It replaces every inline `source_start + (t − start)`. The Render Plan's `SegmentPlan` carries `speed`, `reverse` and `hold`.
- **Words are retimed by 1 ÷ speed;** Word Edits and Layout Overrides stay on the Source (ADR 0002) and are found at any Speed. A reversed Source Segment has no captions, and its Scenes are its range's analysis mirrored.
- **Reverse is a flag played from a Retimed copy.** The item keeps its Source or video and range. Its range is reversed once, in short pieces joined last to first, into a derived file in two sizes (the proxy's for the preview, the full video's for the render). Any copy of a wider range of the item serves. Copies live beside the Job or media item and are swept when no Candidate, nor its Revision History, uses them.
- **A Freeze frame is a Segment with `hold`.** It shows its frame at `start` for `hold` seconds, silent, with `end = start`. The render takes the one frame and holds it (`tpad`); the preview holds a paused video. No still file is kept.
- **Changing the Speed is a trim at the item's end,** rippled as ADR 0004 says, and the item's Keyframes are scaled by `old ÷ new` so that its motion stays on the same frames.
- **Sound at Speed is a chain of `atempo` stages within 0.5–2,** or `asetrate` when the pitch follows the speed, as Concat's.
- **The preview uses `playbackRate` within 0.25–4×,** with `preservesPitch` from the switch, and a Retimed copy beyond that and in Reverse. A Segment played from a copy gets its own master and follower, parked like a media Segment's video.

## Considered options

- **Storing the Timeline length** and deriving the range's end. An Overlay is placed that way, but a Source Segment's snapping to Words, its caches by range and its limit are all on the Source, and would be computed backwards.
- **Concat's reverse: the copy replaces the item's media** ("X (reversed)" in the Media Library). A Source Segment would become a video Segment, losing its Transcript, captions, Word Edits, Layout Overrides and face tracking.
- **`reverse` in the render's filter graph.** It needs no cache, but it holds the whole range in memory (about 90 MB a second at 1080p), and the preview still needs a reversed file.
- **Reversed chunks of 30 s, as ADR 0005's Filmstrips.** Trims would reuse chunks, but the preview and the render would have to join chunks, and the decks would juggle several files per Segment. Reusing any covering copy gets most of that reuse.
- **One size of copy.** Half the encoding, but the preview would decode the full video.
- **`rubberband` for the kept pitch.** It sounds better below 0.5×, but it is GPL, slower, and another dependency to check. Concat ships `atempo`.
- **Keyframes left in seconds on a speed change.** That matches ADR 0008's rule for a trimmed end, but a zoom would land on another frame of the video, which is what the owner set it on.
- **A freeze frame as a new Segment kind** (`still`). This is more explicit in the schema, but it is another branch wherever a Segment is handled. **As a JPEG added to the Media Library** (Concat). That needs image Segments, fills the library with stills, and a still of the Source would lose its Layout.
- **`playbackRate` only.** Simplest, but the preview is silent or choppy at extreme speeds and can't reverse. **Always a copy.** The preview would always match the render, but every speed change would wait for an encode.

## Consequences

- **Overturns the Out of Scope line on speed changes** in `.scratch/advanced-edit/spec.md`.
- **Every stored Candidate reads as `speed` 1, forward, unheld,** and plans, renders and previews as before.
- **A one-Segment Clip at a Speed, in Reverse or held is stored as `segments`,** not folded into `start`/`end`.
- **Transition overlaps are worked out from Timeline lengths everywhere.** Before this, `candidates.py` used Source lengths and the planner Timeline spans. They agreed only at 1×.
- **A Clip can now play more or less of the Source than its length,** within the limits on both.
- **The backend gains a third kind of derived file** (after Filmstrips and Peaks), made off the Worker behind its own lock, with progress reported to the editor and a sweep when a Job is opened.
- **The decks gain per-Segment rates, and a Segment may play from its own pair of videos.** A reversed Source Segment with a Split Layout holds two more videos while it is near.
- **Reversing a long range competes with transcription for the CPU,** as Source chunks do. The lock and low priority keep that to one ffmpeg.
- **The agent can retime a Clip** with the fields it already patches. A speed change that strands a Keyframe is refused until the Keyframes are sent with it (ADR 0008).
