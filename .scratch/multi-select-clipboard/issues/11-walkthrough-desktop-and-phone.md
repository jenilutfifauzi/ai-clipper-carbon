# 11: Walkthrough on a desktop and a phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions: the browser walkthrough).

**What to build:** the owner and the agent walk through the whole feature on a real Job and confirm it matches the spec.

- **Desktop:**
  - Shift- and Cmd-click, the rubber band, and scrubbing on the ruler.
  - Cmd+A and Esc.
  - Delete, duplicate and split of a mixed Pick.
  - A group drag on the Timeline and on the preview.
  - "Editing N layers" with Mixed values.
  - Copy, cut and paste within a Candidate, into another Candidate of the same Job (with a corrected caption Word), and into another Job.
  - Undo of each in one step.
  - The Pick after an agent edit removes a picked item.
- **Phone:** picking mode, its bar, Paste, and that a long press still drags.
- **Fixes:** anything found is fixed here, or filed as a new ticket in this folder.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10.

**Status:** ready-for-human

- [ ] Each step above is checked by the owner.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
