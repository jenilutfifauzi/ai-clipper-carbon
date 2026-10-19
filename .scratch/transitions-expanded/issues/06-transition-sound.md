# 06: A Transition's sound: Linear, Equal power or Cut

**Parent spec:** `../spec.md` ("Model", "Catalogue and rendering" Sound, "Preview" Sound, "Advanced Edit" join inspector).

**What to build:** the owner chooses how the sound crosses a join.
- **The field.** A Transition gains `sound`: `linear` (the default, today's sound), `equal_power` or `cut`.
- **The render:**
  - Linear is `acrossfade`'s `tri`.
  - Equal power is `qsin` on both curves.
  - Cut switches at the middle of the overlap: each side gets a short `afade` at the middle, and `acrossfade` uses `nofade` on both curves.
  - A dip never drops the sound out on its own.
- **The preview.** Both the ghost's and the incoming Segment's volumes follow the chosen curve over the overlap. Today only the ghost fades.
- **The join inspector** has a segmented control, Linear / Equal power / Cut. A change is one undo step.
- **The agent.** `TransitionEvent`, the dry run and the tool descriptions carry `sound`.

**Blocked by:** 01.

**Status:** done

- [x] With a tone on each side, a Cut render has only the first tone just before the middle of the overlap and only the second just after.
- [x] Equal power keeps the summed level near constant at the middle, while Linear dips there.
- [x] Linear renders the same audio as before.
- [x] Stored Transitions read as Linear.
- [x] The preview's volumes for both sides follow each curve (vitest on the curve maths).
- [x] MCP can set `sound`, and the dry run shows it.

## Comments

**2026-10-18, agent:** Built.
- **Model**: `TransitionSound` (`linear` | `equal_power` | `cut`) in `app/candidates.py`; `Transition.sound` defaults to linear, so stored Transitions read as Linear with no migration. `Join` and `TransitionEvent` carry it (`app/planner.py`, `app/rendering.py`).
- **Render** (`_sounds_crossed` in `app/renderer.py`): Linear is the acrossfade as before (its default `tri`); Equal power is `c1=qsin:c2=qsin`; Cut gives each side a 20 ms `afade` at the overlap's middle (out on the outgoing side, in on the incoming), then an acrossfade with `nofade` on both curves. The picture join is untouched, so a dip never drops the sound out on its own.
- **Preview** (`frontend/src/pages/job/editor/transitionSound.ts`): `crossedVolumes(transition, time)` gives each side's share by the sound (straight lines; cos/sin quarter waves; a 20 ms switch at the middle), `crossedBy(into, out)` a Segment's share across the Transitions either side, `broughtIn(transitions, time)` the share of the Segment the time is in. The ghost's volume follows the outgoing share (PreviewTransitions); the incoming side follows the incoming one: the decks' masters in PreviewMusic, and a Segment on its own videos in PreviewSegments (`into`, through `loudness`'s new `crossed` share, keyed sounds through `followCurve`'s curve too). Today only the ghost faded.
- **Inspector**: a Sound segmented control (Linear / Equal power / Cut) under Length in the join panel (`Transitions.tsx`); each change is its own undo step (no group). Picking a kind keeps the join's sound as it keeps its length.
- **MCP**: the schemas carry `sound` from the dataclass; the instructions describe the three sounds; the dry run's plan view gains `transitions` (kind, start, end, sound). Ticket 02 adds `transitions` to the dry run too (after, kind, start, end): on merge keep one entry with `sound` added, and raise the tools budget note in `test_mcp.py` as needed (it is 70_000 here, from 69_000).

Checked:
- Seam A, real ffmpeg (`test_transitions.py`): two 2 s videos with a 500 Hz and a 1300 Hz tone, joined by a 1 s dip to black, rendered with each sound; each tone's level from an FFT of 50–100 ms windows, as a share of its level on its own either side. Cut: before the middle the first tone is above 0.85 and the second under 0.05, after it the reverse. Equal power: each 0.71 at the middle and the RMS within 12% of the steady level; Linear: 0.75/0.25 a quarter in, 0.5/0.5 at the middle and the RMS under 0.8 there (the dip). The API saves and returns `sound`, refuses a bad one, and a Candidate stored without it reads as linear; the MCP merge sets it and the dry run shows it.
- Seam B: the planner's `TransitionEvent` carries the Join's sound, linear by default.
- vitest: the curve maths for all three sounds at the ends, a quarter in and the middle, `broughtIn` and `crossedBy` across two Transitions; the join panel's Sound control offers the three labels, reads a stored Transition as Linear and calls `onChange` with the whole Transition and no group.
- Backend 825 passed (full suite, 3 deselected by default); frontend 861 passed; tsc clean.
