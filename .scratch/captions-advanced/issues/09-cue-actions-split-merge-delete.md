# 09: Cue actions: Split, Merge, Delete, and the Cue inspector

**Parent spec:** `../spec.md` (Domain and model: `CueEdit.join`; Planning Cues: `join`, `joinable`; Advanced Edit: Actions on a picked Cue, Inspector, Phone); user stories 31–35.

**What to build:** the owner reshapes and cleans up single captions.

**Model:**
- Cue Edits gain `join`. It is refused together with any other field.
- A `join` cancels a pause, sentence-end or longest-Cue break before its Word. The characters, Words and lines per Cue still part them.

**Actions on a picked Cue:**
- **Split** (Cmd/Ctrl+B with a Cue picked) adds a Cue Edit at the first Word that starts after the playhead. It is disabled when there is none.
- **Merge with next** removes the next Cue's starting Cue Edit and its first Word's `break_before`. It adds a `join` Cue Edit where a pause, sentence end or longest-Cue limit would still part them. It is disabled when the next Cue isn't `joinable`.
- **Delete** writes an empty-text Word Edit for each of the Cue's Words, as one undo step. The sound is untouched.

**Inspector of a picked Cue:**
- its Words as chips (the clip editor's caption text editor, shared): retype, remove, "New line here";
- its shown start and end as fields, writing the deltas;
- Split, Merge and Delete buttons.

On a phone, these come in the bottom sheet.

**Blocked by:** 03, 07.

**Status:** done

- [x] Planner: `join` keeps two Cues parted by a pause together, but not past `max_chars` × `max_lines`. `joinable` agrees.
- [x] HTTP: a `join` Cue Edit with a shift is refused.
- [x] vitest: Split at a playhead inside a Cue adds a Cue Edit at the right Word. Merge clears the next Cue's start, and adds `join` only when needed. Delete empties every Word in one undo step. All are refused on a locked Track.
- [x] vitest: chips retype and remove Words, and the start and end fields write the deltas.
- [x] The MCP accepts `join` in `cue_edits`.
- [x] Browser walkthrough at desktop and phone widths.

## Comments

**2026-10-19, agent:** Built.

**Model.** `CueEdit.join: bool` (default false, `app/candidates.py`). Its `__post_init__` refuses a join with any other field off its default (written over `fields()`, so ticket 08's `x`, `y`, `scale` are covered too). `join` is in `api.ts`'s `CueEdit`.

**Planner** (`_captions`):
- A join Cue Edit's Word goes on in the Cue before when it fits its lines (`_fits`) and isn't parted by a cut or a Layout change, despite a pause, a sentence's end or `max_secs`. Otherwise it starts a Cue, unmoved (its timing is never applied; `edited` stays false).
- A join takes only its own Word; the following Words are broken as before. So the longest-Cue clock restarts at the joined Word (per Cue, `clocks`), for its Words and for the shown end (`clock + max_secs`), so that merging two Cues keeps the whole of the second. Without joins every Cue's clock is its first Word's start: nothing else changes.
- New on each Cue: `needs_join` (true when a pause, the sentence's end, or `max_secs` from the Cue before's clock to this Cue's last Word parts it from the Cue before). Merge reads it to decide whether to add a join; without it the frontend would have had to repeat the planner's break rules. This is a field the spec doesn't list (deviation). The dry run shows it only when true. `joinable` is unchanged and agrees: a join takes exactly when `joinable`.

**MCP:** `join` is in `cue_edits` (schema from the model). The instructions explain join, and how to merge (remove the Cue Edit and break_before, add a join when `needs_join`) and split (a Cue Edit with no fields). TOOLS_BUDGET_BYTES is 73_700 after merging 05, 06 and 08.

**Frontend** (`advanced/cueEdits.ts`, new `advanced/CueFields.tsx`):
- `splitCue`/`splitWord`/`cueSplitter`: Split takes the first Word after the Cue's first whose highlight starts after the playhead, while the Cue is shown (in the entry shown at the playhead, at a Layout change). It writes a bare Cue Edit at that Word's `at`, putting it in place of a join on that Word. Cmd/Ctrl+B and the Timeline's/phone toolbar Split use it while a Cue is picked. **Deviation:** the split Cue stays picked, not the new one. The new key isn't in the plan until it is planned again, and AdvancedEdit's `prunedCue` sync would drop it.
- `mergeCue`: disabled unless the next Cue is `joinable`. It drops the next Cue's Cue Edit (`cueEditOf`) and its first Word's `break_before`, and adds `{join: true}` at its key only when `needs_join`.
- `deleteCue`: an empty-text Word Edit for each of the Cue's Words, in one outcome, picking nothing. The Delete key does it too (`commands.ts`'s new `removeCue`).
- **Reset timing and Reset position** (choice, `afterReset` in cueEdits.ts, used by both): a Cue Edit left with nothing after a reset is kept as a bare start when its Cue is `joinable` and not `needs_join`, that is, when only its Cue Edit (or a break) parts it from the Cue before, as after a Split. Otherwise it is dropped as before. Neither Reset is enabled on a bare start (nothing to reset).
- Retiming or placing a Cue whose Cue Edit is a failed join turns it into a start (`join: false`), so a drag or Grip never writes join with another field.
- Merged with ticket 08: the join check in `CueEdit.__post_init__` covers `x`, `y`, `scale`. The Cue inspector (`CueFields`) shows 08's `CuePlaceFields` under Reset timing. A join Cue Edit is never placed (the planner ignores a join's other fields; it has none).
- The Words of a Cue are the Preview Plan's Words on its timeline (`lineWords` over the Words whose `media` is the Cue key's, from ticket 06). Chips, Delete and Merge's break removal write Word Edits through 06's `withWordEdit`, so a video's Cue gets Word Edits with its `media`. While a Cue's Words can't be found, its chips say "Its words can't be listed yet" and Split and Delete are disabled.
- Inspector of a picked Cue (`CueFields`):
  - Split, Merge with next and Delete as header icon buttons (Merge's title says why when the next Cue doesn't fit);
  - its Words as chips: the shared `CaptionTextEditor` with a new `only` prop, whose Restore all restores only those Words;
  - Starts and Ends sliders, bounded as the planner bounds them, writing `start_delta`/`end_delta` through `cueTimeGesture` (a run goes on from where the Cue was as it began, and the value set is held while the plan catches up), one undo group per field;
  - Reset timing.

  A locked Captions Track refuses all of them. On a phone they come in the Edit bottom sheet.
