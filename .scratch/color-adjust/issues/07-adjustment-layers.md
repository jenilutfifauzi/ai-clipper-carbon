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

**Status:** ready-for-agent

- [ ] **Render:**
  - It changes frames inside its span and not outside.
  - It grades an Overlay under it.
  - It leaves a Text Layer's pixels alone.
  - At strength 0 it changes nothing; mid-fade, it is between.
- [ ] **Planner:**
  - Its events carry times, strength and fades.
  - One past the Clip's end is cut at the end, and one wholly past it is dropped.
- [ ] **Model:** fades over half its length are refused.
- [ ] **MCP:** add, merge and remove by `id`, and the dry run lists it.
- [ ] **Editor (vitest):**
  - It ripples under the Magnetic timeline.
  - It splits under Split all.
  - Clipboard copy and paste keep its times relative to the other items.
  - A locked Adjust Track refuses edits.
  - A card dropped on the Timeline makes one, at the drop time.
