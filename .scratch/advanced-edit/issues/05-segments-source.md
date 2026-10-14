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

**Status:** done

- [x] Every existing Candidate and fixture plans and renders byte for byte as before.
- [x] Seam B: a middle piece deleted gives the expected Scenes, captions and duration.
- [x] Seam B: reordered Segments; Word Edits applied in both copies of a repeated piece.
- [x] Seam A: a 3-Segment render has the summed duration and the right frame at each join.
- [x] Preview seeks and plays across joins without visible stalls on desktop and phone.
- [x] Undoable; typecheck and build; browser walkthrough.

## Comments

**2026-10-14: done.** ADR 0002 records the model.

**Model:**
- `segments` is empty for a Clip that isn't cut.
- `start`/`end` are kept: the range, or the hull.
- An edit that leaves one Segment is stored as a plain range.

**Checks:**
- `tests/test_segments.py`:
  - Seam B: each Segment framed on its own and joined; caption lines broken at a cut; a one-range Clip unchanged.
  - Seam B: Word Edits and Layout Overrides applied in both copies of a repeated piece.
  - Seam A: Segments saved, snapped and validated; a whole-clip trim refused while cut; back to one Segment as a plain range.
  - Seam A: a 3-Segment render of a brightening Source shows each piece's own moment, in order, at the summed length.
- The full backend suite passes. `tests/test_selection.py`'s full Candidate JSON gained the fields added since ticket 02; it had been failing since then.
- `npm run build`.
- Browser on a copy of a real Job:
  - Split twice with Cmd+B and deleted the middle piece (saved, snapped, 22.9 s).
  - Played across the join: the video jumped to the second piece.
  - Dragged the second piece first (reordered), then undid it.
  - Opened "Add from the episode" on the Transcript.

**Changes from the plan:**
- The preview jumps at a join with a seek on the same video, not a preloaded second one. On a local file the pause is short. A second video for the next Segment would hide it, and is left for later.
- Clicking the Video track selects a Segment. "Original sound" moved to the Segment's inspector.
- The clip editor shows a cut Clip's preview and caption text. Its trim and Source-time Timeline give way to a note with a link to the Advanced Edit.

**2026-10-14: review fixes.** **Splitting, inserting, trimming and snapping** on the Main Track go by the plan's Segments (snapped, with Transition overlaps). A Source Segment is split in the silence between Words, which stops the snapping from repeating a Word on both sides.

**The clip editor keeps a cut Clip's Timeline,** on its own time: the Segments (read-only), the Scenes with their Layout picker (mapped to Source time per Segment), the captions and the hook.

**Validation:**
- The longest-clip check counts Transition overlaps (`tests/test_advanced_rules.py`).
- A Source Segment has its own volume.
