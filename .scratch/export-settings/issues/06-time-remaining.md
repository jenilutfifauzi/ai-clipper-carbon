# 06: Time remaining while a Clip renders

**Parent spec:** `../spec.md` (Solution "Time remaining"; Implementation Decisions "Model": `started_at`; "Frontend": the progress line).

**What to build:** a rendering Clip's progress line shows roughly how long it has left.
- **A Clip has `started_at`** while it renders, set when the worker starts it and cleared when it ends.
- **The progress line** shows the time left once progress passes 2%: elapsed / progress × (1 − progress), from `started_at` and the Job's progress.
  - The wording is "almost done" at 1 s or less, "Ns left" under a minute, and "M:SS left" otherwise.
  - It updates as progress comes in, without flicker.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A rendering Clip carries `started_at` through the API, and a finished or failed one doesn't.
- [ ] Vitest:
  - the wording at 0.5 s, 40 s and 130 s;
  - nothing is shown under 2% progress;
  - the arithmetic from `started_at` and progress.
