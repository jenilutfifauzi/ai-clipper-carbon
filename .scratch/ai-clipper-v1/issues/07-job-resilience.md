# 07: Job resilience: resume, retry, quota, delete, disk

**Parent spec:** `spec.md` in this feature folder (user stories 12–14, 16–17; Job lifecycle).

**What to build:** Long Jobs survive failures:
- a failed or interrupted Job resumes from its last completed stage, without re-downloading or re-transcribing;
- failures land in `error` with the stage and message, and can be retried;
- Gemini quota exhaustion moves the Job to `waiting_quota`, from which it resumes automatically;
- deleting a Job removes all its files;
- a disk endpoint reports usage and warns when free space drops below 10 GB;
- download failures carry a hint to run the yt-dlp update command.

**Blocked by:** 03 (Full local transcription fallback), 04 (Selection: Transcript → Candidates).

**Status:** done

- [x] Stage artifacts are cached. Retrying after an injected analyze failure does not call the Video Source or Transcriber again (Seam A, using call-counting fakes).
- [x] The `error` state records the stage and message. A retry action, in both the API and the CLI, resumes from that stage.
- [x] On app restart, Jobs that were queued or in progress resume from their last completed stage.
- [x] A quota error from the LLM moves the Job to `waiting_quota`. It is retried with exponential backoff and then continues to `review` (Seam A, using a fake that fails N times).
- [x] Deleting a Job removes its directory and files, and the Job no longer appears in the list.
- [x] The disk endpoint returns the data directory's usage, the free space, and a warning flag when free space is below 10 GB.
- [x] A download failure's message includes a hint to run the update command.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 89 passed in about 21 s (18 new Seam A tests in `test_resilience.py`, and 71 existing tests, 5 of them adjusted as listed below). Every box is verified with call-counting fakes at the ports.

Built (in `backend/app/`):
- `pipeline.py`: resume (`_done`), `run_until_done`, the quota wait, the Score-answer cache (`_KeptScores`), and the download hint.
- `worker.py`: `Worker(store, pipeline)` now handles start-up recovery, `retry`, and the quota wake-up timers.
- `jobs.py`:
  - the `waiting_quota` status;
  - `JobWarning`, `QuotaWait`, `Job.quota`, `JobConflict`;
  - `update(expect=…)`, `delete`, the run lock (`running`/`busy`) and the `scores.json` methods.
- `llm.py`: `PacedLlm`.
- `storage.py`: `disk_usage`.
- `config.py`: `QuotaTuning` (in `Settings.quota`) and `Settings.low_disk_bytes`.
- `api.py`: the retry, delete and disk routes. `cli.py`: `retry`. In the `Makefile`: `make retry JOB=<id>`.

**Resume rules.**
- `Pipeline.run(job_id)` runs from the first stage whose output isn't complete. Its `start=` parameter is gone.
- **Downloading** is complete once `job.source` is recorded and the files it names exist. `job.source` is only written after the Video Source returns, which for yt-dlp is after download, merge, remux and probe. An interrupted download (such as `.part` files) never has it, so it is fetched again; yt-dlp continues `.part` files itself.
- **Transcribing** is complete once `transcript.json` exists. It is written atomically, as the stage's last step.
- **Analyzing**, the last stage, always runs. It has no "done" marker of its own, because `candidates.json` may come from an earlier run.
  - So a failed, interrupted or quota-waiting Job resumes at the stage it stopped in.
  - A Job in `review` that is run again (`make reanalyze`, or an eval reusing it) runs only analyzing.
- When a stage starts, it clears `error`, `progress` and `message`, and drops **its own** warnings. Warnings are now `{stage, message}`, so a re-analysis drops stale few-shot warnings and keeps the transcribing stage's "Skipped …" warnings, which still describe a gap in the Transcript.

**Score-batch cache.**
- While analyzing runs, `scores.json` in the Job directory maps `sha256([PROMPT_VERSION, GEMINI_MODEL, temperature, prompt])` to the Score answer. It is written after each new answer.
- The prompt holds the Windows' text and times (so the Transcript and the Window tuning), the language, the duration range, the profile summary and the Brief. Changing any of them, or the prompt version or model, misses the cache. Tuning that doesn't shape a request doesn't need to.
- The file is deleted when the stage completes. `make reanalyze` and repeat eval runs therefore still ask afresh, as before.
- A file that no longer fits the response schema is read as empty.

