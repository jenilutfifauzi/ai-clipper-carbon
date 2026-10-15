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

**Status:** ready-for-agent

- [ ] Seam A (real ffmpeg):
  - chunk count and layout;
  - off-grid starts give 404;
  - two concurrent requests for one chunk both succeed and leave one file.
- [ ] Seam E (vitest): a Source Segment's gain follows the Clip's own sound's volume.
- [ ] In the browser, the speech's Waveform shows pauses, and it follows a change of the Clip's own volume.
- [ ] `npm run typecheck`, `npm test`, `npm run build` and the backend's tests pass.
