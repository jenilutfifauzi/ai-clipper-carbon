# 10: Home & live progress UI

**Parent spec:** `spec.md` in this feature folder (Milestone M3; user stories 1, 6–10, 13–17, 68; Frontend and HTTP API modules).

**What to build:** I open the app in my browser. The **Home** page lets me:
- submit a URL with an optional Brief and options (duration range, captions on/off, language);
- see my recent Jobs and their status, and delete one;
- see a disk meter with a low-space warning.

The **Job** page shows live per-stage progress over server-sent events, including errors with a retry button and the `waiting_quota` state.

This ticket also scaffolds the frontend (Vite, React, TypeScript, Tailwind v4) with the design tokens: black, white, orange `#FF9F0A`; dark by default, light as the alternative.

**Blocked by:** 07 (Job resilience), 08 (Selection gate), 09 (Audio-signal mode; resolved as done or `wontfix`).

**Status:** ready-for-agent

- [ ] The backend serves the built frontend. A dev command runs backend and frontend together.
- [ ] A server-sent events stream per Job emits stage, percent, status, and message. The Job page updates live without refresh.
- [ ] Submitting a URL creates a Job and navigates to its Job page.
- [ ] Recent Jobs are listed with their status. Deleting a Job asks for confirmation.
- [ ] The disk meter shows usage and free space, and warns below 10 GB.
- [ ] The `error` state shows its message and a retry action. The `waiting_quota` state is shown distinctly.
- [ ] The design tokens are applied, with dark as default and light available. Basic `prefers-reduced-motion` support is in place.
- [ ] Seam A test: the events stream emits the expected sequence for a Job run on fakes.
- [ ] Browser check: submit a URL, watch the progress, and reach `review`.
