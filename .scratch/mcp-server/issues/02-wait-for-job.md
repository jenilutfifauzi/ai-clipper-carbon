# 02: Waiting for a Job

**Parent spec:** `spec.md` in this feature folder (user story 4).

**What to build:**
- `wait_for_job(job_id, until, timeout_secs)`: follows the Job's changes (`events.job_events`) until its status is one of `until` (review or error by default), reporting progress to the client as it goes. On timeout it returns the Job as it is, with `reached: false`, so that the agent waits again.

**Blocked by:** 01.

**Status:** done

- [x] Returns at once when the Job is already in `until`.
- [x] Follows a Job from queued to review, with progress notifications.
- [x] Times out with `reached: false`.
- [x] A Job deleted while waited on is a tool error.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`: waiting until downloading while the Video Source is held; a 5 s timeout returns `reached: false`; once released, it follows the Job to review with a progress notification while transcribing; a Job already in review returns at once; an unknown Job is a tool error.

**Changes from the plan:**
- The event stream is closed as soon as the wait ends (`aclosing`), so its store watcher doesn't outlive it.
