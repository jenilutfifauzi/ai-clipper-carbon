# 19: A Job left running by a dying process is never resumed

**Parent spec:** `spec.md` in this feature folder (Job lifecycle; follows up 07 Job resilience).

**Status:** done

**What to fix:** At start-up, `Worker.start` (`backend/app/worker.py`) skips any Job whose run lock another process holds ("left to it"). If that other process is the previous server still shutting down, it dies without finishing the Job, the lock is released, and nobody queues the Job again. The Job then shows its stage (for example `downloading`) forever, with no error and no progress.

## Observed (2026-10-14)

Job `c37ac3bbb8ad`, `https://www.youtube.com/watch?v=WgQkUOeXs4E` (1:08:35):

- 10:34:46: Job created by the running server; yt-dlp picks format 299 (1080p60 H.264, 1,379,149,710 bytes).
- 10:36:46: `make dev` restarted. The new worker finds `run.lock` still held by the old process, so it skips the Job. `job.json` is never written again (its mtime stays 10:34).
- 10:41: `source.f299.mp4.part` stops growing at 1,351,468,886 bytes (98.0%). The old process is gone. Nobody holds `run.lock` (`lsof` shows no holder).
- 10:57: the UI still shows `Downloading` with an empty bar. `sample` of the server process shows every Python thread idle, and there is no connection to googlevideo.

Ruled out:
- **Cookies.** `YTDLP_COOKIES_FROM_BROWSER` is empty, but yt-dlp reads the formats without cookies in about 3 s, and it downloaded 1.35 GB at about 3 MB/s. Missing cookies give a fast 403 error, not a silent hang.
- **Slow network.**

Unverified: why the old process outlived the restart by about 5 minutes. One candidate is uvicorn's graceful shutdown waiting for the open SSE stream (`/events`) before running the lifespan shutdown, while the yt-dlp daemon thread keeps downloading.

## Repro (red today)

A Seam A test, beside `test_a_job_another_process_is_running_is_left_to_it_on_start_up` in `backend/tests/test_resilience.py`:

1. Create a Job and set it to `downloading`.
2. Enter `store.running(job.id)` (the old process holds the lock).
3. Start `TestClient(create_app(...))`.
4. Exit the lock (the old process dies).
5. Wait up to 5 s for `review`.

Today the Job stays `downloading`, and `video_source.calls == []`. The test fails in about 9 s.

## Acceptance

- [x] A Job skipped at start-up because another process held its lock is queued as soon as that lock is released, if it is still in a running status (`QUEUED` or `RUNNING`) or `RENDERING`. One approach is a daemon thread per skipped Job that blocks on `flock(LOCK_EX)` without `LOCK_NB`, releases the lock, re-reads the status, and calls `submit` if the Job was left unfinished.
- [x] A Job that the other process (a CLI run) finished, to `review` or `error`, is not run again.
- [x] The existing test `..._is_left_to_it_on_start_up` still passes. The repro above passes.
- [x] Also: the Download stage reports progress. `noprogress` is set and there is no `progress_hooks`, so a 1 h source shows an empty bar for about 7 minutes even when healthy. Add a yt-dlp progress hook that writes `downloaded_bytes / total_bytes` to `store.update(progress=...)`, throttled the way `_preview` does it.

## Workaround

Restart `make dev`, or save any backend file so that `--reload` restarts the server. The lock is free now, so `Worker.start` queues the Job again, and yt-dlp continues the `.part` file from 98%.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 257 passed. The new tests are 2 Seam A tests in `test_resilience.py`, 1 in `test_jobs_api.py`, and the new `test_video_source.py`.

Built (in `backend/app/`):
- `jobs.py`: `JobStore.wait_until_free` blocks on the run lock.
- `worker.py`: for each Job that is busy at start-up, a daemon thread waits until the lock is free, then takes the Job back if it is still unfinished. `_take_back` is the per-Job resume logic that `start` used to inline.
- `video_source.py`: `DownloadProgress` is both a `before_dl` postprocessor, which reads the chosen formats' sizes, and a progress hook. It reports video and audio as one fraction, and ignores the caption download that yt-dlp runs through the same hook before the media. `fetch` takes a `progress` callback.
- `pipeline.py`: `_reporter` records progress in whole percents, only when the percent changes. The download and the preview proxy share it.

Verified against real yt-dlp: "Me at the zoo" reported 20 progress calls from 0.001 to 1.0, monotonic. Before captions were ignored, it jumped 1.0 → 0.5.

The live Job `c37ac3bbb8ad` was taken back by the `--reload` restart at 11:05:52. It then failed in the download with `HTTP Error 403`, which is a separate problem; see below.

Separate finding, the 403: transient, not throttling.
- Resuming the job's `.part` in a scratch copy completed f299. The audio stream f140 then hit `Read timed out` twice, after 20 s each.
- A first `curl` test over 20 MB single ranges gave about 32 KB/s from the ISP cache nodes `sn-pjvo2aopq-*`, and some 403s. This was misleading: `curl` sends none of yt-dlp's headers and asks for one large range.
- yt-dlp itself, a few minutes later, fetched the whole of f140 (66.5 MB) at about 2.2 MB/s without cookies, and about 1.8 MB/s with `--cookies-from-browser chrome`.
- So cookies make no difference to the speed. The 403 and the read timeouts were transient CDN errors, and retrying the Job resumes from the `.part`. `YTDLP_COOKIES_FROM_BROWSER=chrome` is now set in `.env`, as a guard against 403s that need a session.

**2026-10-14, later:** yt-dlp reports a format it finds complete on disk as `finished` with `total_bytes` and no `downloaded_bytes`, so a resumed Job's bar went from 0 instead of 95%. Fixed, with a test in `test_video_source.py`. Live check on Job `c37ac3bbb8ad`:
- A `--reload` happened mid-download at 11:25:44. The new worker took the Job back at 11:25:57, once the old process let go.
- The bar went 95 → 100%, and the Job moved on to transcribing.
