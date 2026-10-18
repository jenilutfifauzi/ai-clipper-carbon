# 06: Time remaining while a Clip renders

**Parent spec:** `../spec.md` (Solution "Time remaining"; Implementation Decisions "Model": `started_at`; "Frontend": the progress line).

**What to build:** a rendering Clip's progress line shows roughly how long it has left.
- **A Clip has `started_at`** while it renders, set when the worker starts it and cleared when it ends.
- **The progress line** shows the time left once progress passes 2%: elapsed / progress × (1 − progress), from `started_at` and the Job's progress.
  - The wording is "almost done" at 1 s or less, "Ns left" under a minute, and "M:SS left" otherwise.
  - It updates as progress comes in, without flicker.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A rendering Clip carries `started_at` through the API, and a finished or failed one doesn't.
- [x] Vitest:
  - the wording at 0.5 s, 40 s and 130 s;
  - nothing is shown under 2% progress;
  - the arithmetic from `started_at` and progress.

## Comments

**2026-10-18, agent:** Built.
- **Model** (`app/clips.py`): `Clip.started_at` (None by default, so stored Clips read without a migration). The worker sets it in `Renders._next` as it starts a Clip, and clears it in `_render`'s `finish` (done, failed or queued again) and in `recover` (a Clip left rendering is queued again without one). The API's Clips carry it as they are.
- **Editor**: `Clip.started_at` in `api.ts`. `formatTimeLeft` and `timeLeft` in `format.ts`: elapsed / progress × (1 − progress) from `started_at`, the Job's progress (0–100) and now; null at 2% or less; worded "almost done" (1 s or less), "Ns left" (rounded, under a minute) and "M:SS left" (`formatClock`). `RenderState` in `Clips.tsx` shows it after the percent ("Rendering 45% · 1:30 left"), worked out in a `useMemo` on `started_at` and progress, so it changes only as progress comes in, in tabular figures.
- Not done: the MCP's Clip view doesn't show `started_at` (the ticket asks for the progress line only).
- Tests: `backend/tests/test_render.py` (a rendering Clip held at its transcription carries `started_at`; a done one and a failed one don't) and `frontend/src/format.test.ts`. The progress line was checked through `timeLeft`, not in a browser.
