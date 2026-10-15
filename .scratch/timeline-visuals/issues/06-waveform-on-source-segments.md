# 06: Waveform on Source Segments

**Parent spec:** `spec.md` in this feature folder (user stories 19, 21, 23, 50; Implementation Decisions "When chunks are made" (Sources), "Drawing"). See ADR 0005.

**What to build:** Source Segments show the speech's Waveform as a thin strip along the bottom of the Video row, over their Filmstrip. It is scaled by the Clip's own sound's volume, so it follows that volume when it changes in the inspector.

- **Backend:**
  - `GET /api/jobs/{id}/peaks/v1/{start}.peaks` serves a Peaks chunk of the Source, in the same format as media Peaks;
  - a missing chunk is made on request under the on-demand lock, from the proxy when the Job has one;
  - it answers 404 for an off-grid or out-of-range `start`, a Source without sound, or an unknown Job.
- **Seam E:** the gain for a Source Segment is the Clip's own sound's volume, with no fades.
- **Drawing:** the same 14px strip as media Segments, from ticket 05.

**Blocked by:** 04 (Filmstrip on Source Segments), 05 (Waveform on Music Clips and media Segments).

**Status:** done

- [x] Seam A (real ffmpeg):
  - chunk count and layout;
  - off-grid starts give 404;
  - two concurrent requests for one chunk both succeed and leave one file.
- [x] Seam E (vitest): a Source Segment's gain follows the Clip's own sound's volume.
- [ ] In the browser, the speech's Waveform shows pauses, and it follows a change of the Clip's own volume.
- [x] `npm run typecheck`, `npm test`, `npm run build` and the backend's tests pass.

## Comments

**2026-10-15: done.** Built as specified: `GET /api/jobs/{id}/peaks/v1/{start}.peaks` in `backend/app/api.py`, beside the Source's Filmstrip, on `derived.py`'s grid and `make_peaks` (so under the on-demand lock), and on the Timeline the Waveform layer from 05 added to `SourceFilmstrip`'s canvas in `Tracks.tsx`, as the same 14px strip as media Segments'. Choices made on the way:
- Chunks are kept at `jobs/<id>/peaks/v1-b1000/<start>.peaks`, as the ADR says, read from `preview.mp4` when the Job has one, otherwise the Source.
- The Source's metadata doesn't say whether it has sound: a Source without it is known when ffmpeg finds no sound to map, and answers 404, as a chunk ffmpeg can't make does. The media cache remembers a failed chunk, so a silent Source is asked once per chunk.
- `make_peaks` read the first chunk 21 ms late: a seek to 0 in an AAC drops its first 21 ms as well as the encoder's priming. The first chunk is now read without a seek, which also mends the first chunk of a media item uploaded before Peaks.
- Seam E's `sourceGain` is the Clip's own sound's volume times the Segment's own `volume` (1 unless set), as the renderer hears it; the Segment's label over its frames uses it too.
- Seam A's speech is a tone that pauses for 5 s in every 10, so the test checks the pauses land where they are in the Source.

Not seen in a browser yet: left for the walkthrough (09).
