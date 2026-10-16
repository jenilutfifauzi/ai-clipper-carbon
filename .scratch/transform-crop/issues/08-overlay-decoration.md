# 08: Rounded corners, border and shadow on Overlays

**Parent spec:** `spec.md` (user stories 18–21; Implementation Decisions "Model", "Renderer", "Preview"); ADR 0007.

**What to build:** an Overlay can have rounded corners, a border and a drop shadow.
- The radius is 0..0.5 of the drawn picture's shorter side.
- The border is 1..40 px with a colour.
- The shadow has a blur, an x and y offset, a colour and an opacity.
- The border and shadow are in output pixels and keep their size when the Overlay scales.

- **Model.** `Overlay.radius`, `border: Border | None` and `shadow: Shadow | None`.
- **Planner.** `Picture.radius` is in pixels, and `border` and `shadow` are resolved.
- **Renderer.** Corners and border are drawn by an alpha mask before `rotate`. Choose `geq` or a per-size mask frame with `alphamerge`, by timing on a 3-minute render, and note the choice. The shadow is a branch after `rotate`: the alpha is coloured, blurred, offset, and laid under the picture.
- **Preview.** `border-radius` and `border` go on the wrapper, and `filter: drop-shadow()` on an outer wrapper, so the shadow falls in screen space.
- **Inspector.** Corners, Border and Shadow for Overlays. `_plan_view` lists them.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Seam A:
  - [ ] `radius` 0.5 leaves the box's corners showing the Segment;
  - [ ] a shadow offset of (20, 20) darkens the pixels below and right;
  - [ ] a border of 10 px shows its colour along an edge.
- [ ] Seam H: `Picture` to CSS gives the radius in %.
- [ ] Note the render time of a 3-minute Clip with one decorated Overlay against an undecorated one.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
