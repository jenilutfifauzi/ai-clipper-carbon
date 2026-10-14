# 03: Media Library

**Parent spec:** `spec.md` in this feature folder (user stories 8, 16).

**What to build:**
- **Store:** `MediaStore` in `DATA_DIR/media/` (`<id>.<ext>` plus `media.json`), modelled on `logos.py`.
- **Accepted uploads and limits:**
  - Video: MP4, MOV or WebM, at most 500 MB and 3 minutes.
  - Audio: MP3, M4A, WAV or AAC, at most 50 MB.
  - Image: PNG, JPEG or WebP.
- **Normalization with ffmpeg:**
  - Video becomes H.264/AAC at 30 fps, with a 540p preview proxy.
  - Audio becomes AAC.
  - ffprobe records duration, size and has-sound.
- **API:**
  - `GET/POST /api/media`, `GET/DELETE /api/media/{id}`, `GET /api/media/{id}/proxy`.
  - `DELETE` returns 409 with the list of using Candidates (across Jobs) while the item is in use.
- **Workspace:** the Media and Audio tabs list, upload (with progress, also from a phone) and delete items.
- **Glossary:** add **Media Library**.

**Blocked by:** 01.

**Status:** done

- [x] API tests: each kind uploads, and bad, oversized or too-long files are refused.
- [x] API tests: list, serve, proxy, and delete.
- [ ] Delete refused while a Candidate refers to the item (exercised once 04 adds a reference; until then unit-test the usage lookup).
- [x] Typecheck and build; browser upload on desktop and phone.

## Comments

**2026-10-14: done**, except the in-use check, which is tested in 04 once a Candidate can refer to an item. `DELETE` already asks every Job's Candidates through `Candidate.media_ids()`.

**Checks:**
- `tests/test_media_library.py`: each kind uploaded and normalized (H.264/AAC 30 fps, AAC, PNG); the proxy and thumbnail; refusals of what isn't media, a video over 3 minutes and a file over its size; delete with its files.
- `npm run build`.
- In the browser, a 4 s video and a 12 s song were uploaded through the Media and Audio tabs, then listed with a thumbnail and with their length.

**Changes from the plan:**
- The kind is told by ffprobe, not by the file's name. A song's cover picture doesn't make it a video.
- One decode writes the kept video, its 640 px proxy and its thumbnail.
- Songs are at most 10 minutes long.
- The upload endpoint isn't async, so the copy and the conversion run in a worker thread.
