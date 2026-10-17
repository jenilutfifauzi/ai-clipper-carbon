# Speed, Reverse and Freeze frame

Status: needs-triage
Created: 2026-10-17

## Problem Statement

Everything in the Advanced Edit plays at the speed it was filmed, forwards.

- **No slow motion, no fast forward.** A Segment plays its range of the Source or of a video second for second. A reaction can't be slowed to land, a long walk can't be sped through, a B-roll clip can't be stretched to fill a sentence.
- **No reverse.** A gesture or a pour can't be played backwards, a common beat in edited Reels.
- **No freeze frame.** A face mid-expression can't be held for a second while the music carries on.
- **Out of Scope until now.** `.scratch/advanced-edit/spec.md` lists "Speed changes". `.scratch/navigation-playback/spec.md` adds a preview rate (0.5–2×) and says outright that it is "not a Clip's speed: that is the later `speed` feature".
- **Every Timeline↔Source mapping is 1:1 and forward.** The backend's `timeline_length`, the planner's main-track loop, `_segment_words`, `editor.py`'s preview words, the renderer's `-ss/-t` reads and `frames.VideoDecode`; the frontend's `playedFrom`, `playable`, the decks' `read`/`enter`/`moveTo`, `follow`, the trim drag, split, the Clipboard, Filmstrip and Waveform. Each assumes one Source second is one Timeline second.
- **Concat has all three:**
  - `SetClipSpeed` (0.0625–16, the engine's `SPEED_RANGE`), keeping the source covered and setting the clip's length to `source ÷ speed`;
  - a "Change pitch with speed" switch (`preserve_pitch`, on by default), as a chain of `atempo` stages or `asetrate`;
  - `concat-host/src/reverse.rs`, which writes a reversed copy of the span a clip uses and plays it forwards;
  - `Command::FreezeFrame`, which splits a clip at the playhead and inserts a one-second still, rippling the track.

## Solution

Segments and Overlay videos get a **Speed**, may play in **Reverse**, and a Segment may be a **Freeze frame** (see the glossary and ADR 0009).

**Speed.** A constant rate, 0.0625–16× (1 by default), on a Segment (of the Source or of a video) or a video Overlay.
- **A Segment keeps its range.** `start` and `end` stay its range of the Source or the video, and its ends of the Source stay snapped to Words. Its length on the Timeline is derived: `(end − start) ÷ speed`, rounded to 6 decimals, not to frames.
- **An Overlay keeps its place on the Timeline.** `start` and `end` stay Timeline time and `offset` its in-point. It shows `offset` to `offset + (end − start) × speed` of its video; its end is kept within the video as today, at `(duration − offset) ÷ speed` from its start.
- **Pitch is kept by default.** "Change pitch with speed" (`pitch`, off by default) lets the voice rise and fall with the speed instead, like tape.
- **Changing the Speed is a trim at the item's end.**
  - A Segment's range stays; its Timeline length changes. The Main Track stays back to back, the Segments after it move, and the layers follow while the Magnetic timeline is on (ADR 0004), as a trim of its right edge.
  - An Overlay's start stays and its end moves. Nothing else moves; its lanes are worked out again.
  - Its Keyframes are scaled by `old ÷ new`, so its motion stays on the same frames of its video, as Concat's do (it keeps them as fractions of the clip).
- **Limits.** A Segment's range of the Source is still at most the longest clip (180 s, or the Job's longest), and so is the Clip on the Timeline. A Segment at 16× of a 180 s range would play 11.25 s. A media Segment lasts at least 0.1 s on the Timeline; a Segment's trim keeps it at least 0.3 s there.

**Captions of a Segment at Speed.** Words keep their time on the Source and are placed on the Timeline at `start on the Timeline + (word − start) ÷ speed`. Caption lines and highlights follow. Word Edits and Layout Overrides stay keyed by Source time (ADR 0002), so they find their Words at any Speed.

**Word snapping.** Unchanged: the ends of a Source Segment snap to Words on the Source, with the lead-in and tail in Source seconds. At 0.0625× a 0.2 s tail plays 3.2 s; that is the slow motion. A trim drag on the Timeline moves the Source end by the dragged seconds × speed.

