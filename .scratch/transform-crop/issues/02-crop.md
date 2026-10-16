# 02: Crop on Overlays

**Parent spec:** `spec.md` (user stories 12, 16, 17, 54; Implementation Decisions "Model", "Planner", "Renderer", "Preview"); ADR 0007.

**What to build:** an Overlay gets a `Crop`: per-edge fractions, taken before fitting. It is set from the inspector's four numbers and through MCP. Crop mode on the stage is 07.

- **Model.** Add `Crop` (each edge 0..0.9, tidied as Concat's so that a tenth is kept), and `Overlay.crop`.
- **Planner.** `Picture.crop` is in item pixels. The fitted size is that of the cropped picture.
- **Renderer.** `crop` is the first step of `_picture`.
- **Preview.** `PicturePanel` positions the media inside the wrapper to show only the crop, as `PanelView` does.
- **Inspector.** The four Crop numbers in the Transform section. `_plan_view` lists the crop.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] left 0.25 on 1000×1000 crops x 250, w 750, and fits 750×1000;
  - [ ] left 0.6 with right 0.6 is tidied.
- [ ] Seam A: crop `left` 0.5 drops the left quadrants' colours; with rotation 90° the crop turns with the picture.
- [ ] Seam H: `Picture` to CSS gives the crop's inner offset and size.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