**Quota** (`QuotaTuning`, the one place for these numbers).
- The waits are 60 s, then doubling: 2, 4, 8 min, then a cap of 15 min.
- The Job gives up into `error` at the first quota error that comes 24 h or more after the first error of the run ("Gave up after waiting 24 h for Gemini's quota. …"). A day takes in a daily-quota reset.
- A run of errors starts over at 60 s once another Score batch has been answered since the last wait. That makes per-minute limits cheap.
- `Job.quota` is `{since, errors, retry_at, scored}`. It is cleared on `review` and `error`. The message reads "Trying again at 14:05:30 (in 2 min). <Gemini's error>".

**Worker release.**
- The pipeline records `waiting_quota` and returns, so the worker moves on to the next queued Job.
- A daemon `threading.Timer` moves the Job back to `queued` at `retry_at`, but only if it is still `waiting_quota`, then submits it.
- Timers are cancelled on stop.
- The CLI and the eval have no worker. `Pipeline.run_until_done` sleeps through the waits instead.

**Pacing.** `PacedLlm` starts requests at least `request_interval_secs` = 6 s apart, which caps them at 10 a minute, the free tier's usual per-minute limit.
- It adds nothing when requests take 6 s or more anyway.
- At worst it adds about 84 s to a 3-hour episode's ~14 requests.
- It is per Pipeline, so it carries across Jobs in the app. Cached answers aren't paced.

**Restart.**
- `Worker.start()` takes Jobs oldest first:
  - `queued`, `downloading`, `transcribing` and `analyzing` Jobs go back to `queued` (the history shows it) and are submitted;
  - `waiting_quota` Jobs get a timer for what is left of their wait.
- **Run lock.** `Pipeline.run`/`run_until_done` hold an flock on `run.lock` in the Job directory. The OS releases it when the process dies, so it never goes stale.
  - Start-up recovery skips a Job whose lock is held, which is a CLI run in progress, so a `--reload` restart never hijacks a `make eval` Job.
  - The CLI refuses to run a Job the app is running.

**Delete** (`DELETE /api/jobs/{id}`).
- 204: the whole directory is removed and the Job leaves the list.
- 404: an unknown or malformed id.
- 409 while the Job is downloading, transcribing or analyzing, or while another process holds its run lock. There is no cancel.
- A `queued` Job is deleted, and the worker skips it. A `waiting_quota` Job is deleted, and its timer finds nothing.

**New endpoints and fields.**
- `POST /api/jobs/{id}/retry`: 200 with the Job, now `queued`. 404 for an unknown Job; 409 unless the Job is in `error` ("Job … is review: only a Job in error can be retried").
- `GET /api/system/disk` → `{used_bytes, free_bytes, total_bytes, warning, warning_below_bytes}`.
  - `used_bytes` is the apparent size of everything under `DATA_DIR`. Free and total come from `shutil.disk_usage`.
  - The threshold is `Settings.low_disk_bytes`, 10 GB (10¹⁰, decimal like Finder). It isn't read from the environment.
- Job JSON gains `quota` and the `waiting_quota` status. Warnings are now `{stage, message}` objects (ticket 10 should render them).
- `create_app` creates `DATA_DIR`.

**Download hint.** Every failure in `downloading` ends with "If YouTube changed something, updating the downloader may fix it: run `make update-ytdlp`, then retry."

**CLI.** `retry <job-id>` (`make retry JOB=…`) resumes any Job that isn't in `review`: failed, interrupted, queued or waiting. For a Job in `review` it points to `make reanalyze`.
- `analyze`, `reanalyze`, `retry` and `eval` sleep through quota waits.
- Asked to run a Job another process holds, they print "Job … is being run by another process".

**Existing tests adjusted.**
- The two "quota error → error" cases (`test_selection`, `test_gemini`) are now marked `quota(give_up_secs=0)` and expect the give-up message after exactly one request.
- The download-failure test expects the hint after the message.
- Two warning assertions read `{stage, message}`.
- `FakeLlm.fail_with` gained `after=`, and the fake records `sent` times.
- `conftest`:
  - `QUOTA` tuning: no pacing, waits of 0.05 s doubling to 0.2 s;
  - a `@pytest.mark.quota(...)` marker;
  - a `wait_for(client, …)` helper.

