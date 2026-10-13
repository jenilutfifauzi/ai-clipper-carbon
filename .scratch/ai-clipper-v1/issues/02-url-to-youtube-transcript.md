# 02: Tracer: URL → Job → YouTube Transcript

**Parent spec:** `spec.md` in this feature folder (Milestone M1; user stories 1–4, 9, 11, 15, 73).

**What to build:** As the owner, I paste a YouTube URL, via the HTTP API or the CLI. I get a Job that downloads the episode and its Indonesian auto-captions and then exposes a normalized Transcript. Only one Job runs at a time.

This slice also establishes the patterns later tickets reuse:
- the Job store: one directory plus a JSON state file per Job;
- the single-worker queue;
- the Video Source port, with a real yt-dlp implementation and a fake for tests;
- the Seam A test harness: HTTP API tests with fakes only at the ports.

**Blocked by:** 01 (Scaffold & toolchain).

**Status:** done

- [x] Creating a Job with a URL returns a Job id. The Job moves `queued` → `downloading` → `transcribing`, then ends with a Transcript available. This is a temporary terminal state; ticket 04 extends the lifecycle.
- [x] Getting a Job returns its status, the Source metadata (duration, fps, width, height, codec), and the Transcript Words.
- [x] Listing Jobs returns recent Jobs with their status.
- [x] The download is capped at 1080p, prefers H.264, and is saved as mp4. Captions are requested as Indonesian / original-language json3.
- [x] json3 parsing follows these rules:
  - a word's start = event start + per-word offset;
  - a word's end = the next word's start, capped at the event's end;
  - whitespace-only segments are skipped;
  - the Transcript records its language and `source = youtube`.
- [x] Language defaults to Indonesian, and a per-Job override is accepted.
- [x] A second Job submitted while one is running stays `queued` until the first finishes.
- [x] A CLI analyze command runs the same flow through the same modules.
- [x] Seam A tests (API with a fake Video Source returning a fixture video and a fixture json3) cover the state sequence, the parsed Words, the metadata, and the queueing behaviour.
- [x] Manual smoke check: a real public Indonesian podcast URL produces a Transcript.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 24 passed (13 new Seam A tests, about 1.3 s).

Built (in `backend/app/`):
- `video_source.py`: the `VideoSource` Protocol, `fetch(url, language, dest) -> Source`. `Source` holds the video and caption-track file names (relative to `dest`) plus `SourceMetadata`.
  - `YtDlpVideoSource` uses the yt-dlp Python API:
    - format `bv*[height<=1080]+ba/b[height<=1080]`, sorted `res:1080,vcodec:h264,acodec:m4a`;
    - merged and remuxed to mp4 with `ffmpeg_location=FFMPEG_BIN`;
    - json3 auto-captions for `<lang>-orig` and `<lang>`, preferring `-orig`;
    - cookies only when the setting is set.
  - `probe()` reads metadata with the configured ffprobe.
- `transcript.py`: `Transcript`, `Word` and `Segment` (one Segment per caption event), and `parse_json3`.
- `jobs.py`: `JobStatus`, `JobOptions` (language, min_secs, max_secs, captions, brief; validated, stored, unused for now), `Job` and `JobStore`.
- `pipeline.py`: the ordered stages; `worker.py`: the single-worker queue; `api.py`: the routes; `main.py`: `create_app`; `cli.py`: `analyze`.
- In the `Makefile`: `make analyze URL=…`. `make dev` now runs `uvicorn --factory app.main:create_app`.

Design decisions for later tickets:
- **Ports.**
  - `app/ports.py` defines a `Ports` dataclass (`video_source` for now). Add `transcriber` and `llm` there, and build their real implementations in `real_ports(settings)`.
  - `create_app(settings, ports)` and `Pipeline(store, ports)` take the ports as arguments.
  - The fakes live in `backend/tests/fakes.py`. `FakeVideoSource` copies a fixture into the Job directory and probes it with the real ffprobe. It offers `hold()`/`release()` (`fetch` waits on an Event), `fail_with()`, and a record of its `calls`.
- **Store layout.**
  - Each Job is a directory `DATA_DIR/jobs/<12-hex id>/` holding `job.json`, `source.mp4`, `source.<lang>[-orig].json3` and `transcript.json`.
  - Every write is atomic (a temp file, fsync, then rename). `store.update()` holds a lock while it reads, modifies and writes, and appends a timestamped entry to `history` whenever the status changes.
- **States.**
  - `status`: `queued`, `downloading`, `transcribing`, then `transcribed` (the temporary end of the pipeline), or `error`.
  - `stage`: the stage running now, or the one the Job failed in.
  - `error`: the failure message.
  - Ticket 04 appends a stage to `Pipeline.stages` and changes the final status. Ticket 07 can skip stages whose artifacts exist.
- **API.** `POST /api/jobs` takes `{url, options?}`. `GET /api/jobs` lists Jobs newest first, without Transcripts. `GET /api/jobs/{id}` returns the Job with its `transcript`.
- **How tests wait.** The `wait_for_status` fixture polls the API with a 5 s timeout. Holding the fake makes intermediate states observable. Status order is asserted through `history`, and queueing is proven by comparing `history` timestamps.
- **Without captions.** The Job errors in `transcribing` until ticket 03 adds local transcription.

**Smoke check** (`make analyze URL=https://www.youtube.com/watch?v=9xo4pOaTsxY`): the Job reached `transcribed` in about 5 s. yt-dlp picked format 137 (1080p avc1) plus 140 (m4a). The download is `source.mp4`, h264 High at 1920x1080 and 25 fps, with AAC audio, 35.6 s long. The Transcript has 75 words in 11 segments, `source=youtube`, `language=id`, starting "hari ini kita ngobrol bersama Yono Bakri…", with monotonic times. The same URL also went through a real `uvicorn --factory` server with POST and poll. Both Jobs are left in `data/jobs/`.

Open issues:
- yt-dlp warns "no impersonate target is available". Adding the `curl-cffi` extra would silence it and may make downloads more robust.
- Interrupted Jobs aren't resumed on restart (ticket 07). `Worker.stop()` waits at most 5 s for the running Job.
- An empty caption track yields an empty Transcript rather than an error.
- A full-length episode wasn't tried.

**2026-10-13: verified by the owner's session.** `make test` passes (24 passed). Code reviewed: ports are injected through `create_app`/`Pipeline`, json3 parsing follows the spec rules, and the smoke Job on a public Indonesian clip reached `transcribed`. Committed.
