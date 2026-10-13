# 17: Upload master file

**Parent spec:** `spec.md` in this feature folder (Milestone M5; user stories 75–76; Video Source upload implementation).

**What to build:** Home gets an Upload option: I drag-drop or pick a master file, and it streams to disk with a progress bar. The Job transcribes the whole episode locally and reaches `review`. From there everything works exactly like a URL Job.

**Blocked by:** 03 (Full local transcription fallback), 10 (Home & live progress UI).

**Status:** done

- [x] Multipart uploads are streamed to disk without buffering the whole file in memory. The UI shows upload progress.
- [x] An upload is refused up front, with a clear message, when free disk space is insufficient.
- [x] The upload implementation of Video Source returns the stored file and its metadata, with no captions, so full local transcription runs.
- [x] When the master's codec can't play in the browser (for example ProRes or HEVC), a 720p H.264 preview proxy is generated for Review. Rendering still uses the master.
- [x] Seam A test: uploading the fixture through the API, with a fake Transcriber, gets the Job to `review`.
- [x] Browser check: upload a real file and reach Review.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 242 passed (9 new Seam A tests in `test_upload.py`; the other 13 new ones are ticket 15's, in the tree at the same time). `npm run typecheck` and `npm run build` pass. Browser check done with real Whisper and DeepSeek (below).

Built:
- `backend/app/uploads.py`: `receive()` streams a multipart/form-data body to `DATA_DIR/uploads/<uuid>.part` with python-multipart's push parser, writing in 4 MB pieces off the event loop; `check_room()`, `NotEnoughSpace`, `BadUpload`.
- `backend/app/video_source.py`: `UploadVideoSource` (the stored file plus ffprobe metadata, never captions); `Source.preview`; `probe()` falls back to `r_frame_rate` when the average is 0/0, and fails clearly without a duration.
- `backend/app/preview.py`: `unplayable()` (the whitelist) and `make_preview()`.
- `backend/app/jobs.py`: `Upload {name, size, file}`, `Job.upload`, and `JobStore.create(..., upload=(path, name))`, which moves the complete file in as `master<.ext>` before `job.json` is first written.
- `backend/app/pipeline.py`: `_download` uses the upload source for upload Jobs and makes the proxy; `_done` requires the preview file too. No download hint on upload failures. The local-transcription message says "an uploaded file has no captions".
- `config.py`: `PreviewTuning` (`Settings.preview`) and `Settings.upload_reserve_bytes` (2 GB, not from the environment). `main.py` deletes `DATA_DIR/uploads` at start.
- Frontend: `home/FileDrop.tsx` (a drop zone around a real `<input type=file required>`; a dropped file is put into the input); `NewJobForm` gets a "YouTube URL | Upload a file" segmented control, upload progress (bytes, percent, bar), Cancel, and a `beforeunload` guard; `api.uploadJob` (XHR, since fetch has no upload progress) and `api.checkUpload`; `jobTitle()` in `format.ts`; the Job page shows the file name and size instead of the link; the first stage reads "Upload" for upload Jobs; the preview player plays `source.preview ?? source.video`.

**API.**
- `POST /api/jobs/upload`: multipart with `options` (JobOptions as JSON, the same options as URL Jobs; optional) and then `file`. 201 with the Job (`url: ""`, `upload` set).
  - The options are validated when the file part starts, before any of the file is written (422).
  - 411-style 400 without a Content-Length; 400 "The upload was cut short" when the closing boundary never comes or the browser disconnects. In both cases the `.part` file is deleted and no Job exists.
  - 507 "Not enough free disk space for this upload: it needs X, plus 2.0 GB to work with, and only Y is free…" when `free < Content-Length + reserve`, before anything is written. The same check runs every 256 MB received, against the bytes still to come, so a disk filled by another program stops the upload.
- `GET /api/jobs/upload/check?size=N`: 204, or the same 507. **Why it exists:** uvicorn only answers an upload after Chrome has sent the whole body. With a 4 GB file and a huge reserve, the refusal showed after 9.3 s. So the Home page asks first, and refuses at once.
- `/media` now also serves `.mov` and `.m4v`, for playable QuickTime masters.

**Resume rules.** An upload becomes a Job only once it is complete (closing boundary received); the file is renamed into the Job directory in the same step that creates the Job. So a half-finished upload is never a Source. Leftover `.part` files from a crash are removed at the next start. Downloading for an upload Job is complete once `job.source` is recorded, which happens after probe and proxy. The proxy is written to `.preview.part.mp4` and renamed, and `_done` checks that `preview.mp4` exists.

**Browser-playable** (documented in `preview.py`): an ISO-BMFF file (ffprobe's mov/mp4 demuxer) named `.mp4`, `.m4v` or `.mov`, with:
- H.264, VP9 or AV1 video in 8-bit 4:2:0;
- AAC, MP3, Opus or FLAC audio, or no audio.

Everything else gets a proxy:
- ProRes, DNxHD and MPEG-2;
- 10-bit or 4:2:2 H.264;
- PCM audio;
- MKV, MXF, AVI and WebM files;
- HEVC too, since Chrome plays it only where the Mac decodes it in hardware, and Firefox not at all.

The check runs only for uploads. YouTube Sources are H.264 MP4 by preference. Running it for them added about 115 ms per Job under load, which made `test_other_jobs_run_while_a_job_waits_for_quota` (a 50 ms quota wait) flaky.

**Proxy** (`PreviewTuning`):
- the short side at most 720 (1920×1080 becomes 1280×720; it never upscales), `setsar=1`, yuv420p;
- `h264_videotoolbox` at 2 Mb/s, falling back to libx264 (`veryfast`, CRF 26);
- a keyframe every 1 s, because Review seeks to every edge;
- AAC 128k stereo, faststart, no metadata or chapters.

Progress shows during the first stage: the message "Making a preview copy the browser can play (the Source is hevc video).", with the percent from ffmpeg's `-progress`. Rendering still reads `source.video`, the master.

**Tests** (`test_upload.py`; fake Transcriber and LLM, real ffprobe/ffmpeg):
- an H.264 upload reaches `review` with a whisper Transcript (the scripted Words). The stored file is byte-identical, there is no caption track and no proxy, the YouTube source is never called, and the Job's `options` match the form;
- an HEVC 1440×810 + PCM `.mov` reaches review with `preview.mp4`: h264 1280×720 yuv420p, AAC, 8 s, moov before mdat. The metadata stays the master's, progress reaches 100 while downloading, and `/media` answers 206 with `video/mp4`;
- the whitelist: h264 `.mov` plays; MKV, ProRes, PCM audio and High 10 don't;
- insufficient space: check and upload both give 507, with no Job and nothing in `uploads/`. The reserve is set through `Settings.upload_reserve_bytes`, like the disk endpoint's threshold;
- free space running out mid-upload (`uploads.free_bytes` monkeypatched): 507, nothing left behind;
- a body without its closing boundary, and an ASGI-level disconnect mid-file: 400, no Job, nothing left behind;
- a `.part` left by a crash is removed at start and becomes no Job;
- invalid options: 422, nothing written.

Mutation checks (each breaks a test): no closing-boundary check, no up-front room check, no cleanup at start.

**Real check** (M1 8 GB; my own `uvicorn` on :8017 without `--reload`, serving `frontend/dist` with a scratch `DATA_DIR`, since `make dev` was in use by the concurrent session; Chrome via ego-browser; DeepSeek `deepseek-flash`). Two 240 s segments were cut from Job `1d5d363bec2e`'s source:
- **HEVC master** (`hevc_videotoolbox` 6 Mb/s plus PCM, `.mov`, 221 MB), Job `40d87b56b740`:
  - upload plus navigation to the Job page took 1.9 s;
  - the proxy took 38 s (6.3× realtime) and is 64 MB, 1280×720;
  - transcription took 105 s (2.3× realtime) and gave 518 words, starting "betul oke menarik tapi kan sekarang Pak Haimanto…";
  - analysis took 6 s and gave 3 Candidates (87 "Stagnan Itu Artinya Menurun, Bukan Bertahan!", 72, 70). The whole Job took 149 s;
  - in Review, "Play clip" played `/media/…/preview.mp4` at 1280×720 with no media error;
  - a render of the top Candidate succeeded from the master: its plan says `source_width/height` 1920×1080, it took 34.7 s, and a Clip came out.
- **H.264 MP4** (stream copy, 30 MB), Job `7f52281ef592`. With upload throttled to 4 MB/s, the form showed "Uploading… 12 MB of 30 MB · 40%" with the bar and Cancel, then navigated after 8.9 s. There was no proxy (`preview: null`). Transcription took 236 s this time (1.0× realtime, with the browser and the other session's test runs competing for memory and CPU), and analysis 7 s gave 2 Candidates.
- **Streaming:** a 3.2 GB upload with curl took 6.0 s (about 540 MB/s). The server's RSS went from 68 MB to a peak of 117 MB. The non-video file then failed in downloading with ffprobe's error and no yt-dlp hint, and was deleted.
- **Cancel** mid-upload: the form reset, there was no Job, and `uploads/` was empty.
- **Up-front refusal** (reserve set to 10¹⁵): the message showed in the form.
- Both Jobs were moved into `data/jobs/`.

Open issues:
- The status badge still reads "Downloading" for an upload Job's first stage (the stage list says "Upload").
- Only the first audio stream goes into the proxy. A master with separate mono mic tracks previews with one voice; Whisper also decodes ffmpeg's default stream.
- `make dev`'s Vite proxy wasn't exercised with a large upload. The check went straight to uvicorn.
- If the app is killed while making a proxy, the orphaned ffmpeg may still be writing `.preview.part.mp4` when the restarted run overwrites it.
- Only one upload at a time is sensible. Concurrent uploads work, but each is checked against free space on its own.

**2026-10-14: verified by the owner's session.** 243 tests pass and the frontend builds. Committed together with the concurrently built tickets 15–17, which share files.
