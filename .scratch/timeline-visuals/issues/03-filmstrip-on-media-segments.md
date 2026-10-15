# 03: Filmstrip on media Segments

**Parent spec:** `spec.md` in this feature folder (user stories 2–6, 9–10, 13–15, 48–49, 51; Implementation Decisions "Derived media", "API contract", "When chunks are made" (media items), "A new pure module for the Timeline's view (Seam E)", "Drawing"). See ADR 0005.

**What to build:** a media Segment of a video shows its own frames along it on the Timeline, one per second of the item, instead of its first frame tiled. Videos uploaded from now on have their frames ready when the upload finishes. Videos uploaded before have them made on first view. This ticket lays the drawing path (cache, windowed canvas) that the other Filmstrip and Waveform tickets reuse.

- **Backend.**
  - The upload's normalize pass also writes the item's Filmstrip chunks, as ADR 0005 and the spec say: 30-second chunks of frames at each whole second, 112px tall, JPEG at quality 75, written to a temporary file and then renamed.
  - `GET /api/media/{id}/filmstrip/v1/{start}.jpg` serves a chunk, with `X-Frames` and immutable cache headers.
  - A missing chunk of an older item is made on request, under the on-demand lock (one ffmpeg at a time, at low priority, on one thread, outside the Worker). The request rechecks the cache once it holds the lock.
  - It answers 404 for an off-grid or out-of-range `start`, an image item, or an unknown id.
  - Deleting the item deletes its chunks.
- **Seam E:**
  - the chunks a media Segment needs for its visible range;
  - the frame each tile shows: the item's time under the middle of the tile's visible part, rounded to the nearest second.
- **The media cache held by the Advanced Edit:**
  - at most two chunk requests at a time; queued requests that leave the margin are dropped;
  - bitmaps decoded at the row's height × the device pixel ratio;
  - an LRU of 12 decoded chunks, released on eviction.
- **One canvas per media Segment,** windowed:
  - it covers the visible part plus half a viewport each side, at most 4096 device pixels wide;
  - it redraws in an animation frame on scroll, zoom, edits or an arriving chunk, so a live trim and a move redraw it;
  - a chunk fades in over 150 ms;
  - until then, the item's single thumbnail shows, as today.
- **Image Segments are unchanged.**

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam A (real ffmpeg, as the Media Library tests):
  - uploading a 2-second video gives a chunk with `X-Frames: 2` that is 112px tall;
  - a 65-second video gives chunks of 30, 30 and 5 frames;
  - `start = 15`, `start = 90` and an image give 404;
  - removing an item's chunks and requesting one makes it again;
  - deleting the item removes its chunks;
  - answers carry immutable cache headers.
- [x] Seam E (vitest):
  - chunks for a media Segment's range;
  - the frame for a tile at 1× and at 40×, and for a tile half off-screen.
- [ ] In the browser, a media Segment shows its frames at every zoom, and they follow a trim and a move. A video uploaded before the feature fills in.
- [x] `npm run typecheck`, `npm test`, `npm run build` and the backend's tests pass.

## Comments

**2026-10-15: done.** Built as specified, in `backend/app/derived.py` (the chunk grid, the upload's Filmstrip outputs, and `make_strip` under the on-demand lock, for the Source's chunks in 04 and the Peaks in 05 and 06 to reuse) and, on the Timeline, `timelineView.ts` (Seam E), `mediaCache.ts`, `ItemCanvas.tsx` (the windowed canvas, drawn by layers) and `filmstrip.ts` (the Filmstrip's layer). Choices made on the way:
- A chunk's frame count is `ceil` of the length left, rounded to the millisecond first. The upload counts by the uploaded file's length and the API by the normalized one's; a chunk they would count differently is removed after the upload, to be made on request.
- The last picture is held for a second before the frames are taken, so a video whose sound runs past its picture still fills its last tile.
- Chunks made on request are read from the item's proxy.
- ffmpeg's JPEG scale has no "quality 75": `-q:v 5` stands for it.
- Seam E also has `tileWidth` and `canvasWindow` (the canvas's stretch and its 4096-pixel cap), with worked examples.
- A chunk evicted from the cache less than a second ago isn't fetched again at once, so more than 12 chunks on screen can't fetch one another out in a loop.

Not seen in a browser yet: left for the walkthrough (09).