- The Captions Track's aria label says "edited" instead of "retimed" for a Cue with a Cue Edit.

**Checks:**
- Backend: test_planner (2 new: join with a pause, sentence end and the longest Cue, not past the line limits, joinable agreeing; needs_join false for a Split's Cue). test_render's Cue Edit HTTP test refuses join with shift or end_delta and saves a join. test_mcp: needs_join in the dry run, a join merging two Cues, join refused with another field in a merge. Full suite: see the commit report.
- Frontend: `advanced/cueActions.test.tsx` (13): Split at the right Word, its disabled cases, replacing a join; Merge with and without join, clearing break_before; Delete in one change; a video's Cue not matched to Source Words; Reset timing after a Split; all refused on a locked Track; chips retype and remove; the start and end fields and their gesture. vitest 919 passed, typecheck clean, build clean (after merging feat/captions-advanced with 05, 06 and 08; main had nothing new). A video Cue's Delete writing Word Edits with `media` is covered. Reset position after a Split is covered too.
- Browser walkthrough (built frontend, copy of one Job in a scratch DATA_DIR, a manual Candidate):
  - Desktop 1440×900: picked "IYA MENURUT SAYA"; the inspector showed chips, Starts 11.30 s and Ends 12.24 s. Cmd+B saved `{at: 21.86}` and the Track showed "IYA" and a dotted "MENURUT SAYA". Merge with next on "IYA" saved `[]`. Delete key on "KESUKSESAN" saved one empty Word Edit, and one Undo restored it.
  - Phone 390×844: picking a Cue and tapping Edit opened the bottom sheet with the same panel. Retyping the chip "kadang" saved `kadang-kadang`. 20 arrow steps on Starts saved `start_delta: 0.24`. A first try saved 0.04, because the slider read the lagging plan; it is fixed by holding the set value.
  - Not seen in the browser: a Merge that adds a join (this Job's Cues, under Phrase, Sentence and 3 lines, had no joinable pair parted by a pause). The planner and vitest cover it. No Clip was rendered.