**New tests** (`test_resilience.py`):
- a retry after an analyzing failure: no new fetch or Transcriber calls, history `… error, queued, analyzing, review`;
- a download failure: the hint, and a retry that re-fetches;
- 409/404 on retry;
- Score batches answered before a failure aren't re-sent; the failed one is; every Window is scored exactly once; a reanalysis after completion re-sends all of them;
- a profile-snapshot change misses the cache;
- three quota errors: `waiting_quota` observed, waits of at least 0.05/0.1/0.2 s, then `review`;
- the streak resets after progress;
- another Job reaches `review` while one waits; the waiting Job can be deleted;
- give-up into `error`;
- pacing gaps;
- restart with Jobs left queued, downloading (with a `.part` file), transcribing and analyzing: only the incomplete downloads are re-fetched, oldest first;
- a `waiting_quota` Job resumes its wait after a restart, not before `retry_at`;
- a Job whose run lock is held is left alone at start-up;
- delete: files and listing gone; 404s; 409 while running; a queued Job deleted and never run;
- disk: the fields, and the warning flag at both extremes of the threshold;
- stale warnings: analyzing's dropped, transcribing's kept;
- the CLI: retry from the failed stage, sleeping through a quota wait.

**Mutation checks.** Each of these 24 breaks a test:
- resume: downloading or transcribing always redone;
- the Score cache: none, a key that ignores the prompt, a cache kept after completion;
- quota: no doubling, no streak reset, never giving up, quota treated as an error;
- the worker: sleeping through the wait, no recovery, recovery newest first, recovery ignoring the lock, a waiting Job requeued at once on start;
- warnings never cleared, or all of them cleared;
- no download hint;
- delete: allowed while running, or leaving files behind;
- retry allowed from any status;
- no pacing;
- disk: an inverted warning, or usage that skips subfolders;
- the CLI not waiting out quota.

**Smoke checks** (real ports, offline, no Gemini key; an APFS clone of Job `8ef59ab26333` in a scratch `DATA_DIR`, so the owner's `data/` is untouched):
- **CLI.** `python -m app.cli retry 8ef59ab26333` resumed the legacy `transcribed` Job straight at `analyzing`, with no download or transcription. It failed in 1.3 s with "GEMINI_API_KEY is not set".
- **App start-up.** I edited the Job to `analyzing`, then started `uvicorn --factory`. It recovered the Job (`queued → analyzing → error`).
- **Disk.** It reported 42.2 GB free of 245 GB, with no warning.
- **Retry and delete.**
  - Retry returned 200.
  - DELETE returned 409 while the retried run was still waiting out the 6 s pacing.
  - Once the Job was back in `error`, DELETE returned 204: the directory was gone, the list empty, and GET answered 404.

Open issues:
- **Local transcription isn't checkpointed per chunk.** A crash mid-`transcribing` of a 3-hour uncaptioned episode redoes the whole stage (about 1.5 h). Only completed stages are kept.
- **Gemini's 429 often says "Please retry in 37 s"** (RetryInfo). It's ignored: the backoff uses the fixed numbers above.
- **The hint is added to every `downloading` failure**, including ffprobe errors or a full disk. The upload source in M5 should skip it.
- **A Job stuck by a killed CLI run.** It stays in its stage until the next app start or `make retry`: the API retry only accepts `error`. There is no "retry now" for `waiting_quota`, and no cancel for a running Job.
- **Pacing is per process.** A `make eval` beside the running app paces on its own.
- **`make reanalyze` re-downloads** if the Source video file was removed by hand. Before, `start=ANALYZING` skipped that.
- **Old string warnings won't parse.** A `job.json` with plain-string warnings would fail to load. None exist in `data/` (all three Jobs have none).
- **App INFO logs are hidden** under uvicorn's default logging, for example "Job … was left analyzing: queued again". This was already the case before this ticket.

**2026-10-13: verified by the owner's session.** `make test` passes 89 tests on three consecutive runs. Committed.
