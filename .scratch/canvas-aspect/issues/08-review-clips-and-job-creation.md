# 08: Review, Clips and Job creation take the aspect

**Parent spec:** `../spec.md` (Implementation Decisions "Frontend", "Renderer and export": the saved frame; User Stories 1, 36–37, 43).

**What to build:** the aspect shows everywhere outside the Advanced Edit.
- **Job creation:** the form (URL, upload or file) has an aspect choice: 9:16 (default), 4:5, 1:1 or 16:9. It is sent as `JobOptions.aspect`.
- **Review:** the clip editor's preview takes the Candidate's shape, not a fixed 9:16 box.
- **Cards and posters:** Candidate thumbnails, Clip cards and posters take the Candidate's (or Clip's) shape. Mixed shapes line up on the page.
- **The saved frame (PNG)** has the Candidate's shape at the default Preset's resolution. A 4:5 frame is 1080×1350.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Seam A: a 4:5 Candidate's saved frame is 1080×1350.
- [ ] Jobs API test: a Job made with `aspect: "16:9"` keeps it in its options.
- [ ] Browser walkthrough: making a 16:9 Job; Review and the Clips page with a 9:16 and a 16:9 Candidate side by side (desktop and phone).
- [ ] `npm run typecheck && npm run build` pass.
