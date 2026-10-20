# 07: Adjustment Layers on the Adjust Track

**Parent spec:** `../spec.md` ("Model", "Planner", "Renderer", "Preview", "Advanced Edit UI", "MCP").

**What to build:** the owner drags a Look card onto the Timeline. That makes an Adjustment Layer with that Look, at the drop time, 3 s long (or to the Clip's end), on a new Adjust Track above the Overlay Track. Overlapping Adjustment Layers are spread over lanes.

**Fields:** `id`, `start`, `secs` (Timeline time), `grade`, `strength` (0–100, default 100), and `fade_in` and `fade_out` (each at most half its length). Picked, it shows the Color section plus strength and its fades in the Inspector.

**What it grades:**
- **Covered:** the Main Track and the Overlays under its span.
- **Never covered:** the Watermark, captions, Shapes, Text Layers and hook.
- **How:** it is mixed back over the ungraded picture by strength times its fade ramp. Overlapping layers apply in list order.

**Render and preview:**
- **Render:** after the Overlays and before the Watermark, each layer splits the stream, grades one branch, and blends it back, enabled only for its span.
- **Preview:** a filtered copy of the Main Track and Overlay stack's wrapper. Its opacity follows strength times fade.

**Editing:** it moves, trims, splits, duplicates, copies, pastes and deletes like other layers. It follows the Main Track under the Magnetic timeline and Ripple delete, and Split all splits it. The Adjust Track hides (preview only) and locks.

**The agent:**
- `adjustment_layers` is a list keyed by `id` for `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`.
- The dry run lists it.

**Blocked by:** 05.

**Status:** done

- [x] **Render:**
  - It changes frames inside its span and not outside.
  - It grades an Overlay under it.
  - It leaves a Text Layer's pixels alone.
  - At strength 0 it changes nothing; mid-fade, it is between.
- [x] **Planner:**
  - Its events carry times, strength and fades.
  - One past the Clip's end is cut at the end, and one wholly past it is dropped.
- [x] **Model:** fades over half its length are refused.
- [x] **MCP:** add, merge and remove by `id`, and the dry run lists it.
- [x] **Editor (vitest):**
  - It ripples under the Magnetic timeline.
  - It splits under Split all.
  - Clipboard copy and paste keep its times relative to the other items.
  - A locked Adjust Track refuses edits.
  - A card dropped on the Timeline makes one, at the drop time.

**Notes (done):** `AdjustmentLayer` (candidates.py; fades over half its length refused in
`__post_init__`) is `Candidate.adjustment_layers` (none in one saved before), counted by
`Candidate.looks()` so an Imported Look it names can't be deleted, and checked for unknown Looks with
the other Grades (`_check_looks_of`). The planner's `adjustment_event` cuts one at the Clip's end
(its fades then held to half of what is left) and drops one starting at or past it; `RenderPlan.adjustments`.
Render (`renderer._adjustment`): after the Overlays, before the logo, each layer is
`split` → the second branch `trim`med to its span, graded (`grade_filters`), given an alpha of
strength (`colorchannelmixer=aa`) times its ramp (`fade ... alpha=1`) → `overlay` back with
`enable` on its span and `eof_action=pass`: an alpha overlay instead of `blend`, so the mix is
per-frame cheap (no per-pixel expression) and the grade runs only on the span's frames; one
`-filter_complex` still. A neutral layer or strength 0 adds nothing. Overlapping layers chain in
list order (tested: grey-then-warm is warm, warm-then-grey is grey).

Preview: deviation from the spec's "filtered copy of the stack": no second copy of the videos
(it would decode them twice). `PreviewAdjusted` (editor/PreviewAdjustments.tsx) is one wrapper,
always present so its videos never remount, around the Main Track and the Overlays; its CSS
`filter` lists one SVG filter per layer showing, in order, each the Grade's filter (`GradeFilter`)
ending in an `feComposite` arithmetic (k2 = weight, k3 = 1 − weight) over `SourceGraphic`, which
is exactly a filtered copy at that opacity over an unfiltered one. The weights (`adjustmentWeight`:
strength × fade ramp) are subscribed to through `useShown` at a 200th, so only the wrapper redraws
during a fade. A layer's vignette is a gradient over the wrapper at its weight's opacity (exact for
one layer; after all layers' colour where several overlap). The draft's layer Grades show at once
(`draftGrades`' `layers`).

Editor: item kind `adjust` (pick.ts `LISTS`, `NAMES`, `TRACK_OF`; `listOf` reads a list a Candidate
from before it lacks as none), Track `adjust` ("Adjust", hides and locks; hidden it is dropped from
the preview only) drawn above the Overlay Track with lanes; it moves, trims (fades kept within half,
`fadesHalved`), splits (no fade at the cut), duplicates, copies/pastes and deletes through the
generic `KINDS` table, ripples (ripple.ts, fades halved when cut) and is split by Split all; Edit
Points include its edges. A Filters card is draggable (`DRAG_LOOK`); dropped on the Adjust Track it
is `addAdjustmentLayer` (3 s or to the Clip's end, at the drop time, picked; refused while locked).
Inspector: `AdjustmentLayerFields` (strength, fades via `setAdjustment`, the Color section through
`regrade`/`relook`, which now include picked Adjustment Layers, and its times); several Segments,
Overlays and Adjustment Layers share the Color section; a card click goes to a picked layer too.
Revision History part "Adjustment Layers" (revisions.py, merge.ts, list merged by id).

MCP: `adjustment_layers` in `ITEMS` (edit_candidate, merge_candidate_items field by field incl.
its grade, remove_candidate_items); the dry run lists `adjustment_layers` (span, strength and fades
when not default, grade); instructions describe them. TOOLS_BUDGET_BYTES raised to 82_800 (82_315).
The phone's "Add as layer" is ticket 09.

