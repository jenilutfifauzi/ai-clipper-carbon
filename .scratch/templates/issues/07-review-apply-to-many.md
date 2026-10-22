# 07: Review: apply to many

**Parent spec:** `../spec.md` (Editor: Review page; Server: bulk apply).

**What to build:** on the Review page I brand a whole Job in one action, choosing exactly which Candidates.

- **"Apply Template…"** on the Review page opens a dialog with:
  - a Template picker, plus "No Template";
  - the Job's Candidates as a checklist, the ones selected for rendering already ticked;
  - a preview of each ticked Candidate's notices from a dry run.
- **Confirming** sends one apply request for all ticked Candidates.
  - The cards refresh from the Job's events.
  - Clips made before the apply show as changed since their render.
- **The dialog works on desktop and phone.**

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Vitest:
  - The selected Candidates are pre-ticked.
  - Unticking one leaves it out of the request.
  - One request is sent for all of them.
  - Notices from the dry run are shown per Candidate.
  - "No Template" is offered.
- [ ] Checked in the running app: applying to five Candidates updates their cards, and a rendered one shows as changed.
