# 02: Tracer: URL → Job → YouTube Transcript

**Parent spec:** `spec.md` in this feature folder (Milestone M1; user stories 1–4, 9, 11, 15, 73).

**What to build:** As the owner, I paste a YouTube URL, via the HTTP API or the CLI. I get a Job that downloads the episode and its Indonesian auto-captions and then exposes a normalized Transcript. Only one Job runs at a time.

This slice also establishes the patterns later tickets reuse:
- the Job store: one directory plus a JSON state file per Job;
- the single-worker queue;
- the Video Source port, with a real yt-dlp implementation and a fake for tests;
- the Seam A test harness: HTTP API tests with fakes only at the ports.

**Blocked by:** 01 (Scaffold & toolchain).

**Status:** ready-for-agent

- [ ] Creating a Job with a URL returns a Job id. The Job moves `queued` → `downloading` → `transcribing`, then ends with a Transcript available. This is a temporary terminal state; ticket 04 extends the lifecycle.
- [ ] Getting a Job returns its status, the Source metadata (duration, fps, width, height, codec), and the Transcript Words.
- [ ] Listing Jobs returns recent Jobs with their status.
- [ ] The download is capped at 1080p, prefers H.264, and is saved as mp4. Captions are requested as Indonesian / original-language json3.
- [ ] json3 parsing follows these rules:
  - a word's start = event start + per-word offset;
  - a word's end = the next word's start, capped at the event's end;
  - whitespace-only segments are skipped;
  - the Transcript records its language and `source = youtube`.
- [ ] Language defaults to Indonesian, and a per-Job override is accepted.
- [ ] A second Job submitted while one is running stays `queued` until the first finishes.
- [ ] A CLI analyze command runs the same flow through the same modules.
- [ ] Seam A tests (API with a fake Video Source returning a fixture video and a fixture json3) cover the state sequence, the parsed Words, the metadata, and the queueing behaviour.
- [ ] Manual smoke check: a real public Indonesian podcast URL produces a Transcript.
