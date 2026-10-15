# 04: Filmstrip on Source Segments

**Parent spec:** `spec.md` in this feature folder (user stories 1, 3–8, 10–12, 50; Implementation Decisions "When chunks are made" (Sources), "API contract"). See ADR 0005.

**What to build:** Source Segments fill the Video row with the Source's frames as it is (not framed by the Layout), one per whole second. The Scenes row under them keeps its Layout labels. Frames are made the first time a stretch of the Source is shown, without blocking the Timeline. Every Candidate of the Job then reuses them, and the browser caches them.

- **Backend.**
  - `GET /api/jobs/{id}/filmstrip/v1/{start}.jpg` serves a chunk of the Source, on the same grid and in the same format as media chunks, with `X-Frames` and immutable cache headers.
  - A missing chunk is made on request under the on-demand lock from ticket 03 (one ffmpeg at a time, at low priority, on one thread, outside the Worker).
  - It reads the Job's browser-playable proxy when there is one, otherwise the Source, seeking to the chunk's start.
  - It answers 404 for an off-grid or out-of-range `start`, or an unknown Job.
- **Seam E:** the chunks a Source Segment needs, from its range of the Source.
- **Drawing:** the canvas from ticket 03, filling the Video row (56px) of each Source Segment.

**Blocked by:** 03 (Filmstrip on media Segments).

**Status:** ready-for-agent

- [ ] Seam A (real ffmpeg, a tiny Source made with `lavfi`):
  - chunk counts and the last chunk's frames;
  - off-grid and out-of-range starts give 404;
  - a second request leaves the chunk's file unchanged;
  - two concurrent requests for one chunk both succeed and leave one file.
- [ ] Seam E (vitest): a Source Segment from 28 s to 95 s needs chunks 0, 30, 60 and 90.
- [ ] In the browser, Source Segments show frames at every zoom while the Scenes row keeps its labels, and a second Candidate of the Job shows them at once.
- [ ] `npm run typecheck`, `npm test`, `npm run build` and the backend's tests pass.
