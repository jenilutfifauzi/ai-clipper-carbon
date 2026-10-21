# 06: Split per aspect, captions on Auto by Layout, portrait Sources on Blur

**Parent spec:** `../spec.md` (Implementation Decisions "Planner": Split, portrait Sources, captions on Auto).

**What to build:** two-person and portrait shots look right on every aspect.
- **Split** depends on the Canvas:
  - **Stacked** on 9:16 and 4:5: two panels of the full width and half the height (1080×960 and 1080×675).
  - **Side by side** on 1:1 and 16:9: two panels of half the width and the full height (540×1080 and 960×1080).
  - Each crop has its panel's aspect. The left face goes in the top or left panel.
  - The face's rise above the panel centre applies only to stacked panels.
  - With fewer than two faces, it shows the Source's halves as today, in the same arrangement.
- **A portrait Source** on a Canvas wider than it is shown over its blur, not over black. 9:16 is unchanged.
- **Captions on Auto:**
  - at the seam of a stacked Split;
  - under Blur's band when the space between the band and the Safe Area's bottom fits the caption box;
  - otherwise in the lower third of the Safe Area.
- The preview draws the same panels.

**Blocked by:** 03.

**Status:** done

- [x] Seam B tests: Split's panel boxes on all four aspects with the left face top or left; a portrait Source on 16:9 going to Blur; captions on Auto at the seam (9:16, 4:5 Split), in the lower third (1:1 and 16:9 Split), under the band (4:5 Blur) and inside the Safe Area everywhere.
- [x] A 9:16 plan is unchanged (regression fixture from 01).
- [x] Seam A: a 16:9 Split render shows two panels side by side (sampled pixels from a two-colour fixture).
- [ ] Browser: a 1:1 Split Candidate's preview shows the panels side by side.

## Comments

**2026-10-21 (implementation):**
- **Canvas.** `Canvas.stacked` (taller than wide: 9:16 and 4:5) and `Canvas.split_panels`, the two panel boxes, the left face's first. `Canvas.captions_below(band)` gives the caption area under Blur's band, or None when the room between the band and the Safe Area's bottom doesn't fit it.
- **Split.** `_split` lays its crops out in `split_panels`, each crop at its panel's shape (960×854, 960×600, 540×1080, 960×1080 from a 1920×1080 Source). The left face goes in the first panel. `SPLIT_FACE_AT`'s rise applies only when stacked. With fewer than two faces, the halves go in the same panels.
- **Portrait Sources.** `_portrait` plans a Blur Scene (layout `blur`) when the Canvas is wider than the Source and isn't 9:16. Otherwise it passes the Source through as before. So on 9:16 even a Source narrower than 9:16 stays passed through over black, as `test_a_portrait_source_is_passed_through_whole` pins down. Blur's background is now `_filled` (the largest crop of the Canvas's shape) instead of `_centre_crop`. For a landscape Source the two are the same. A portrait Source needs it, because a full-height crop of it isn't the Canvas's shape.
- **Captions on Auto.** `_caption_area` takes the Scene. It gives the seam on a stacked Split, `captions_below` on Blur, and otherwise the lower third. "Under the band" means the lower third, moved down to keep 32 px (`CAPTIONS_BELOW_BAND`) below the band where the band reaches into it, if it still fits above the Safe Area's bottom. With a 16:9 Source this is today's 1296 on 9:16 and 1042 on 4:5, both below the band. On 1:1 there's no room under the band, so it is the lower third.
- **Preview.** It draws panels from the plan's `area`s, so it needed no change. I updated the Layout hints in CandidateEditor ("Two panels, left person on top (on the left on 1:1 and 16:9)", and Track's "crop of the frame's shape").
- **9:16 regression.** I compared whole 9:16 plans before and after (329 plans): seven Sources (16:9, 4:3, 2.37:1, 16:10, 9:16, 4:5, 1280×720), every Layout, 0/1/2 faces, Auto/Top/Custom captions, a hook, a Watermark, a Text Layer, every Watermark and hook position. All are identical except one case: a **16:10 Source on Blur**. Its band ends at 1298, 2 px into today's caption box at 1296. With room below it, the captions now go to 1330, just under the band. The rule in the spec makes this unavoidable, and no other 9:16 plan changed. Tests: `test_planner.py` passes unchanged.
- **Tests.** In `tests/test_canvas.py`: Split's panels and crops on all four aspects with the left face first, the rise only when stacked (a 4:3 Source on 4:5 and 16:9), halves in the same panels, a portrait Source on Blur on 4:5/1:1/16:9 and passed through on 9:16 or its own shape, captions on the seam (9:16, 4:5), in the lower third (1:1, 16:9 Split), under the band (4:5 Blur, and 1:1 falling back), and inside the Safe Area for every aspect × Track/Split/Blur × wide/tall Source. In `tests/test_aspects.py`: a real 720p render of a 16:9 Split from a red|blue fixture, sampled red on the left and blue on the right at the top and the bottom.

Not done or deferred:
- **Browser walkthrough** (the fourth box) wasn't run. The preview draws the plan's panel areas as they are.
- **Track with a Source narrower than the Canvas** (a 4:3 Source on 16:9, say) still crops the full width and height (`_centre_crop`), so its picture is stretched. This isn't in this ticket. Using `_filled` for Track's crop would fix it.
