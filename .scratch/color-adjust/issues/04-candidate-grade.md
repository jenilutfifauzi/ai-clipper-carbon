# 04: The Candidate's Grade, in the Advanced Edit and the clip editor

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview", "Advanced Edit UI", "Clip editor", "MCP").

**What to build:** the Candidate has its own `grade`.

**What it covers:**
- **In the render,** it is laid over the joined Main Track after the Segments' Grades and the Transitions, before the Overlays. Overlays are never touched by it.
- **In the preview,** it is a filter on a wrapper around the Main Track's pictures (the decks, the ghost and media Segments), not around the Overlays.

**Where the owner sets it:**
- in the Advanced Edit, in the Inspector's Color section with nothing picked;
- in the clip editor, in a new Color section with the same dials and reset.

The clip editor's preview draws every Grade.

**The agent** sets `grade` on the Candidate through `edit_candidate` and merges it field by field. The dry run's plan view shows it.

**Blocked by:** 01.

**Status:** done

- [x] **Render:**
  - The Candidate's Grade changes a Segment's frames, stacked on that Segment's own Grade.
  - It leaves an Overlay's pixels unchanged.
  - A Clip of one range (no Segments) is graded.
- [x] **Planner:** the plan carries the Candidate's Grade.
- [x] **MCP:** merge sets one dial, and the dry run lists it.
- [x] **Editor (vitest):** with nothing picked, a dial change edits the Candidate's Grade as one undo step.
- [x] **Clip editor:** its Color section edits the same Grade, and the change survives a save and reload.

**Notes (done):** the render lays the Candidate's Grade on `[frame]`, the joined Main Track (a Clip
of one range's frame chain alike), before the Overlays. The preview filters the Main Track's wrapper
(decks, ghost and media Segments) with `DecksGraded`, the Overlays outside it, and draws the draft's
Grade at once (`draftGrades`' fourth argument), so a one-range Clip's first dial drag shows before
its plan comes. The clip editor's Color section is a new Color tab (`editor/ClipColor.tsx`), saved
a moment after the last dial moves. With nothing picked, `regrade` grades the Candidate. A Candidate
Grade needs no review.py handling: it is stored on the Candidate, whether its Main Track is cut or
not. Revision History names the part "Color". MCP: `grade` on edit_candidate (whole) and on
merge_candidate_items (field by field); the dry run lists it at the top of the plan view.
