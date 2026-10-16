# 07: Crop mode on the stage

**Parent spec:** `spec.md` (user stories 13–15; Implementation Decisions "The stage"); ADR 0007.

**What to build:** double-clicking a picture, or pressing Crop in the inspector, opens Crop mode (Advanced Edit only).
- The whole picture shows dimmed in place, with the kept part bright.
- The four edge and four corner handles move the Crop.
- Enter or a click outside keeps it as one step of undo, and Escape drops it.
- The kept part stays where it was: the commit adjusts the Transform's scale and centre in the same step.

- **The gesture module** gains the crop handles (in the picture's own axes, so they work when it is rotated) and a commit that returns the Crop and the compensating Transform.
- It works for Overlays, media Segments and Manual Scenes.

**Blocked by:** 02, 05

**Status:** ready-for-agent

- [ ] Seam H:
  - [ ] cropping the left 0.25 at scale 1 returns a Transform whose kept part covers the same frame pixels;
  - [ ] the same on a picture rotated 90°;
  - [ ] the tenth kept.
- [ ] Walkthrough: crop a rotated Overlay, then Escape a second crop, and check that nothing moved.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
