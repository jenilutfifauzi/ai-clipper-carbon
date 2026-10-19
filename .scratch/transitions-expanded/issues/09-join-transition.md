# 09: A Style Preset's Join Transition for every new join

**Parent spec:** `../spec.md` (Solution "Join Transition in Style Presets", "Model", "Join Transition rule", "Agent (MCP)"); GLOSSARY **Join Transition**, **Style Preset**.

**What to build:** a Style Preset gains a **Join Transition**: none, or a kind, length, strength, colour and sound (a Transition without `after`).
- **Defaults.** Built-in Presets have none. Stored Presets read with none.
- **Where it is set.** A Transitions section where the Preset's caption, hook and Watermark styles are edited and saved. It is read-only for built-ins.

**The rule** is one pure function, written as twins in the backend and in the editor:
- A join is a pair of adjacent Segment ids.
- Given the Main Track before and after a change, every join present after and not before, with no Transition, gets a copy of the Candidate's Preset's Join Transition. Its `after` is the join's first Segment.

**Where the rule runs:**
- **The editor** applies it inside every action that changes the Main Track, in the same undo step: split, Split all, inserting a media Segment, paste, Freeze frame, delete, Ripple delete, reorder.
- **The backend** applies it in the Candidate update when the Segments change and the update doesn't state `transitions`. An update that states `transitions` is taken as is, so the agent can leave a new join cut.

**What the rule never does:**
- Removing a Transition never triggers it, since the join is not new.
- Changing or switching a Candidate's Preset touches no join.

**The agent:**
- `save_preset` takes and returns `join_transition`.
- The tool descriptions explain the rule and the exception.

**Blocked by:** 04, 06.

**Status:** done

- [x] A shared JSON fixture of cases is read by both the backend and the editor tests, with the same results (prior art: the shared Segment time fixtures). Each case gives the Main Track before and after, the Transitions and a Join Transition, and the expected Transitions after. The cases cover:
  - split, insert, paste, Freeze frame, delete of a middle Segment, reorder;
  - a removed Transition staying removed;
  - a Preset with none.
- [x] In the editor, splitting a Segment under a Preset with a Join Transition gives the new join a copy, in the same undo step as the split.
- [x] Via the API or MCP, an update changing Segments without `transitions` fills new joins. One stating `transitions` keeps exactly what it states.
- [x] Changing a Candidate's Preset leaves its Transitions unchanged.
- [x] The Preset editor saves and shows the Join Transition. Built-ins show none, read-only.
- [x] `save_preset` round-trips `join_transition`. A Preset stored without it reads with none.

## Comments

