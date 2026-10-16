# 01: An Overlay's Transform, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 1–11, 51–52, 54–57; Implementation Decisions "Model", "Migration", "Planner", "Renderer", "Preview", "MCP"); docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md.

**What to build:** an Overlay is placed by a `Transform`: its centre, scale over its fitted size, stretch, rotation, flips and opacity. This works in the model, the plan, the render, the preview, the inspector's numbers and MCP. Grips come later (05). There is no crop yet (02) and no decoration yet (08).

- **Model.** Add `Transform` to `candidates.py` with the spec's ranges. `Overlay` loses `x`, `y`, `size` and `opacity` and gains `transform`.
- **Migration.** A pure converter turns an old Overlay into the new shape using the item's size from the Media Library. A Job is converted when it is read, and written back on the next save.
- **The fitted-size module.** A pure function gives fit, cover and the drawn size from a picture's size, a Transform and the frame. 02, 03 and 04 extend it.
- **Planner.** Add `Picture` (crop = the whole item for now, `width`, `height`, `centre`, `rotation`, flips, `opacity`, `bounds`). `OverlayEvent` holds a `Picture` instead of `area`. The clamp inside the frame goes, and only the centre is clamped.
- **Renderer.** Add a `_picture` chain: `scale`, then `hflip`/`vflip`, then `format=rgba`, then `rotate … c=none`, then `colorchannelmixer=aa`, then `overlay` at the centre minus half the rotated box. Identity steps are left out.
- **Preview.** Add `PicturePanel` with CSS translate, rotate and scale(±1), and a pure `Picture`-to-CSS function. `PreviewOverlays` draws with it. Its own move and corner grip keep working by writing `transform.x/y/scale` until 05 replaces them.
- **Inspector.** A Transform section on a picked Overlay: X, Y, Scale %, Width %, Height %, Rotation °, Flip ↔, Flip ↕, Opacity, and Fit, Fill and Reset. Adding an Overlay computes the scale that gives today's 540 px width.
- **MCP.**
  - `_patch_model` merges nested dataclass fields field by field.
  - `_plan_view` lists the Overlays (id, media, bounds, rotation, opacity).
  - The server instructions explain the units.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] the fitted size and scale examples;
  - [ ] stretch;
  - [ ] rotation bounds;
  - [ ] the centre clamped and the picture not;
  - [ ] migration of an Overlay of `size` 540 to scale 0.5, with the same box.
- [ ] Seam A, pixel checks on the quadrant image:
  - [ ] rotation 90°;
  - [ ] `flip_h`;
  - [ ] opacity 0.5.
- [ ] Seam A:
  - [ ] an old-shape `size` in a PATCH is refused;
  - [ ] an old Job reads in the new shape and plans the same box;
  - [ ] the MCP nested merge of `{"transform": {"rotation": 90}}`;
  - [ ] the dry run lists the Overlays.
- [ ] Seam H: `Picture` to CSS for rotation and flips.
- [ ] Seam C: a remote change to one Overlay's Transform and a local change to another both survive.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
