# 03: Keyed volume for Music Clips and Overlay sounds

**Parent spec:** `spec.md` (user stories 11–13, 15, 42; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Preview", "MCP").

**What to build:** a Music Clip's volume, and a video Overlay's sound, can have Keyframes. The song can dip under a sentence and come back up. Its fade in and fade out still work, multiplying the curve. The Volume Line and the Waveform on the Timeline follow it, in the preview and in the Clip alike. Editing them by hand comes in 06 and 08: this is driven through MCP and the API.

- **Model.** `keys` with `volume` on the Music Clip, and on the Overlay for a video only. A volume Keyframe on an image Overlay is refused.
- **Planner.** A sound's plan event carries a gain track in seconds from its start. Its fades multiply it.
- **Renderer.** A keyed volume is an ffmpeg volume expression, evaluated per 480-sample block, in the item's own chain after it is trimmed and its time reset. Each eased span is resampled into 24 linear steps. The fades come after it, as today.
- **Preview.** A keyed sound sets its gain node from the track, sampled at 100 Hz from the playhead, on play and on every seek. The Timeline's gain curve takes the track, so the Volume Line and the Waveform follow it.
- **MCP.** The same `keys` shape, refusals and dry run as 01, for volume.

**Blocked by:** 01

**Status:** done

- [x] Seam B: a Music Clip's volume Keyframes come out as its sound event's gain track, in its own seconds; an Overlay video's do too.
- [x] Seam A, real ffmpeg: a tone under a Music Clip keyed from 1 to 0.25 has, at the midpoint, the RMS that the sampled gain predicts, within 0.5 dB, with a fade in still applied at its start.
- [x] Seam A, HTTP: a volume Keyframe on an image Overlay is refused; a volume of 2.5 is refused.
- [x] Seam E: the Volume Line's height along a Music Clip with volume Keyframes, including its fades.
- [ ] The preview's dip is heard where the rendered Clip's is (checked by hand once). Checked by tests only (see Comments); listening in the browser is left for 11's walkthrough.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done, but for the check by hand.** Built at each seam test first, in `backend/tests/test_keyed_volume.py` and the frontend's `timelineView.test.ts` and `editor/loudness.test.ts`.

- **Model.** `MusicClip.keys` (moved below the Keyframe definitions in `backend/app/candidates.py`) is checked in its `__post_init__` against the new `SOUND_KEYS` (`volume` only) and its `secs`, so a stranding `secs` is refused as an Overlay's is ("Music Clip m's volume Keyframe at 1 s is past its length of 0.5 s; send its keys too"). `Overlay.keys` takes `PICTURE_KEYS + SOUND_KEYS`. The model can't tell an image from a video, so `_check_media_of` (`api.py`) refuses a volume Keyframe on an image ("Overlay o has no volume Keyframes: an image has no sound"). 01's two refusals there (picture keys on a video, picture keys with decoration) now look only at picture properties (`moved`), so a video Overlay keyed in volume alone is accepted, decorated or not; 02 lifts those two lines.
- **Planner.** `AudioEvent` gained `gain` (the item's volume Keyframes as they are, in seconds from the event's start, which is the item's start) and `id` (the Music Clip's or Overlay's). `audio_events` and `overlay_sound` fill them; an Overlay muted at its constant but keyed is heard. `gain_at(event, time)` (Clip time) is the rule: the track (or `volume`) times the fades' linear ramps. `moving` keeps only `PICTURE_KEYS` in a picture's motion, so a volume key never makes a picture keyed.
- **Renderer.** `_volume(gain, volume)` in `renderer.py` gives `volume=<v>` unkeyed, else `asetnsamples=n=480:p=0,volume=volume='v0+dv*clip((t-t0)/dt,0,1)+…':eval=frame`, placed where `volume=` was in `_audio_mix` (after `atrim` and `asetpts=PTS-STARTPTS`, before the `afade`s and `adelay`). The points come from `linear_steps(keys, steps=24)` in `app/keyframes.py` (an eased span in 24 straight steps, a linear one in one). Spans with no change add no term. `_measure` goes through the same `_audio_mix`, so the loudness is measured on the keyed curve. The unkeyed golden command is unchanged.
- **Preview.** `frontend/src/pages/job/editor/loudness.ts`: `loudness(event, time)` (the copy of `gain_at`) and `loudnessCurve(event, time)` (100 values a second from the playhead to the event's end, at least two). In `PreviewMusic.tsx`, a keyed event goes through `followCurve`: while playing with a running AudioContext it `cancelScheduledValues(0)`, then `setValueCurveAtTime(curve, now, (n − 1) / 100 / rate)`. It reschedules on play, on a seek (the time more than `MAX_DRIFT_SECS` from where the curve has got to), at a new rate and for a new plan (another event object). Paused, skimming or without Web Audio, it sets the value at the time. `setVolume` cancels a scheduled curve before it sets a value, so the two never overlap. Unkeyed events work as before.
- **Timeline.** `gainAt` in `advanced/timelineView.ts` takes a `Heard` with optional `keys`; `volumeLine(heard)` gives the keyed Volume Line's points (120 across, plus each Keyframe and each fade's end), heights by `volumeHeight` of the gain through the fades. In `Tracks.tsx` a Music Clip with volume Keyframes draws its Volume Line as that polyline (an SVG over the item), with no drag handle (08 makes the drag write a Keyframe). Its Waveform takes the same `heard`, and the item hides its constant's % label. `MusicClip.keys` and `AudioEvent.gain`/`id` are required in `api.ts`; a new Music Clip has `keys: {}`.
- **MCP.** `keys` on `music` comes in through `_patch_model` and merges by property as an Overlay's do. `_plan_view` gains `sounds` (only when a sound is keyed): `{id, media, start, end, keys: {volume: [...]}}` in Timeline time with preset names (`_keys_view`, which `_motion_view` now uses too). The instructions' Keyframes paragraph names the keyed volumes (0..2, the fades multiply) and `sounds`. The tool list is 58.9 kB of its 60 kB budget (58.2 kB before; the schema of `music`'s `keys`). No wording was trimmed.

Choices:
- **The curve is set only for keyed sounds.** Unkeyed Music Clips still set their gain once a frame, as before, so nothing changes for them.
- **The keyed Volume Line includes the fades,** as the ticket's Seam E asks, so it drops to the bottom at a fade's ends. The unkeyed line stays flat at the volume, beside its Fade Ramps.
- **The render test separates the song by its frequency.** The Source's own 440 Hz tone stays steady, so loudnorm stays linear. The song's 880 Hz tone is measured by a DFT over 50 ms windows, which hold a whole number of both tones' cycles. At the midpoint of a 1 → 0.25 ease-in dip, the level is within 0.5 dB of the sampled gain (0.763). It fails by 1.7 dB when the span is drawn as one straight line, so the test tells the Ease from a ramp. A fade-in window (0.225 s) and a late window (1.8 s) are checked too.

Not checked by hand: hearing the preview's dip in the browser against the rendered Clip. What stands in for it: `loudness.test.ts` and `test_keyed_volume.py` work the same example (a dip from 1 to 0.25, eased in, under a 0.5 s fade in and a 1 s fade out) to the same numbers on both sides (0.7635 halfway), and the render test measures the rendered level against `value_at`. Not tried in a browser: `setValueCurveAtTime` itself (scheduling on play and seek, and at another rate).
