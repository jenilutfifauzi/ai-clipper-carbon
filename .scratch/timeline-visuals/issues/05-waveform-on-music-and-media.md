# 05: Waveform on Music Clips and media Segments

**Parent spec:** `spec.md` in this feature folder (user stories 16–18, 20–23; Implementation Decisions "Derived media" (Peaks), "API contract", "A new pure module for the Timeline's view (Seam E)", "Drawing"). See ADR 0005.

**What to build:** Music Clips show their song's Waveform across their body. Media Segments with sound show a thin Waveform along the bottom of the Video row. Both are drawn as they will be heard, scaled by the item's volume and (for Music Clips) its fades, and they redraw when those change in the inspector. A Music Clip that starts partway into its song shows the part that plays.

- **Backend.**
  - The upload's normalize pass also writes the item's Peaks chunks: mono, 48 kHz, 1000 buckets per second, min/max as int8, in the layout the spec gives (following Concat's `peaks.rs`).
  - `GET /api/media/{id}/peaks/v1/{start}.peaks` serves a chunk with immutable cache headers. Older items are filled in on request under the on-demand lock.
  - It answers 404 for an image, a silent video, or an off-grid or out-of-range `start`.
  - Deleting the item deletes its Peaks.
- **Seam E:**
  - the chunks a Music Clip needs, from its song's offset;
  - the Peaks pyramid (halving down to 64 buckets or fewer) and the level for a zoom: the coarsest with at least one bucket per device-pixel column;
  - the gain at a time: volume × fade-in ramp × fade-out ramp (linear).
- **Drawing:**
  - the media cache keeps Peaks for the session, with their pyramids built once;
  - the canvas draws min/max bars per column, scaled by the gain;
  - on a media Segment, the Waveform is a semi-transparent strip in the bottom 14px, over its Filmstrip;
  - on a Music Clip, it fills the body, and the name and volume % stay.

**Blocked by:** 03 (Filmstrip on media Segments).

**Status:** ready-for-agent

- [ ] Seam A (real ffmpeg):
  - uploading a 2-second video with a tone gives a Peaks chunk of count 2000;
  - every min is ≤ 0 and every max ≥ 0, and the peaks are near the tone's amplitude;
  - a silent video and an image give 404;
  - a missing chunk is made on request.
- [ ] Seam E (vitest):
  - chunks for a Music Clip with an offset;
  - the level at 1× on a phone width (coarse) and at 40× on a desktop width (finest), never below one bucket per column;
  - the gain at the middle of a fade in, at both ends, and with fades meeting.
- [ ] In the browser, a Music Clip's Waveform follows a change of volume or fade made in the inspector.
- [ ] `npm run typecheck`, `npm test`, `npm run build` and the backend's tests pass.
