# 04: A sped video Overlay

**Parent spec:** `spec.md` in this feature folder (user story 12; Solution "Speed": an Overlay keeps its place on the Timeline; Implementation Decisions "The Candidate model", "The renderer", "The preview"); ADR 0009.

**What to build:** the agent can give a video Overlay a Speed and pitch. It keeps its start and end on the Timeline and shows `(end − start) × speed` of its video from its offset, with its sound at the same Speed. Through MCP; the editor UI comes in 05.

- **Model.** `speed` and `pitch` on the Overlay, for a video; an image's are refused. Its end is kept within its video at `(duration − offset) ÷ speed` from its start, in the planner and the API's check.
- **Renderer.** The Overlay's read covers its span × Speed, its picture is sped as a Segment's, and its sound (when not muted) gets the 02 chain. A keyed video Overlay's frame decode reads through the same rate.
- **Preview.** The Overlay's video follows at `playbackRate` = Speed × the preview rate, mapping its time through its Speed; its sound plays at the same rate with `preservesPitch`.
- **MCP.** The fields through the edit tools and merge; the instructions' Overlay paragraph mentions them; the dry run's Overlay entry shows what of its video it reads.

**Blocked by:** 02.

**Status:** done

- [x] A 4 s video Overlay at 2× with offset 1 renders frames 1–9 s of its video over its 4 s.
- [x] An Overlay whose sped span would pass the video's end is clamped in the plan, and refused by the API when given past it.
- [x] Its unmuted sound at 0.5× keeps its pitch; with `pitch` on it is an octave lower.
- [x] A keyed video Overlay at 2× moves on the frames its Keyframes were set on.
- [x] The API and MCP refuse a Speed on an image Overlay.
- [x] The preview plays a 2× Overlay in sync with the render's frames at its start, middle and end (within a frame's drift).

## Comments

**2026-10-17: done.**

**What was built:**
- Model: `Overlay.speed` (the `Speed` type, 0.0625–16) and `Overlay.pitch`, after `volume`. Its Keyframes stay checked against `secs`, which a Speed doesn't change. `_check_media_of` refuses an Overlay whose `offset + secs × speed` passes its video's end ("… runs past the end of its video (10 s) at 2x") and a Speed or `pitch` on an image ("Overlay i is an image: it has no Speed or pitch"); MCP goes through the same check.
- Planner: `OverlayEvent` and `AudioEvent` carry `speed` and `pitch` (defaults 1 and false). `_overlay_event` cuts the end at `start + (duration − offset) ÷ speed`, and `overlay_sound` passes the event's Speed and pitch on, so the Overlay's sound is cut the same way. Music Clips (`audio_events`) have no Speed.
- Renderer: `_overlay_inputs` reads `(end − start) × speed` from `offset`; `_overlay` times the frames `setpts=(PTS-STARTPTS)/speed+start/TB` (unchanged at 1×, so the unkeyed command fixture holds). `_audio_mix` trims `length × speed` of the item, then `speed_filters`, then `asetpts` and the volume or volume Keyframes and fades in Timeline seconds; at 1× the chain is as before. `_feeds` gives a keyed video Overlay's `VideoDecode` `SegmentTime(offset, offset + (end − start) × speed, speed)`.
- **A fix outside the Speed:** `VideoDecode` now passes `-fps_mode passthrough`. Without it, rawvideo's muxer kept a constant frame rate from 0 and, for a video **with sound**, filled the time before the Overlay's start with copies of its first frame, so a keyed video Overlay starting later than 0 showed its first frame throughout (the earlier test's numbered video has no sound, so it never saw this). The keyed case of the 2× render test covers it.
- MCP: a sentence in the Overlay paragraph of the instructions; the dry run's Overlay entry of a video gives `source_start`, `source_end` (what of its video it shows) and `speed`/`pitch` when not the default (`_video_read`). The tool list is now 60 930 bytes of the 61 000 budget: **only 70 bytes are left for 03 and 06**, which add fields (06: `reverse` on the Segment and the Overlay) and will need the budget raised or the schemas trimmed.
- Preview: `follow.eventSpan` turns a plan's Overlay or sound event into `follow`'s span with its Speed and pitch. `PreviewOverlays` (the muted video) and `PreviewMusic` (the `<audio>` of the Overlay's sound) use it, so both play at Speed × the preview rate (clamped by `previewSpeed`) with `preservesPitch` = not `pitch`, their time read through the mapping.
- `api.ts`: optional `speed`/`pitch` on `Overlay`, `OverlayEvent` and `AudioEvent`.

**Tests:** `backend/tests/test_sped_overlays.py` (planner; API and MCP refusals and the dry run; real renders of a 10 s 30 fps frame counter with a 1 kHz tone: a 4 s Overlay at 2× from 1 s, and a keyed one, compared frame by frame with the stored video at the start, middle and end; its sound's tone to its end; pitch kept and an octave lower at 0.5×; volume Keyframes at 2× at their Timeline seconds). `playback.test.ts` "speed": a 2× Overlay's video on the render's frames at start, middle and end, and an Overlay's sound at 0.5× with and without `pitch`.

**Left for later:**
- The Advanced Edit's Overlay trim, split, clipboard and Filmstrip still read an Overlay's video 1:1 (`Tracks.tsx` start-edge trim, `actions.ts` cut, `clipboard.ts`): 05's.
- Outside 0.25–4× the preview plays at the nearest of those and is moved back when it drifts, as 02's media Segments: 09's copies.
