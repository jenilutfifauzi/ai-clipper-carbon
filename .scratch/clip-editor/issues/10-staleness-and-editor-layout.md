# 10: Changed-since-render, and the editor's final layout

**Parent spec:** `spec.md` in this feature folder (user story 28).

**What to build:**
- **Staleness:**
  - `RenderedClip.inputs`: a hash of everything a render used (range, hook, resolved styles, edits, timing, Layouts);
  - `JobDetail` gives each Candidate's current hash;
  - Clips show "changed since this render" when the two differ.
- **Editor layout.** `CandidateEditor` gets its final layout: the preview and the tabs side by side on wide screens, with the timeline full width below.

**Blocked by:** 01–09.

**Status:** ready-for-agent

- [ ] Any edit from tickets 01–09 marks a rendered Clip as changed, and undoing it clears the mark.
- [ ] Old `clips.json` files without `inputs` still load. They compare by the v1 fields.
- [ ] Browser walkthrough of every user story, in dark and light, at a laptop and a narrow width.

## Comments
