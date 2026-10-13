# 16: Hook overlay

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 36, 55–56; Render Planner hook rules).

**What to build:** Each Clip shows its hook text, including any edit made in Review, for the first 3 seconds. The hook sits at the top, just below the safe zone, as white Montserrat text in a dark semi-transparent box. It never overlaps the captions.

**Blocked by:** 15 (Burned captions from per-clip transcription).

**Status:** ready-for-agent

- [ ] The latest hook text is used. It wraps to at most 2 lines, and Review warns when the text is too long to fit.
- [ ] The hook shows from 0 to 3 s, below the top safe zone, and does not overlap the caption region in any layout.
- [ ] An empty hook produces no overlay.
- [ ] Seam B tests cover timing, line limit, position within the safe zone, and no overlap with captions.
- [ ] Manual visual check on a real Clip.
