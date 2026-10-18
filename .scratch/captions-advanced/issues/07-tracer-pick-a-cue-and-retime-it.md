# 07: Tracer: pick a Cue and retime it

**Parent spec:** `../spec.md` (Domain and model: `cue_edits`, Revisions; Planning Cues: a Cue Edit's Word starts a Cue, timing and clamping; Advanced Edit: Pick, Captions Track, Clipboard); docs/adr/0020-media-words-and-cue-edits.md; user stories 23–26, 37 (timing), 38, 39, 40 (Cue Edits), 48.

**What to build:** the owner fixes one caption that comes up late or vanishes early.

**Model:**
- `Candidate.cue_edits` (at most 500) holds Cue Edits keyed by `(media, at)`, matched to a Word as Word Edits are.
- This ticket uses their timing fields: `shift` moves the Cue and its Words' highlight; `start_delta` and `end_delta` move one edge of what is shown. All are seconds on that timeline, bounded at ±10 s.
- The fields `x`, `y`, `scale` (08) and `join` (09) are added later.
- A new Revision part, "Cue Edits", merges item by item.

**Planning:**
- A Cue Edit's Word always starts a Cue.
- Its timing is applied (divided by the Segment's Speed) and clamped: inside its Segment's span, not before the previous Cue's shown end, not after the next Cue's shown start, at least the minimum length. Highlight times are clamped into the span.
- The Cue reports `edited`. Cue Edits whose Word isn't shown are listed as unused and kept.

**Advanced Edit:**
- A new Pick kind, a Cue, alone. Clicking a Cue on the Captions Track picks it; clicking the Track's label picks the captions.
- On a picked Cue, edge drags write the deltas and a body drag writes `shift`. They snap and are clamped as the planner clamps. One drag is one undo step.
- Edited Cues show a dot. The inspector has Reset timing.
- A locked Captions Track refuses all of it.
- Copying Segments carries the Cue Edits of their range, and pasting adds those missing.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Planner: `shift` moves the Cue and its highlight. Edge deltas move only the edges. Both halve on a 2× Segment. Each is clamped by neighbours and the Segment.
- [ ] Planner: a Cue Edit's Word still starts a Cue after `max_chars` changes.
- [ ] Planner: a Cue Edit whose Word is trimmed out is unused, and applies again when the trim is undone.
- [ ] HTTP: out-of-range shifts are refused. A Revision merge keeps both editors' Cue Edits on different Cues.
- [ ] vitest: edge and body drags write the expected fields with clamping. Reset timing drops an empty Cue Edit. The Clipboard carries Cue Edits. A locked Track refuses.
- [ ] The MCP accepts `cue_edits` (timing fields) in `edit_candidate`, `merge_candidate_items` (field by field) and `remove_candidate_items`.
- [ ] Browser walkthrough: pick, drag edges and body, undo, Reset timing. The render matches the preview's timing.