**Reverse.** A Segment (of the Source or of a video) or a video Overlay plays its range backwards.
- **It is a flag, `reverse`.** The item keeps its Source or video, its range, its Word Edits and its Layout Overrides. On the Timeline its left edge is the end of its range and its right edge the start; trimming the left edge moves `end`.
- **A Retimed copy plays it.** Its range is reversed once into a file, picture and sound, and played forwards: by the preview, which can't play a video backwards, and by the render, without holding the range in memory.
  - Made in the background when Reverse is switched on; the inspector shows its progress. A render makes the one it needs if it is missing.
  - Made in short pieces, each reversed and then joined last to first, so memory stays bounded whatever the length.
  - Two sizes: from the proxy for the preview, from the full video for the render.
  - Any copy of a wider range of the same item serves: a reversed copy of `a..b` holds every `c..d` inside it, from `b − d` on. A split or a trim inward makes no new copy; a trim outward does.
- **Speed applies after Reverse:** the copy is played at the Segment's Speed, with its pitch kept or not.
- **Its Keyframes are mirrored** when Reverse is switched on or off (`at → length − at`, each span's Ease turned to match), so its motion stays on the same frames of the video, as a Speed change scales them.
- **A reversed Source Segment has no captions.** Speech played backwards can't be read.
- **Its Scenes are the forward ones, mirrored.** The analysis of the same range (`analysis/<start>-<end>`) is used with its times turned (`t → length − t`) and its camera path run backwards. A Layout Override still applies to the Scene that holds its Source time. No new analysis is run.

**Freeze frame.** A Segment that holds one frame for its `hold` seconds.
- **It is a Segment with `hold`.** `start` is the frame's time in the Source or the video, and `end` equals `start`. Its length on the Timeline is `hold`.
  - Silent; the Music Clips play on over it.
  - No captions, no Word snapping. Speed, pitch and Reverse don't apply.
  - The ends of the Segments beside it that touch its frame stay there, not snapped to Words.
- **Made from the playhead.** "Freeze frame" (Shift+F) on the Segment under the playhead, at least 0.3 s from its edges on the Timeline:
  - The Segment is split there into a head, a Freeze frame of 1 s and a tail. The frame is the one shown at the playhead, at any Speed or in Reverse; head and tail meet on it, a Source Segment's too (not between Words).
  - The Main Track gets 1 s longer at the playhead; the layers after it follow while the Magnetic timeline is on, as an inserted Segment's do.
  - A Transition after the Segment stays after its tail. None is added inside.
  - Segments only. Overlays have no Freeze frame.
- **It looks as the Segment did at that moment:**
  - of the Source: the Layout of the Scene holding `start`, its panels' crop and camera held there; no Keyframes (a keyed Manual Scene's are sampled at the frame);
  - of a video: the Segment's Framing, with its Keyframes sampled at the frame becoming the constants. It may then get Keyframes of its own (a slow zoom into the still), as any media Segment can.
- **No still file is kept.** The render takes the one frame from the video and holds it; the preview holds a paused video at that frame.
- **Its length is changed** by dragging either edge (the frame stays) or the Duration field in the inspector: at least 0.1 s, the Clip at most the longest clip. Ripple follows the Magnetic timeline. Transitions may join into and out of it.

**The preview.**
- **A Segment or Overlay at Speed plays at it.** Its videos' `playbackRate` is Speed × the preview rate (0.5–2×) and `preservesPitch` is the opposite of "Change pitch with speed".
- **Outside 0.25–4×, and in Reverse, the preview plays a Retimed copy:** the proxy retimed (and reversed) with the sound as the render will make it, played at the preview rate. Browsers mute or stutter beyond that range.
- **While a copy is being made,** its Segment shows the first frame it will show, held, with its progress ("Reversing… 40%"), and the Timeline time runs on so the rest stays in sync.
- **A Freeze frame** shows its video paused at its frame for its `hold`.

**The Timeline.**
- **Filmstrip and Waveform follow what is shown.** A tile shows the frame at `start + (x ÷ pps) × speed`, or counted from `end` in Reverse, from the same forward chunks (ADR 0005). The Waveform is squeezed or stretched by the Speed and mirrored in Reverse. A Freeze frame repeats its one frame and has no Waveform.
- **A badge on the Segment** says its Speed ("2×"), its Reverse (◀) or its hold (❚❚ 1 s).

