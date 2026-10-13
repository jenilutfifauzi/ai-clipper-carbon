# 03: Full local transcription fallback

**Parent spec:** `spec.md` in this feature folder (Milestone M1; user story 5; Transcriber module).

**What to build:** When a Source has no auto-caption track, the Job still produces a Transcript. It transcribes the whole episode locally with mlx-whisper large-v3-turbo, reports progress, and uses a watchdog so a stalled chunk can't hang the Job.

This ticket introduces the Transcriber port (real and fake). The port takes an arbitrary audio range, so ticket 15 can reuse it for per-clip transcription.

**Blocked by:** 02 (Tracer: URL → Job → YouTube Transcript).

**Status:** ready-for-agent

- [ ] A Job whose Source has no captions transcribes in the `transcribing` stage and produces a Transcript with `source = whisper` and per-word start and end times.
- [ ] The Transcriber accepts an audio range (or the whole file) plus a language. It returns Words on the Source timeline, with the range offset applied.
- [ ] The real implementation runs with word timestamps on, conditioning on previous text off, the Job's language, and Silero VAD through onnxruntime.
- [ ] The watchdog wraps any Transcriber. A chunk that runs past its time budget is retried once, then skipped with a warning recorded on the Job, and the Job continues.
- [ ] Transcription progress (percent) is reported on the Job. For full-episode runs, the status message suggests closing heavy apps.
- [ ] Seam A tests:
  - a fake Source without captions plus a fake Transcriber yields a whisper Transcript;
  - a stalling fake Transcriber yields a recorded warning and a Job that still finishes.
- [ ] Manual smoke check: 5–10 minutes of real audio transcribes. The realtime factor and peak memory are noted in the Job log.
