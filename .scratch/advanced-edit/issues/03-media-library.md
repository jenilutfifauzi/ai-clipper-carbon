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

**Status:** ready-for-agent

- [ ] API tests: each kind uploads, and bad, oversized or too-long files are refused.
- [ ] API tests: list, serve, proxy, and delete.
- [ ] Delete refused while a Candidate refers to the item (exercised once 04 adds a reference; until then unit-test the usage lookup).
- [ ] Typecheck and build; browser upload on desktop and phone.

## Comments