**Editing (the Advanced Edit).**
- **A Speed section** in the inspector of a Segment or a video Overlay picked alone:
  - chips 0.25 · 0.5 · 1 · 1.5 · 2 · 4;
  - a logarithmic slider 0.0625–16 and a number field (×);
  - the switch "Change pitch with speed";
  - the switch Reverse (R), with the Retimed copy's progress.
  - A Freeze frame shows its Duration instead.
- **Freeze frame** among the item tools (Shift+F). F stays full screen.
- **On a phone,** a Speed button in the toolbar opens a Speed sheet for a Segment or video Overlay picked alone; Freeze frame sits with Split.
- **The clip editor has no Speed control.** It plays and shows sped, reversed and frozen Segments, and gives way to the Advanced Edit for them as it does for a cut Clip.

**The agent.** Segments get `speed`, `pitch`, `reverse` and `hold`; Overlays `speed`, `pitch` and `reverse`. They go through `edit_candidate` and `merge_candidate_items` like any field; no new tool. The MCP instructions say how a Segment's Timeline length follows from its Speed and how to make a Freeze frame (split the Segment, put a held one between). The dry run lists each Segment's span on the Timeline.

## User Stories

**Speed**

1. As an owner, I want to slow a Segment down, so that a reaction or a punchline lands.
2. As an owner, I want to speed a Segment up, so that a long setup passes in a few seconds.
3. As an owner, I want to pick a common speed from chips (0.5×, 2×), so that I don't have to type one.
4. As an owner, I want to type any speed from 0.0625× to 16×, so that I can match a beat exactly.
5. As an owner, I want the voice at its own pitch at any speed by default, so that sped-up speech stays intelligible.
6. As an owner, I want to let the pitch follow the speed, so that I can make a chipmunk or slowed-down voice on purpose.
7. As an owner, I want the captions of a sped Segment in time with its speech, so that the words still match.
8. As an owner, I want my Word Edits to stay on their Words at any speed, so that a correction isn't lost.
9. As an owner, I want the Clip to close up or open out when a Segment's speed changes, so that the Main Track never gets a gap.
10. As an owner, I want my Text Layers, Music, Overlays and hook to follow that change while the Magnetic timeline is on, as they follow a trim.
11. As an owner, I want a media Segment's motion to stay on the same frames when I change its speed, so that a zoom still lands on the same detail.
12. As an owner, I want to speed up or slow down a video Overlay, so that a picture-in-picture moves at the pace I want.
13. As an owner, I want the Segment's ends to still snap to Words when it is sped, so that it never starts mid-word.
14. As an owner, I want the preview to play at the speed the Clip will render at, sound included, so that I judge it as it will be.
15. As an owner, I want the Filmstrip and Waveform of a sped Segment to show what plays where, so that I can trim it by eye.
16. As an owner, I want a badge with the speed on the Segment, so that I see at a glance which are sped.

**Reverse**

17. As an owner, I want to play a Segment backwards, so that I can make a rewind beat.
18. As an owner, I want to reverse a video Overlay, so that a picture-in-picture can rewind too.
19. As an owner, I want to see the progress while a reversed copy is made, so that I know when the preview will show it.
20. As an owner, I want a reversed Segment of the episode framed as it is forwards, so that its faces stay in frame.
21. As an owner, I want no captions on a reversed Segment of the episode, so that no garbled words show.
22. As an owner, I want to split or trim a reversed Segment without waiting again, so that editing stays quick.
23. As an owner, I want reverse and speed together, so that a rewind can be fast or slow.

**Freeze frame**

24. As an owner, I want to freeze the frame at the playhead for a second, so that a face or a moment holds while the music goes on.
25. As an owner, I want the frozen frame framed as the Segment was at that moment, so that it doesn't jump.
26. As an owner, I want to make a Freeze frame longer or shorter by dragging its edge, so that it holds for the beat I want.
27. As an owner, I want to zoom slowly into a frozen frame of a video, so that the still feels alive.
28. As an owner, I want a Transition into and out of a Freeze frame, so that it can fade in like any Segment.

**The agent**

