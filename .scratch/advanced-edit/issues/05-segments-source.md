# 05: Main Track Segments (split, delete, trim, reorder the Source)

**Parent spec:** `spec.md` in this feature folder (user stories 10, 11, 15).

The largest change: a Clip stops being one range of the Source.

**What to build:**
- **ADR:** write ADR 0002 on Segments and Timeline time:
  - A Clip is a list of Segments.
  - Layers are anchored to the output.
  - Word Edits and Layout Overrides stay on Source time.
- **Model:**
  - `Candidate.segments: list[Segment]`, with Source Segments only in this ticket.
  - A Candidate saved before reads as one Segment from `start`/`end`.
  - Decide whether `start`/`end` stay as derived properties for Selection and Clips listing, and record the decision in the ADR.
  - Each Segment's ends snap to Words.
  - The longest-clip limit applies to the total.
- **Everything that assumes "Clip time = Source time − start" maps through the Segments instead:**
  - `planner.plan_render`, `rendering.candidate_plan`
  - `rendering.saved_words` and the per-range analysis cache
  - `renderer._range`, which becomes one trimmed branch per Segment, then `concat` (video and audio)
  - `Playback`, `ClipPreview` (seek across Segment boundaries), and the Timeline geometry
- **Captions:** built from each Segment's Words, with Word Edits applied by Source time (so a piece used twice is corrected in both places).
- **Workspace Main Track:**
  - Split at the playhead, delete (magnetic: no gaps), trim either edge, and drag to reorder.
  - "Add from Source" picks a range on the Transcript, like a manual Candidate.
- **Clip editor:** with more than one Segment, the Clip track is read-only with an "Edit in Advanced" link. With one, trimming works as today.
- **Glossary:** add **Main Track** and **Segment**, and update **Candidate**.

**Blocked by:** 02 (Timeline-time layers must exist first, so their anchoring is tested across cuts).

**Status:** ready-for-agent

- [ ] Every existing Candidate and fixture plans and renders byte for byte as before.
- [ ] Seam B: a middle piece deleted gives the expected Scenes, captions and duration.
- [ ] Seam B: reordered Segments; Word Edits applied in both copies of a repeated piece.
- [ ] Seam A: a 3-Segment render has the summed duration and the right frame at each join.
- [ ] Preview seeks and plays across joins without visible stalls on desktop and phone.
- [ ] Undoable; typecheck and build; browser walkthrough.

## Comments
