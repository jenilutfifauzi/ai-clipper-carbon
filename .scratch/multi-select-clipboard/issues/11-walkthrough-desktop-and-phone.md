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

**Status:** done

- [x] Each step above is checked by the owner.
- [x] `npm run typecheck`, `npm test`, `npm run build` pass.

## Comments

**2026-10-15: the agent's checks in the browser (ego-browser), before the owner's walkthrough.** On Job 934fb0fe1f9a, every desktop step above but the Pick after an agent edit was run while building tickets 02–10. Three more were checked afterwards:
- A Segment of Candidate #2 with a corrected caption Word ("ORANGKU"), copied and pasted into Candidate #3, shows the correction in #3's captions and saves it. When #3 already had its own correction of that Word ("ORANGB", saved as the agent), #3's stayed.
- With two Segments and a Text Layer picked, dragging Segment 1 past Segment 2 reorders only it, the Pick becomes that Segment, and one undo puts it back.
- At 390 px with touch emulation: a swipe across a Text Layer scrolls the Timeline and leaves the item where it was; a long press then a drag moves it (0 s to 3.4 s).

Both test Candidates were restored to Revision 1 afterwards. Still the owner's: the walkthrough itself, and a real phone.

**2026-10-15: done.** The owner walked through the feature and it passed. Pasting Segments between A and B leaves A's Transition on A, so it plays into the first Segment pasted, as duplicating a Segment already does (the agent's recommendation; unchanged from the build).
