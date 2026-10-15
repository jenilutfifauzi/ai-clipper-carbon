# 05: Rendering and Clips

**Parent spec:** `spec.md` in this feature folder (user story 14).

**What to build:**
- `render_clips(job_id, candidate_ids)` (the selected Candidates by default) and `list_clips(job_id)`, each Clip with its absolute `video_path` and `poster_path`.

**Blocked by:** 02, 04.

**Status:** done

- [x] Render, wait until review, and the Clips' paths exist on disk.
- [x] Nothing selected returns the API's message.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`: rendering with nothing selected returns "Select at least one Candidate"; a selected manual Candidate renders, the wait follows it back to review, and `list_clips` gives a done Clip whose `video_path` and `poster_path` exist, as long as its Candidate.
