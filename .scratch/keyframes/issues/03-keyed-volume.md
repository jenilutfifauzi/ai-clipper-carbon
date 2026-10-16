# 03: Keyed volume for Music Clips and Overlay sounds

**Parent spec:** `spec.md` (user stories 11–13, 15, 42; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Preview", "MCP").

**What to build:** a Music Clip's volume, and a video Overlay's sound, can have Keyframes. The song can dip under a sentence and come back up. Its fade in and fade out still work, multiplying the curve. The Volume Line and the Waveform on the Timeline follow it, in the preview and in the Clip alike. Editing them by hand comes in 06 and 08: this is driven through MCP and the API.

- **Model.** `keys` with `volume` on the Music Clip, and on the Overlay for a video only. A volume Keyframe on an image Overlay is refused.
- **Planner.** A sound's plan event carries a gain track in seconds from its start. Its fades multiply it.
- **Renderer.** A keyed volume is an ffmpeg volume expression, evaluated per 480-sample block, in the item's own chain after it is trimmed and its time reset. Each eased span is resampled into 24 linear steps. The fades come after it, as today.
- **Preview.** A keyed sound sets its gain node from the track, sampled at 100 Hz from the playhead, on play and on every seek. The Timeline's gain curve takes the track, so the Volume Line and the Waveform follow it.
- **MCP.** The same `keys` shape, refusals and dry run as 01, for volume.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Seam B: a Music Clip's volume Keyframes come out as its sound event's gain track, in its own seconds; an Overlay video's do too.
- [ ] Seam A, real ffmpeg: a tone under a Music Clip keyed from 1 to 0.25 has, at the midpoint, the RMS that the sampled gain predicts, within 0.5 dB, with a fade in still applied at its start.
- [ ] Seam A, HTTP: a volume Keyframe on an image Overlay is refused; a volume of 2.5 is refused.
- [ ] Seam E: the Volume Line's height along a Music Clip with volume Keyframes, including its fades.
- [ ] The preview's dip is heard where the rendered Clip's is (checked by hand once).
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
