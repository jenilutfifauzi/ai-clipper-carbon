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

**Status:** ready-for-agent

- [ ] Seam B tests: Split's panel boxes on all four aspects with the left face top or left; a portrait Source on 16:9 going to Blur; captions on Auto at the seam (9:16, 4:5 Split), in the lower third (1:1 and 16:9 Split), under the band (4:5 Blur) and inside the Safe Area everywhere.
- [ ] A 9:16 plan is unchanged (regression fixture from 01).
- [ ] Seam A: a 16:9 Split render shows two panels side by side (sampled pixels from a two-colour fixture).
- [ ] Browser: a 1:1 Split Candidate's preview shows the panels side by side.
