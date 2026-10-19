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

**Status:** done

- [x] Planner: `shift` moves the Cue and its highlight. Edge deltas move only the edges. Both halve on a 2× Segment. Each is clamped by neighbours and the Segment.
- [x] Planner: a Cue Edit's Word still starts a Cue after `max_chars` changes.
- [x] Planner: a Cue Edit whose Word is trimmed out is unused, and applies again when the trim is undone.
- [x] HTTP: out-of-range shifts are refused. A Revision merge keeps both editors' Cue Edits on different Cues.
- [x] vitest: edge and body drags write the expected fields with clamping. Reset timing drops an empty Cue Edit. The Clipboard carries Cue Edits. A locked Track refuses.
- [x] The MCP accepts `cue_edits` (timing fields) in `edit_candidate`, `merge_candidate_items` (field by field) and `remove_candidate_items`.
- [ ] Browser walkthrough: pick, drag edges and body, undo, Reset timing. The render matches the preview's timing.

## Comments

**2026-10-19, agent:** Built.

**Model.**
- `CueEdit` (`app/candidates.py`): `at`, `media` (None: the Source), `shift`, `start_delta`, `end_delta`, each ±`CUE_SHIFT_MAX_SECS` (10). `Candidate.cue_edits` (at most 500, `CUE_EDITS_MAX` in `app/api.py`).
- Saved by key: `review._keyed` keeps the later of two at one `(media, round(at, 3))`, sorted by timeline then time. A Cue Edit with every field 0 is kept: it still starts its Cue (ticket 09's Split will lean on that).
- "Cue Edits" is a Revision part (`app/revisions.py`). The Clip record doesn't copy them: it is stale by Revision.

**Planner** (`app/planner.py`):
- `plan_render(cue_edits=...)` takes them on their own timelines, unlike the other times. A Clip of one range uses the Source ones, from its `start`. With a Main Track, `_segment_cue_edits` gives each Segment those of its timeline (the Source's, or its item's by `media`) within WORD_EDIT_REACH_SECS of its range. They go into seconds into the Clip, divided by its Speed. A Freeze frame or a reversed Segment gets none.
- `match_edits` is generic over anything with `at`, so Cue Edits match Words exactly as Word Edits do.
- In `_captions`, a Cue Edit's Word always starts a Cue. Each Cue is planned as before, and then an edited one is moved by `shift` and has its edges moved by the deltas. After that it is clamped:
  - start within `[max(Segment start, the Cue before's shown end), high - CAPTION_MIN_SECS]`;
  - end within `[start + CAPTION_MIN_SECS, high]`;
  - `high` is the Segment's end (cut to cut, a Transition at its middle) or the next Cue's start, whichever is sooner. For an edited next Cue that start is `max(its first Word's start, its moved start)`: of two Cues reaching for each other, the earlier keeps its place.
- Highlights move by `shift`, clamped into the shown span, and the first Word is highlighted from when the Cue comes up. An earlier start therefore shows the Cue, not a gap.
- Unedited Cues plan exactly as before.
- `Cue.edited` is set. `RenderPlan.unused_cue_edits` lists the given Cue Edits whose Word isn't shown: out of range, removed by a Word Edit, or on another timeline.

**API / MCP.**
- `CandidateUpdate.cue_edits` replaces the list, and the preview plan carries `unused_cue_edits`.
- MCP:
  - `cue_edits` is in `ITEMS`. Items are keyed by `at` plus `media` (`ON_MEDIA`, `_matches`), merged field by field, and removed by `at` or by `"media:at"`.
  - The dry run's Cues say `edited` (only when true) and `joinable`, and it lists `unused_cue_edits` (only the fields set).
  - The instructions explain Cue Edits.
  - TOOLS_BUDGET_BYTES went from 69_000 to 71_500 for the new schemas.

**Frontend.**
- Types: `CueEdit` and `CUE_SHIFT_MAX_SECS` in `api.ts`, and `cue_edits` in `AdvancedEdits` (`editsOf` defaults it to []).
- `editor/merge.ts` keys `cue_edits` by `media@at` (a key may now be a function). Collisions name the part "Cue Edits".
- Pick (`advanced/pick.ts`):
  - a new kind `{ kind: "cue", key }`;
  - `sameCue` compares keys;
  - `unlockedPick` drops a Cue on a locked Captions Track;
  - `prunedCue` drops it once the plan has no Cue of its key. AdvancedEdit runs it after the Preview Plan.
- `advanced/cueEdits.ts`:
  - `cueOf(plan, key)` returns the shown span (same-key entries at a Layout change are one Cue), its Segment's Speed, and `low`/`high`, the planner's bounds;
  - `shownCues(plan)`;
  - `cueEditOf(edits, plan, key)` finds the Cue Edit on a Cue, even one written at another time in its first Word;
  - `retimeCue(scene, key, range, from)` handles a body or edge drag. It writes `shift`, `start_delta` or `end_delta`, continuing from the Cue Edit as the drag began, clamped as the planner clamps and multiplied by the Speed;
  - `resetCueTiming(scene, key)` clears the timing and drops the Cue Edit when nothing is left;
  - both return null on a locked Captions Track.
- `Tracks.tsx`:
  - the Captions Track draws each Cue once as a `TimelineItem`, with a dot when edited;
  - clicking a Cue picks it and seeks into it;
  - only a picked Cue drags: edges and body, snapping as other items, bounded by `low`/`high` and CUE_MIN_SECS, each drag one undo group;
  - the Track's label "Captions" is a button that picks the captions;
  - the label keeps its hide and lock buttons, and doesn't pick while the Track is locked.
- Inspector: a picked Cue shows its plain text, its start and end, and Reset timing.
- Clipboard (`clipboard.ts`): copying Segments carries the Cue Edits of their ranges, each on its own timeline. Pasting into another Candidate of the Job adds the Source's ones it hasn't got on that Word, and an item's Cue Edits come along into any Candidate unless one is at the same time.

**Checks.**
- Seam B (`tests/test_planner.py`, 7 new):
  - shift and edges, with highlights;
  - clamping by neighbours, the Clip and the minimum, and the earlier-keeps-its-place rule;
  - halved at 2x and kept in its Segment at a cut;
  - a Cue Edit's Word starts a Cue under Sentence, wider, default and 8-character limits;
  - unused when trimmed out, or when its Word is removed by a Word Edit, or on another timeline, and applied again when restored;
  - a media Segment's Cue Edits on its item's timeline.
- Seam A (`tests/test_render.py::test_cue_edits_are_saved_previewed_and_rendered`, real ffmpeg):
  - saved and de-duplicated, previewed;
  - the rendered `plan.json` equals the preview plan with the Cue Edits applied;
  - an unseen Cue Edit is listed as unused and kept;
  - shifts over 10 s, a bad media id, a missing `at` and 501 items are refused.
- `tests/test_revisions.py`: two agent merges at once keep both Cue Edits on different Cues, and the Revision History names the part "Cue Edits".
- `tests/test_mcp.py`: the dry run's edited, joinable and unused fields, field-by-field merge with `media` told apart, and removal by `at` and `media:at`.
- vitest `advanced/cueEdits.test.ts` (14):
  - shown span and bounds, a Transition's cut;
  - body, edge and short drags with clamping, from the drag's origin, at 2x;
  - `cueEditOf`;
  - Reset timing dropping an empty Cue Edit;
  - a locked Track refusing, and pruning;
  - the Clipboard carrying and pasting Cue Edits;
  - merges keeping both editors' Cue Edits, and colliding on one.
- Totals: frontend vitest 886 passed, typecheck clean, `npm run build` clean (after merging feat/captions-advanced with 04 and 10, and main). Backend full suite: 860 passed (a timing flake in test_audio_signal passed on a rerun; test_selection's expected Candidate gained `cue_edits`).
- Browser walkthrough: the built frontend on a copy of one Job in a scratch DATA_DIR, desktop 1440 wide.
  - Clicked "BERPESAN KEPADA" on the Captions Track: it was picked and the inspector showed Caption, 1.81 s–2.55 s and a disabled Reset timing.
  - Dragged its end edge 0.3 s earlier, then its body 0.2 s later. Saved `{shift: 0.197, end_delta: -0.299}`. The dot showed, and the preview had no caption at 1.9 s.
  - One Undo took back the body drag only.
  - Reset timing dropped the Cue Edit (`[]`).
  - Clicking the "Captions" label picked the captions (Caption Style panel).
  - Locking the Captions Track made its Cues unclickable ("Nothing selected").

**Not done / deviations.**
- No Clip was rendered in the browser. That the render matches the preview's timing is checked by the Seam A test (the rendered plan equals the preview plan), so the walkthrough box stays unticked.
- The inspector shows start and end as read-only values, not fields that write the deltas (the spec's inspector list; this ticket asked only for Reset timing).
- Zoom to fit doesn't fit a picked Cue (it fits the whole Clip, as with nothing picked).
- For ticket 09: Reset timing drops a Cue Edit once its timing is cleared, which would also drop a Split-only Cue Edit (all zeros). 09 should keep a Cue Edit that only starts a Cue, or Split should mark it.

**2026-10-19, agent (review fixes):** Cue bounds and matched Cue Edits now come from the plan (ADR 0001), and a clamped Cue keeps the minimum.

- **The frontend no longer repeats planner rules.** `cueEdits.ts` dropped its copies of `CAPTION_MIN_SECS` and `WORD_EDIT_REACH_SECS`, the cut and neighbour arithmetic in `cueOf`, and the distance matching in `cueEditOf`. They had drifted: a Cue Edit written early in a Word longer than 0.5 s applied in the plan, but the UI couldn't find it. The bounds also differed, because the UI capped at the next Cue's shown start and the planner at its first Word's start.
- **New on each planned `Cue`** (`app/planner.py`, `api.ts`):
  - `low`, `high`: where a Cue Edit keeps it;
  - `speed`: its Segment's;
  - `word_ats`: each Word's middle on its timeline;
  - `cue_edit_ats`: the `at`, as sent, of the Cue Edit matched to each Word.
- **New on `RenderPlan`:** `cue_min_secs` (CAPTION_MIN_SECS).
- **How the frontend reads them:**
  - `cueOf` reads `low`, `high` and `speed`, and gains `minSecs`, which the Track and the time fields use.
  - `cueEditOf` is the Cue Edit at `cue_edit_ats[0]`. Until the plan catches up, it falls back to one written exactly at the Cue's key, which is what a drag writes.
- **Clamping** (`_captions`): a retimed Cue is never dropped.
  - What the Cue before may not pass (`reaches`) is now worked out from the last Cue back. A Cue moved later leaves itself CAPTION_MIN_SECS before what follows.
  - A Cue whose Words start closer than that to what follows starts earlier, and the Cue before gives way, though never into its own first CAPTION_MIN_SECS.
  - Where its Segment leaves less room than that, the Cue fills the room it has.
  - Unedited Cues and roomy edits plan as before.
- **Tests:**
  - `test_planner.py`: `test_a_retimed_cue_short_of_room_keeps_the_minimum_and_isnt_dropped` and `test_each_cue_says_where_a_cue_edit_keeps_it_and_which_cue_edits_it_has`.
  - `cueEdits.test.ts` reads the bounds and the Cue Edit from the plan. The segment-cut case moved to the planner test.
- The dry run and MCP views are unchanged: no field changed shape.
