# 10: Home & live progress UI

**Parent spec:** `spec.md` in this feature folder (Milestone M3; user stories 1, 6–10, 13–17, 68; Frontend and HTTP API modules).

**What to build:** I open the app in my browser. The **Home** page lets me:
- submit a URL with an optional Brief and options (duration range, captions on/off, language);
- see my recent Jobs and their status, and delete one;
- see a disk meter with a low-space warning.

The **Job** page shows live per-stage progress over server-sent events, including errors with a retry button and the `waiting_quota` state.

This ticket also scaffolds the frontend (Vite, React, TypeScript, Tailwind v4) with the design tokens: black, white, orange `#FF9F0A`; dark by default, light as the alternative.

**Blocked by:** 07 (Job resilience), 08 (Selection gate), 09 (Audio-signal mode; resolved as done or `wontfix`).

**Status:** done

- [x] The backend serves the built frontend. A dev command runs backend and frontend together.
- [x] A server-sent events stream per Job emits stage, percent, status, and message. The Job page updates live without refresh.
- [x] Submitting a URL creates a Job and navigates to its Job page.
- [x] Recent Jobs are listed with their status. Deleting a Job asks for confirmation.
- [x] The disk meter shows usage and free space, and warns below 10 GB.
- [x] The `error` state shows its message and a retry action. The `waiting_quota` state is shown distinctly.
- [x] The design tokens are applied, with dark as default and light available. Basic `prefers-reduced-motion` support is in place.
- [x] Seam A test: the events stream emits the expected sequence for a Job run on fakes.
- [x] Browser check: submit a URL, watch the progress, and reach `review`.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 145 passed (8 new in `test_events.py`, about 3 s). `npm run build` and `npm run typecheck` pass. Browser check done with real yt-dlp and DeepSeek (below).

**Commands.**
- `make setup` now also runs `npm --prefix frontend ci`; `prerequisites` checks for npm (Node 20.19+ or 22.12+).
- `make dev` runs uvicorn (`--reload`, :8000) and Vite (:5173) in one shell; Ctrl-C (SIGINT to the group, plus a `trap 'kill 0'`) stops both. Open http://localhost:5173. Vite proxies `/api` and `/media` to :8000.
- `make build` builds `frontend/dist`. When `frontend/dist/index.html` exists, the backend serves it at http://127.0.0.1:8000: real files as they are, `index.html` (no-cache) for every other path so client routes survive a reload; unknown `/api/*` and `/media/*` stay 404. `Settings.frontend_dir` (not from the environment) points at the build; tests override it.

