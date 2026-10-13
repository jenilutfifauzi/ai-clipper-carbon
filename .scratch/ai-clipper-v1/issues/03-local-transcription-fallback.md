# 03: Full local transcription fallback

**Parent spec:** `spec.md` in this feature folder (Milestone M1; user story 5; Transcriber module).

**What to build:** When a Source has no auto-caption track, the Job still produces a Transcript. It transcribes the whole episode locally with mlx-whisper large-v3-turbo, reports progress, and uses a watchdog so a stalled chunk can't hang the Job.

This ticket introduces the Transcriber port (real and fake). The port takes an arbitrary audio range, so ticket 15 can reuse it for per-clip transcription.

**Blocked by:** 02 (Tracer: URL → Job → YouTube Transcript).

**Status:** done

- [x] A Job whose Source has no captions transcribes in the `transcribing` stage and produces a Transcript with `source = whisper` and per-word start and end times.
- [x] The Transcriber accepts an audio range (or the whole file) plus a language. It returns Words on the Source timeline, with the range offset applied.
- [x] The real implementation runs with word timestamps on, conditioning on previous text off, the Job's language, and Silero VAD through onnxruntime.
- [x] The watchdog wraps any Transcriber. A chunk that runs past its time budget is retried once, then skipped with a warning recorded on the Job, and the Job continues.
- [x] Transcription progress (percent) is reported on the Job. For full-episode runs, the status message suggests closing heavy apps.
- [x] Seam A tests:
  - a fake Source without captions plus a fake Transcriber yields a whisper Transcript;
  - a stalling fake Transcriber yields a recorded warning and a Job that still finishes.
- [x] Manual smoke check: 5–10 minutes of real audio transcribes. The realtime factor and peak memory are noted in the Job log.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 28 passed, about 8 s. The 5 new Seam A tests in `test_local_transcription.py` replace ticket 02's "no captions → error" test. `make test-whisper`: 3 passed, 2 of them new.

Built (in `backend/app/`):
- `transcriber.py` holds three things.
  - The `Transcriber` Protocol: `transcribe(media, language, start=0, end=None) -> Transcript` and `stop()`. The Transcript has `source=whisper`, and its Words and Segments are on the media's timeline. `Ports.transcriber` holds it.
  - `Watchdog`.
  - `WhisperTranscriber`, the real implementation.
- `whisper_worker.py`: the worker process. mlx is imported only there.
- `audio.py`:
  - `decode()` turns a range into 16 kHz mono float32 with the configured ffmpeg;
  - `SileroVad` runs on onnxruntime with one thread, at about 160 µs per 32 ms window;
  - `chunks()` and `pause_near()` place the cuts.
- `config.py`: `TranscriptionTuning`, held in `Settings.transcription`. It isn't read from the environment. Tests shrink it, and `@pytest.mark.tuning(...)` overrides it per test.
- `Pipeline(store, ports, settings)` now takes the settings too.

Design:
- **Chunking.** A full-episode run is cut into chunks of about 300 s, and each chunk is decoded on its own (about 19 MB).
  - Each cut goes in the middle of the Silero pause (≥ 0.3 s) nearest the target, searching ±30 s. Only that 60 s window is decoded to find it.
  - If there's no pause nearby, the cut falls at the target.
  - Chunks don't overlap, so there's nothing to de-duplicate.
