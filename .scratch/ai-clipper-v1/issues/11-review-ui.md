# 11: Review UI

**Parent spec:** `spec.md` in this feature folder (Milestone M3; user stories 22–24, 30–40; Review operations and HTTP API).

**What to build:** On a Job in `review`:
- I see the ranked Candidates with their scores and reasoning.
- I preview any Candidate instantly from the Source video.
- In the Transcript Picker I click words to set a Candidate's start or end, which snap to word boundaries. I select a transcript range to add a manual Candidate.
- I edit the hook text, choose a layout override (Auto, Track, Split, or Blur), copy the platform descriptions, and select Candidates for rendering.

Every edit is saved immediately and survives a page reload.

**Blocked by:** 10 (Home & live progress UI).

**Status:** ready-for-agent

- [ ] The API updates a Candidate's start and end (re-snapped to Words), hook text, layout override, and selected flag.
- [ ] The API adds a manual Candidate from a transcript range. It is snapped, marked "manual", has no AI score, and appears in the list.
- [ ] Media is served with HTTP range support. The preview starts at the Candidate's start and stops at its end.
- [ ] The Transcript Picker shows the words around the Candidate with the current bounds highlighted. Clicking a word sets start or end.
- [ ] Copy buttons work for the title and the TikTok, Instagram, and Shorts descriptions.
- [ ] After a reload, every edit is still there.
- [ ] Seam A tests cover:
  - an update re-snaps to Words;
  - a manual Candidate is added and listed;
  - a range request returns partial content.
- [ ] Browser check: adjust bounds, add a manual clip, edit the hook, set an override, and select Candidates.

## Comments

**2026-10-13 (from ticket 05).** `make eval` and `make reanalyze` re-run selection on an existing Job and replace its Candidates. Once review edits exist, re-running selection must not silently throw away the owner's edits or manual Candidates. Either keep edited and manual Candidates, or make the eval analyze into a separate run that leaves the Job's review state alone.
