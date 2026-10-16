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

**Status:** done

- [x] Seam B:
  - [x] the fitted size and scale examples;
  - [x] stretch;
  - [x] rotation bounds;
  - [x] the centre clamped and the picture not;
  - [x] migration of an Overlay of `size` 540 to scale 0.5, with the same box.
- [x] Seam A, pixel checks on the quadrant image:
  - [x] rotation 90°;
  - [x] `flip_h`;
  - [x] opacity 0.5.
- [x] Seam A:
  - [x] an old-shape `size` in a PATCH is refused;
  - [x] an old Job reads in the new shape and plans the same box;
  - [x] the MCP nested merge of `{"transform": {"rotation": 90}}`;
  - [x] the dry run lists the Overlays.
- [x] Seam H: `Picture` to CSS for rotation and flips.
- [x] Seam C: a remote change to one Overlay's Transform and a local change to another both survive.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, at each seam test first.

- **Model.** `Transform` is in `backend/app/candidates.py` with the spec's ranges (pydantic refuses a centre off the frame, a scale outside 0.05–8, and so on). `Overlay` has `transform` (default `OVERLAY_TRANSFORM`, scale 0.5 at the centre: 540 px for any item wider than 9:16) and keeps `volume`. The PATCH refuses an old-shape Overlay (`x`, `y`, `size` or `opacity`) with a message naming the transform's fields (`_no_old_overlays` in `api.py`).
- **The fitted-size module** is `backend/app/pictures.py`: `fitted(width, height, frame)`, `cover_scale(...)`, `drawn_size(width, height, transform, frame)` (even pixels) and `turned_size(width, height, rotation)`. 02 should make `fitted` take the cropped size; 03 and 04 call it for media Segments and Manual. The frontend has the same rule in `frontend/src/pages/job/editor/picture.ts` (`fittedSize`, `coverScale`, `scaleForWidth`), tested on the same examples, for Fill and a new Overlay only.
- **Planner.** `Picture` (`crop`, `width`, `height`, `centre`, `rotation`, `flip_h`, `flip_v`, `opacity`, `bounds`) and `picture_of(width, height, transform)` are in `planner.py`. The crop is `Box(0, 0, item width, item height)` for now. The centre is clamped to the frame and the picture isn't; `bounds` is the turned box, rounded. `OverlayEvent` holds `picture` and gained `id` (the Overlay's), which the dry run and the preview use instead of matching by index. `FRAME` is the planner's (1080, 1920).
- **Migration.** `backend/app/migration.py` is pure: `migrated_overlay(old, size)` works out the box the old planner drew (width capped at the frame, height capped at 1920, kept inside the frame) and gives the Transform that draws that box: scale = box width / fitted width, centre = the box's. `migrated_candidate` and `migrated_clip` apply it to a Candidate's and a rendered Clip's Overlays. `JobStore` reads `candidates.json`, the Revision History files and `clips.json` through them, given `media_sizes` (`MediaStore.sizes`, wired in `main.py` and `cli.py`). The Media Library is read only when an old Overlay asks for a size. A converted Candidate keeps its Revision until its next save writes the new shape.
- **Renderer.** `_picture(picture, source, below, out, name, after, laid)` in `renderer.py`: scale (lanczos), `hflip`/`vflip`, `format=rgba` and `rotate=a:ow=rotw(a):oh=roth(a):c=none` only when turned, `colorchannelmixer=aa` only below opacity 1, then `overlay=x=cx-overlay_w/2:y=cy-overlay_h/2`, so ffmpeg's own rotated size places it. A plain Overlay is a scale and an overlay. 02 adds the crop step first, and 08 the mask and shadow branches.
- **Preview.** `PicturePanel.tsx` draws a `Picture` from `pictureStyle(picture, frame)` (`picture.ts`): left/top at the centre, its size in shares of the frame, `translate(-50%, -50%) rotate() scale(±1, ±1)` (CSS applies them right to left: flip, then turn, as the renderer does), and its opacity on the media layer. `PreviewOverlays` draws with it. Its handle sits inside the turned box, so it turns too. A move writes `transform.x/y` (clamped to the frame). The corner grip now scales about the centre by the ratio of the pointer's distances from it, and writes `transform.scale`. `OverlayControls` lost `ids` and gained `transformOf(id)`; a hold is centre-based.
- **Inspector.** `advanced/TransformFields.tsx` (meant to be shared with media Segments and Manual Scenes) has X, Y, Scale %, Rotation °, Width % and Height % as number fields, Flip ↔/↕ as pressed buttons, an Opacity slider, and Fit, Fill and Reset. Each field is one history group, `overlay:<id>:transform.<field>`. `newOverlay` uses `scaleForWidth(item, 540)` at (540, 760), as before.
- **MCP.** `_patch_model` makes a dataclass-valued field an all-optional patch of its own, and `_merge` merges it field by field (`_merged_fields`). `_plan_view` lists `overlays` (id, media, start, end, bounds, rotation, opacity). The instructions get a paragraph on the units. The tool list stays within its budget.

Choices: the corner grip scales about the centre now, not from the top-left corner, because a turned picture has no fixed corner to keep; 05 replaces it anyway. Fit and Fill also centre the picture and drop its stretch, keeping rotation, flips and opacity; Reset is the identity Transform (scale 1), not the new-Overlay default. Fill takes the cover scale of the unturned item, so a picture turned 90° doesn't cover the frame with it.

Not tried: no browser walkthrough (the corner grip on a turned Overlay, the inspector's fields, an old Job opened in the editor). Speed was not measured, since a plain Overlay's graph is still a scale and an overlay.
