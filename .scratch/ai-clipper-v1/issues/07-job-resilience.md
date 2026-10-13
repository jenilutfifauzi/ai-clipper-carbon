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

**Status:** ready-for-agent

- [ ] Stage artifacts are cached. Retrying after an injected analyze failure does not call the Video Source or Transcriber again (Seam A, using call-counting fakes).
- [ ] The `error` state records the stage and message. A retry action, in both the API and the CLI, resumes from that stage.
- [ ] On app restart, Jobs that were queued or in progress resume from their last completed stage.
- [ ] A quota error from the LLM moves the Job to `waiting_quota`. It is retried with exponential backoff and then continues to `review` (Seam A, using a fake that fails N times).
- [ ] Deleting a Job removes its directory and files, and the Job no longer appears in the list.
- [ ] The disk endpoint returns the data directory's usage, the free space, and a warning flag when free space is below 10 GB.
- [ ] A download failure's message includes a hint to run the update command.