29. As the agent, I want to set a Segment's or Overlay's speed, pitch and reverse with the tools I already use, so that I can retime a Clip.
30. As the agent, I want to see each Segment's span on the Timeline in the dry run, so that I can place layers after a speed change.
31. As the agent, I want to make a Freeze frame by splitting a Segment and putting a held one between, so that I can hold a moment.

## Implementation Decisions

**The Candidate model.**
- **On the Segment:**
  - `speed`: 0.0625–16, 1 by default;
  - `pitch`: whether the pitch changes with the speed, false by default;
  - `reverse`: false by default;
  - `hold`: seconds, none by default. With a `hold`, `end` equals `start`, `speed` is 1 and `pitch` and `reverse` are false; anything else is refused. A held Source Segment has no Keyframes; a held media Segment may have picture Keyframes, not volume ones.
- **On the Overlay:** `speed`, `pitch` and `reverse`, for a video. An image's are refused.
- **One function for a Segment's Timeline length** (`hold`, or `(end − start) ÷ speed`, rounded to 6 decimals). `timeline_length`, `transition_overlap`, `check_length`, `Candidate.duration`, the planner's main-track loop, `editor.py`'s preview words, render progress and the MCP's plan view use it. The overlap is worked out from Timeline lengths everywhere (today `candidates.py` uses Source lengths and the planner Timeline spans; they agree only at 1×).
- **Keyframes are checked against the Timeline length.** `at` is still seconds from the item's start on the Timeline (ADR 0008).
- **A one-Segment Clip with a Speed, Reverse or hold is stored as its `segments`,** not folded back into `start`/`end` as ADR 0002 stores an uncut Clip.
- **Validation.** `bounds()` and the longest-clip limit apply to a Source Segment's range as today; `check_length` to the Timeline. A held Segment isn't snapped, nor the end of a Source Segment played next to a held one of its frame. A media Segment's minimum (0.1 s) is on the Timeline. `_check_media_of` checks an Overlay's end against `(duration − offset) ÷ speed`.
- **Revisions, the client merge, the Clipboard and `RenderedClip`** carry the new fields with the items, by id, as they do the others. No new Revision part.

**One mapping between Timeline time and Source time per Segment**, in Python and in TypeScript, pinned by a shared fixture as the Keyframe sampler is (ADR 0008):
- forward: `source = start + (t − timeline_start) × speed`;
- in Reverse: `source = end − (t − timeline_start) × speed`;
- held: `source = start`.

Its inverse places Words, Word Edits, Layout Overrides and Scenes on the Timeline. The planner's `SegmentPlan` carries `speed`, `reverse` and `hold`, so that the preview's `Playback`, `ScenesTrack.sourceTime`, the Skim, the Loop Region's wrap, split, trim and the Filmstrip read one rule. It replaces the inline `source_start + (t − start)` in `planner.py`, `rendering.py`, `editor.py`, `renderer.py`, `frames.py`, `playback.ts`, `follow.ts`, `loop.ts`, `actions.ts`, `MainTrack.tsx`, `keying.ts`, `clipboard.ts` and `timelineView.ts`.