- **VAD.** Within each chunk, the worker:
  1. cuts silences of 2 s or more down to 0.4 s of padding on each side, and drops blips shorter than 0.25 s (faster-whisper's VAD-filter defaults);
  2. transcribes the concatenated speech;
  3. maps each word back through the speech range that holds its midpoint.

  Why not mlx-whisper's own options:
  - In mlx-whisper 0.4.3, `clip_timestamps` doesn't skip the gaps between clips: its loop never seeks to the next clip's start.
  - `hallucination_silence_threshold` is left off. VAD already removes the long silences, and its anomaly heuristic can drop real short words.

  Whisper splits reduplicated words ("main" + "-main"); the worker joins them back.
- **Watchdog and cancellation.**
  - The budget is 60 s + 1.5× the chunk duration: 510 s for a 300 s chunk, about 3× the expected time.
  - Each call runs on a daemon thread. Past the budget, the watchdog calls `Transcriber.stop()`, waits for the call to unwind, and retries once.
  - A second overrun raises `TranscriptionStalled`. The pipeline records it as a Job warning and moves on to the next chunk.
  - `WhisperTranscriber` runs mlx-whisper in a persistent spawned worker process, and the model stays loaded between chunks.
  - `stop()` asks the worker to exit, and sends SIGKILL if it is still busy after 3 s. That's the only way to end a stuck MLX computation. The blocked call then reads EOF and raises `TranscriptionStopped`.
  - The pipeline also calls `stop()` when the stage ends, which frees the ~2 GB.
- **Job fields and options.**
  - `progress`: the percent of the Source done, updated after each chunk.
  - `message`: during local runs, "…Close heavy apps such as browsers and editors to free memory."
  - `warnings`: a list.
  - Both `progress` and `message` are cleared when a stage starts and when the Job ends.
  - `JobOptions.transcribe_locally` ignores YouTube captions. It's set with CLI `--transcribe-locally`, or `make analyze URL=… ARGS=--transcribe-locally`.
- **Tests.**
  - The speech fixture is 8 s of `say -v Damayanti` phrases with pauses of at least 1 s.
  - The 3.5 s chunk target lands inside a phrase, so the test passes only if real VAD moves the cut into a pause. Forcing cuts at the target makes it fail.
  - `FakeTranscriber` returns the scripted words that overlap the range, clipped to it. It offers `stall(n)`, `hold(after)` and a record of its `calls`.

**Smoke check.** Command: `python -m app.cli analyze https://www.youtube.com/watch?v=xEah8NzNrGQ --transcribe-locally`, on SUARA BERKELAS, "Kalau Lo Lagi BURNOUT, Coba Dengerin Ini!" (488.8 s, 1080p30), Job `8ef59ab26333` in `data/jobs/`.
- The download took 14 s.
- Two chunks, with the cut at 301.3 s, between a question and its answer.
- Transcribing 489 s took 148 s, **3.30× realtime**. The two chunks ran at 3.37× and 3.38×; the first includes the model load.
- **Peak MLX memory was 2.26 GB.** The worker's max RSS was 0.64 GB, which matches `/usr/bin/time -l`; RSS leaves out Metal buffers. The app process stays at about 130 MB.
- The Transcript has 1312 words in 237 segments, with monotonic times and no warnings.
- The Indonesian is plausible: "banyak yang bilang kerja tuh beban ya…", "gue bikin malam Minggu Miko episode 1 deh".
- These numbers come from the per-chunk and per-Job log lines.

Open issues:
- The run was faster than the spec's 1.9×, probably because of less memory pressure. The budgets still assume 1.9×.
- Casing and punctuation can change from chunk to chunk (chunk 1 lowercase, chunk 2 capitalised with full stops), because each call starts without context.
- Progress moves once per chunk, about every 1.5 minutes.
- If no pause is found within ±30 s (for example speech over music), the cut falls at the target and can split one word.
- If macOS kills the worker for memory, the Job errors ("Whisper worker stopped (exit code -9)"). Only stalls are retried; ticket 07 covers retrying failed Jobs.
- Because the worker is spawned, any script that uses `WhisperTranscriber` needs an `if __name__ == "__main__":` guard.

**2026-10-13: verified by the owner's session.** `make test` passes (28 passed). Watchdog reviewed: the call runs in a thread with a budget; on overrun the Transcriber is stopped (worker subprocess killed) and retried once. Smoke check: 8.1 min of Indonesian podcast audio transcribed at 3.3× realtime with 2.26 GB MLX peak. Committed.