**Server-sent events** (`GET /api/jobs/{id}/events`, `app/events.py`, FastAPI's built-in `EventSourceResponse`, which also sends `: ping` keep-alives every 15 s).
- `event: job`, data `JobProgress {status, stage, progress, message, error, warnings, retry_at}` (`retry_at` from `Job.quota` while `waiting_quota`). One now, then one per change. Changes that leave this payload as it was (recording the Source, say) send nothing.
- `event: end`, data `"review"`, `"error"` or `"deleted"`, then the stream closes. `waiting_quota` and `queued` keep it open, since the Job carries on by itself. After a retry, the client opens a new stream. An unknown Job is a plain 404 (checked in a dependency, because a streaming route can't answer 404 once it has started).
- **No polling of the worker.** `JobStore.watch(listener)` registers a callback that `_save` (create, update) and `delete` call with `(job_id, Job | None)`, on the writing thread and under the store's lock, so changes arrive in order. The stream's listener hands each new Job to its asyncio loop with `call_soon_threadsafe` into a queue, so every change is sent even when several come within one tick.
- **CLI runs.** Another process's changes (a `make retry`/`analyze` holding the run lock) aren't announced, so the stream also re-reads `job.json` after 2 s without news (`RECHECK_SECS`). Those changes arrive coalesced, at most 2 s late. A queued change older than one a recheck already read is dropped.
- Client disconnects cancel the generator, which leaves `watch()` and unregisters.

**Tests** (`test_events.py`, Seam A). TestClient only returns a streamed body after the stream ends, so the live tests run the app on a real uvicorn server on a free port in a thread and read it with `httpx.stream`. They connect while `FakeVideoSource` is held in `downloading`, then release it:
- the whole run: `downloading → transcribing → analyzing → review`, then `end: review`; analyzing's percents never go down, a "Scoring…" message appears, and no two events are the same;
- a quota error: `… analyzing → waiting_quota (message and retry_at) → queued → analyzing → review`;
- a queued Job deleted while streaming ends with `end: deleted`.
TestClient tests: a Job already in review (one event plus end), a failed download (stage, error with the hint, `end: error`), 404, and the SPA serving with and without a build. Mutation-checked: with no store notification (recheck only), or without the de-duplication, a live test fails.

**Frontend structure** (`frontend/src`), for tickets 11 and 18:
- `api.ts`: typed client for every route so far. It includes `JobDetail.transcript`/`candidates` and the `Candidate`, `Transcript`, `Word` and `Segment` types ticket 11 needs. `ApiError(status, message)` carries FastAPI's `detail`. Add the Candidate update, manual and render calls here.
- `hooks/useJobEvents.ts`: `{progress, ended, lost, reconnect}`, built on EventSource. It closes on `end`, and EventSource reconnects by itself while the backend restarts.
- `stages.ts`: `STAGES` (Download, Transcript, Analyze, Review), `stageStates(progress, reached)`, `ACTIVE`. Ticket 12 adds ASR/Render stages here.
- `components/`: `Panel`, `Button` (primary/secondary/danger/ghost), `StatusBadge`, `ProgressBar`, `StageProgress`, `DiskMeter`, `ConfirmDialog` (native `<dialog>` with `showModal`, so focus trap and Esc come free). They map to the PLAN's `GlassPanel`, `GlassButton`, `StageProgress` and `DiskMeter`. Ticket 18 restyles them in place.
- `pages/Home.tsx` (`home/NewJobForm`, `home/RecentJobs`), `pages/JobPage.tsx` (`job/JobStatusNotes`: error with retry, quota wait, warnings), `pages/NotFound.tsx`. Routes in `main.tsx`: `/` and `/jobs/:jobId` under the `App` shell; the Channel Profile page goes there too.
- **The Review UI goes in `JobPage`** where `job/CandidateList.tsx` (a read-only list: rank, title, range and length, predicted score) renders today. The Job is fetched again when its stream ends, which is how the Candidates arrive.
- **Tokens:** `styles/tokens.css` holds the CSS variables. Dark is the default; `@media (prefers-color-scheme: light)` switches to light. `index.css` maps them into Tailwind v4 with `@theme inline` (`bg-bg`, `bg-surface`, `text-muted`, `bg-accent`, `text-accent-text`, `text-danger`, `text-waiting`, `rounded-panel`, `rounded-control`, …). Components never use raw colours. `--accent-text` is a darker orange (`#b25000`) in light, because `#FF9F0A` on white is under 4.5:1. For ticket 18's toggle, add `:root[data-theme=…]` blocks in tokens.css. Glass blur, blobs and springs aren't done.
- **Motion:** spinners, the sweep and transitions are `motion-safe:` only, and a global `prefers-reduced-motion: reduce` rule zeroes animation and transition durations. `<meta name="color-scheme" content="dark light">` and `color-scheme` on `:root` theme native controls and scrollbars.
- Versions are pinned exactly: React 18.3.1, react-router 7.18.4 (8.x needs React 19), Vite 8.3.1, @vitejs/plugin-react 6.1.1, Tailwind 4.3.3, TypeScript 6.0.3, lucide-react 1.48.0. `package-lock.json` is checked in for `npm ci`.

**UI behaviour.**
- **Home:** URL (`type=url`, required), Brief (Cmd/Ctrl+Enter submits), shortest/longest clip (a custom validity when min ≥ max, shown after interaction via `user-invalid`), language (code with datalist suggestions, same pattern as the backend), and a captions switch. Submit disables while posting, shows the server's message on failure, and navigates to `/jobs/<id>`.
- **Recent Jobs:** newest first, with status badge, relative time and Brief. The list is fetched again every 4 s only while some Job is queued, running or waiting. Delete opens a confirmation dialog; a 409 shows the server's message inside the dialog.
- **Disk meter:** free of total, used share, AI Clipper's own size, and a red alert when `warning`.
- **Job page:** the four stages with the current one's message and percent (indeterminate while the percent is unknown). `waiting_quota` gets its own blue note with "until HH:MM:SS" and the message. `error` gets a red note with the error and "Retry from <stage>". Then warnings, and Candidates in review.

**Browser check** (ego-browser, `make dev`, real yt-dlp, `LLM_PROVIDER=openai` / DeepSeek). I submitted https://www.youtube.com/watch?v=9xo4pOaTsxY with the Brief "find the most insightful moment". It went to `/jobs/526e4c2a9a79`, which showed Download in progress with the sweep bar. Without a reload, it reached Ready for review with all four stages ticked about 11 s after submitting: download 4.4 s, transcript instant from the captions, analyze 6.7 s. One Candidate: "#1 Ide Podcast Terpendek di Dunia, Bisa Lebih Pendek dari Ini? 0:00–0:20 · 21 s, score 68". The server log shows a single events connection for the whole run. Also checked:
- an `error` Job's page (red note and retry button; not clicked, since it's the owner's legacy Job);
- the delete dialog (opened, closed with Esc, focus returned to the trash button);
- the light theme via emulated `prefers-color-scheme: light`.
The dev servers were stopped with SIGINT to `make dev`'s group, and both exited. Job `526e4c2a9a79` is left in `data/jobs/`.

Open issues:
- **The download stage has no percent.** yt-dlp progress isn't reported, so the bar is indeterminate. A `progress_hooks` callback in `YtDlpVideoSource` could feed `progress`.
- **No live list on Home.** It uses a 4 s poll while Jobs are active, rather than a list-wide event stream.
- **Not done here:** phone width (story 69), the theme toggle and glass polish, all ticket 18. No retry-now for `waiting_quota`, and no cancel (as in ticket 07).
- **`make dev` and early exits.** If one server dies at start (say a port in use), the other keeps running until Ctrl-C.

**2026-10-14: verified by the owner's session.** The backend suite passed with both agents' work in the tree. A browser check reached review. Committed separately from the concurrent prompt-v3 work. Note: the gate (ticket 08) is still open waiting for the owner's Reference Set; the owner asked to continue with all remaining tickets regardless.