**2026-10-19, agent:** Built.
- **Model**: `TransitionKind`, `TRANSITION_SECS`, `TRANSITION_DEFAULT_SECS` and `TransitionSound` moved from `app/candidates.py` to a new `app/transition_kinds.py` (candidates imports them back, so `from app.candidates import TransitionKind` still works): `app/candidates.py` imports `app/styles.py`, so a Preset's Join Transition couldn't use them there. `JoinTransition` (`app/styles.py`) is a Transition without `after`, same bounds and defaults; `StylePreset.join_transition: JoinTransition | None = None`, so built-ins and stored Presets read with none. `PresetStore.create`/`update` take it; `PresetStore.join_transition(preset_id)` gives a Candidate's (Default's, none, for a deleted Preset).
- **The rule**: `with_join_transition(before, after, transitions, join)` in `app/candidates.py`, and its twin `withJoinTransition` in `frontend/src/pages/job/editor/joinTransition.ts`. It returns the given Transitions as they are, then a copy for each new join with none, in Main Track order. Shared cases: `backend/tests/fixtures/join_transitions.json` (split of an uncut Clip, split next to a Transition, insert, paste bringing its own, Freeze frame, delete of a middle Segment with and without a Transition after the first, reorder, a removed Transition staying removed, a Preset with none).
- **Backend**: `review.update` takes `join_transition` (a Preset id to its Join Transition). When the Segments change and `transitions` isn't stated, it runs the rule from `old.main_track()` to the new Segments with the Preset the update leaves (`change.preset_id` or the old one). A stated `transitions` list is taken as is. The API passes `presets.join_transition` in both the update and the preview plan. `PresetBody` takes `join_transition`.
- **MCP**: `save_preset` carries `join_transition` via `PresetBody`. Its docstring points to the instructions, which gain a bullet after the Transition one: the rule, and the "stated list is taken as is" exception. `TOOLS_BUDGET_BYTES` went from 72_000 to 74_500, with a comment (73_832; the save_preset schema repeats a Transition's kinds and knobs).
- **Editor actions** (`advanced/actions.ts`): `PickContext.join` and `withJoins(scene, outcome, from = scene.edits)` run the rule on an outcome, in the same change. Wrapped: `remove` (so delete, Ripple delete and cut), `insertSegment`, `dragSegment`, `duplicate`, `split` (so Split all), `freezeFrame`, and `paste` (`clipboard.ts`). A drag runs it from where the drag began, on the origin's Transitions, so a join met mid-drag gets nothing once the drag moves on. `AdvancedEdit` lists the Presets and sets `join` from the Candidate's `preset_id`.
- **Preset editor**: a Transitions tab in the clip editor (`CandidateEditor.tsx`, after Watermark) holds `editor/JoinTransitionPanel.tsx`. It has a kind select (None, then the kinds by group), Length, Strength and Colour where the kind reads them, and Sound (`SOUNDS`, now exported from `advanced/Transitions.tsx`). On a built-in it shows None, disabled. It has no Style Override: `useStyleDraft` keeps the changed Join Transition for the Preset (`join`, `joinChanged`, `setJoin`) until the Preset bar saves it. Update shows when it changed, and Save as new and Update send it (`savedLook`).

Checked:
- Shared cases, both sides: `tests/test_join_transitions.py` (10) and `editor/joinTransition.test.ts` (10).
- API: a Preset saves, returns and clears `join_transition`, refuses a 4 s one, and reads none when stored without it; built-ins have none. Cutting a Candidate into three fills both joins. Stating `transitions` on a reorder keeps exactly them. Removing one leaves the join a cut. A later reorder fills only the new join. Switching the Preset, to one with a Join Transition or to Default, leaves the Transitions as they are.
- MCP: `save_preset` round-trips it and `list_presets` shows it. An `edit_candidate` that cuts gets it, one stating `transitions: []` doesn't. The instructions name the rule and the exception.
- vitest (`advanced/joinTransition.test.ts`): a split gives the new join a copy in its one outcome, and none under a Preset with none. Split all, insert, Freeze frame, duplicate, delete and Ripple delete fill exactly the new joins. A paste fills all but the join it brings a Transition for. A drag fills the join new since it began, and leaves none once dragged back. The panel (`editor/joinTransitionPanel.test.tsx`): None disabled on a built-in; the groups; picking a kind keeps length, sound and knobs; None clears it; the Length, Strength and Sound changes; `savedLook` sends it.
- Tests run (only the related files, as asked): backend `test_join_transitions.py`, `test_mcp.py`, `test_transitions.py`, `test_styles.py`, `test_review.py`, `test_segments.py`, `test_freeze_frame.py`, `test_revisions.py`, `test_watermark.py`, `test_fonts.py`: 197 passed. Frontend: 13 files, 177 passed (the new ones, `actions`, `freezeFrame`, `Transitions`, `transitionPanel`, the style panels' tests, `phoneSpeed`, `merge`). `tsc` clean.

For later tickets:
- **05 (Concat looks):** add new kinds to `TransitionKind` in `app/transition_kinds.py` now, not `app/candidates.py`.
- **08 (all joins):** an action that changes the Main Track should end in `withJoins(scene, outcome)`.