**The planner.**
- **Words** of a forward Source Segment are placed by the mapping's inverse; a reversed one gets none. Word Edits are matched as today, by Source time.
- **Scenes** of a forward Segment are the analysis's, scaled by `1 ÷ speed`; of a reversed one, mirrored and scaled; the camera path likewise. Layout Overrides apply by Source time.
- **A held Source Segment** is one Scene: the Layout of the Scene holding `start` (an override there, or the Candidate's), its panels and camera at that instant.
- **A held media Segment** takes its Framing's sampled values at its frame as the constants when it is made (by the editor); the planner draws it as any media Segment.

**The renderer.**
- **Picture at Speed:** `setpts=(PTS-STARTPTS)/speed`, then the Clip's frame rate (frames are dropped or repeated; no frame blending).
- **Sound at Speed:**
  - pitch kept: a chain of `atempo` stages, each within 0.5–2 (4× is 2, 2; 0.25× is 0.5, 0.5), as Concat's `tempo_stages`;
  - pitch changed: `aresample=48000,asetrate=48000*speed,aresample=48000`;
  - then the Segment's volume and volume Keyframes, which are in Timeline seconds;
  - the mixed soundtrack ends in `aresample=48000`, which Concat found keeps fractional `atempo` timestamps from cutting the soundtrack short.
  - The loudness pass (`_measure`) builds the same chain; it shares `_source_inputs` and `_audio_mix`.
- **Reverse:** the item's input is its full-size Retimed copy, read at `b − d` for a range `c..d` of a copy of `a..b`, then sped as above.
- **A held Segment:** its video at `-ss start`, one frame, `tpad=stop_mode=clone` for `hold` seconds; its sound `anullsrc` for as long.
- **Overlays** at Speed or in Reverse are read the same way, and their sound (`overlay_sound`) gets the same chain.
- **A keyed picture's frame process** (`frames.VideoDecode`) reads its frames through the same mapping.
- `check_ffmpeg` also requires `atempo`, `asetrate`, `aresample`, `tpad`, `setpts`, `settb`, `reverse`, `areverse`, `apad` and `atrim`.

**Retimed copies.**
- **What:** a file of a range of a Source or a media item, reversed, or (for the preview only) retimed at a Speed outside 0.25–4×, with its sound made as the render makes it.
- **Where:** `jobs/<id>/retimed/` and `media/<id>.retimed/`, named by kind, size (`preview` or `full`), range in ms, and for a retimed one its Speed and pitch. A Source or media item never changes under its id, so a copy is never stale (as ADR 0005's chunks).
- **Lookup:** any reversed copy of the same item and size whose range covers the one wanted.
- **Making:** ffmpeg over short pieces of the range (each `reverse`/`areverse`), joined last to first, then written under a temporary name and renamed when complete. Off the Worker, behind its own lock, at low priority, as ADR 0005's on-demand chunks; a render makes its full-size one inside the render.
- **Progress** is reported to the editor, which shows it on the Segment and in the Speed section.
- **Cleanup:** removed with their Job or media item; when a Job is opened, copies that no Candidate of it, nor any state in their Revision History, uses are removed.

**The preview (`Playback`, ADR 0006).**
- A Source Segment at a Speed within 0.25–4× plays on the decks with `playbackRate` = Speed × the preview rate and `preservesPitch` = not `pitch`; `read()` maps its master's time through the mapping.
- A Segment played from a Retimed copy gets its own master and follower, parked at its start like a media Segment's video, so a reversed Segment of the Source keeps its Split or Blur panels.
- A held Segment parks a deck (or its video) paused at its frame; its time runs on a clock, as a media Segment's does.
- Overlay videos and their sound (`follow`, `PreviewMusic`) get the same rate, pitch and copies.
- The Transition ghost plays the outgoing Segment the same way.

**The Advanced Edit.**
- **Speed change** (`setSpeed`): sets the field, scales the item's Keyframes by `old ÷ new`, and ripples as a trim of the right edge (Segments; `rippledIf` with the Timeline length's change).
- **Trim:** the drag's seconds × Speed move the range's end (or its start, in Reverse, for the right edge). A held Segment's edges change `hold`.
- **Split** maps the cut through the mapping; the Source cut goes to the gap between Words as today. Both halves keep `speed`, `pitch` and `reverse`; in Reverse the left half on the Timeline is the later part of the range.
- **Freeze frame** (`freezeFrame`): split at the playhead, insert the held Segment, ripple an insertion of `hold` at the playhead; Keyframes re-anchored on head and tail (ADR 0008), sampled into the held Segment's Framing for a video.
- **Filmstrip and Waveform** (`filmstripTiles`, `waveformLayer`, `chunksAcross`) read through the mapping.
- **Shortcuts:** R for Reverse, Shift+F for Freeze frame, on the keymap and in the shortcuts sheet.

**The MCP server.** New fields flow through `CandidateUpdate` and `_PATCHES`. The instructions get a paragraph on Speed, Reverse and Freeze frames. The dry run lists each Segment's Timeline span. As with Keyframes (ADR 0008), the server doesn't re-anchor: a speed change that leaves a Keyframe past the item's end is refused until the Keyframes are sent with it.

## Testing Decisions

Good tests here check what is seen and heard: where a Word or a Scene lands on the Timeline, the length and frames of a rendered Clip, the pitch of its sound, the Main Track after an edit, and what the API and MCP refuse. They don't check how a filter string is spelled.

- **The mapping (new, pure; pytest and vitest)** over a shared fixture: forward, sped, reversed and held Segments, Timeline → Source and back, and Timeline lengths with Transitions.
- **The planner:** Words of a 2× Segment at half their offsets; none on a reversed Source Segment; Scenes of a reversed Segment mirrored; a Word Edit found at 0.5×; a held Segment's one Scene with the Layout of its instant; the overlap from Timeline lengths.
- **The renderer (short real renders of a generated test video with a frame counter and a tone):**
  - a 2× Segment lasts half as long and shows every other frame;
  - a 0.5× Segment with pitch kept has the tone at its frequency; with `pitch` at half;
  - a reversed Segment's frame counter counts down; its tone sweep runs backwards;
  - a held Segment repeats one frame for `hold` and is silent;
  - the soundtrack is as long as the picture at 1.5× (the `aresample` guard).
- **Retimed copies:** a copy of `a..b` serves `c..d`; a missing copy is made by a render; the sweep keeps a copy used by a Revision and removes one used by none.
- **The editor (`actions` tests and the `Playback` harness):** a speed change ripples and scales Keyframes; split of a reversed Segment; Freeze frame splits, inserts and ripples; a trim at 2× moves the Source end by twice the drag; the fake clock reads a 2× Segment at twice the rate; a reversed Segment plays from its copy.
- **API and MCP:** refusals (speed out of range, a `hold` with `reverse`, Keyframes on a held Source Segment, an Overlay image's speed, a Clip over the longest on the Timeline, stranded Keyframes); the dry run's spans.

## Out of Scope

- **Speed curves and ramps,** time remapping. Concat has no editor for them either.
- **Speed on Music Clips and image Overlays.**
- **A Freeze frame on an Overlay,** and a Freeze frame as an image in the Media Library (image Segments stay out, as in the keyframes spec).
- **Captions on a reversed Segment of the Source.**
- **Speed in the clip editor.**
- **Frame blending or optical flow** for slow motion: frames are repeated.
- **`rubberband`** for the pitch. It is GPL and slower; `atempo` is what Concat uses.
- **Changing the pitch without the speed.**
- **Hiding captions at high speeds.** Captions are retimed at every Speed.

## Further Notes

- **Overturns the Out of Scope line on speed changes** in `.scratch/advanced-edit/spec.md` ("Speed changes, voiceover recording"). ADR 0009 records it and amends ADR 0002 (a Segment's Timeline length is its range's), ADR 0006 (one rate for the decks) and ADR 0008 (Keyframes are scaled when the Speed changes).
- **Where this differs from Concat:**
  - Reverse is a flag on the item, played from a derived copy. Concat replaces the clip's media with the copy ("X (reversed)"), which would cut a Source Segment off its Transcript, Word Edits and Layout Overrides.
  - A speed change that shortens a Segment closes up the Main Track; Concat leaves a gap. The Main Track here has none.
  - Keyframes are seconds, scaled on a speed change; Concat's are fractions of the clip.
  - A Freeze frame keeps no still file and is a held Segment, not an image clip.
  - The preview plays browser videos, so it uses `playbackRate` within 0.25–4× and copies beyond; Concat's engine decodes at any pace.
- **Choices made by default, not grilled.** Revisit them in review if they feel wrong:
  - the 6-decimal rounding of a Timeline length;
  - Retimed copies made off the Worker behind their own lock, as Source chunks are;
  - the pieces' length when reversing (a few seconds, to bound memory at full size);
  - preview copies only outside 0.25–4×, judged on the Speed alone (the preview rate of 0.5–2× keeps the rest under 8×);
  - a held Source Segment's Layout taken from the Scene holding its frame, with no analysis of its own;
  - the Speed section only for one picked item;
  - R and Shift+F as the shortcuts;
  - the sweep of unused copies when a Job is opened;
  - the chips 0.25 · 0.5 · 1 · 1.5 · 2 · 4.
- **The Worker runs one heavy tool at a time** (ADR 0005). Reversing a long range of the Source competes with transcription for the CPU, as Source chunks do; the lock and low priority keep that to one ffmpeg.
- **Roadmap:** item 7, `speed`, in the Advanced Edit v2 roadmap. It builds on `keyframes` (#6) and `navigation-playback`.
