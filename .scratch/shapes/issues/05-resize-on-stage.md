# 05: Resizing a Shape on the stage

**Parent spec:** `../spec.md` (Solution "On the stage"; Implementation Decisions Grips); GLOSSARY (Grips); docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:**
- **Edge Grips.** A Shape's edge Grips set its width or height, never stretch.
  - While the drag lasts, the preview stretches the last picture.
  - On release the size is saved as one undo step, and the new picture replaces the old one when it is ready.
- **Line and arrow ends.** A line's and an arrow's Grips are their two ends and the rotate handle. Dragging one end moves that end alone: the centre, length and rotation follow, and the other end stays put.

**Blocked by:** 04

**Status:** done

- [x] An edge drag on a rectangle changes its width (or height) and leaves its scale and stroke width as they were.
- [x] After the drag, the stroke is the same thickness on every side in the preview and the render.
- [x] Dragging an arrow's head leaves its tail where it was.
- [x] One drag is one step of undo.

## Comments

**2026-10-18, agent:** Built (frontend only).
- **Gesture maths** (`editor/pictureGestures.ts`): `resized(grab, edge, from, to, aboutCentre)` gives a Shape's box (its size at scale 1) and Transform after an edge drag: along its own axis, the drag over its scale in whole pixels within `SHAPE_SIZE_RANGE` (2–4096, now in `editor/picture.ts`; `SHAPE_SIZE` in `shapeStyle.ts` reads it), the opposite edge staying put (the centre moves half as far along the turned axis), scale and rotation unchanged. `endDragged(grab, end, from, to, keys)` moves a line's or an arrow's end ("left" its tail, "right" its tip/head) as far as the pointer: the other end stays put, the length is the ends' distance over the scale, the rotation turns the short way round and snaps as the rotate handle does (quarter turns within 3°, Shift 15°, Alt none), and the centre is the middle of the ends. The thickness (the box's height) and the stored `style.height` are never touched.
- **Stage** (`StageEdit.tsx`): a `StagePicture` may have `resize` (`aboutCentre`, `onResize(box, transform, group)`). Its edge Grips (or a line's ends) then resize it instead of stretching; the drag is held with its box (`Held.fitted`) so the Grips and the picture follow, and saved once on release (`commitResize`: tidied Transform and box, one `group`, nothing when unchanged). A second finger is left out of an edge or end drag. `GripSet` gains `"ends"` (the middles of the left and right edges, which are a line's ends on its centre line, and the rotate handle), drawn as round dots with a move cursor. `heldLayerEvent` stretches the last picture per axis (by its area's change), so it is stretched by CSS while the drag lasts; once released it is held until the next plan, and then the last picture stays, drawn at the new size, until the new one loads (`useLayerPicture`).
- **Wiring**: `StageControls.shapes.onResize`; `ClipPreview` gives a Shape `grips` "all" (a line or an arrow "ends"), and the Advanced Edit saves with `resizeShape` (`shapeStyle.ts`): `sizedStyle` (width and height; a line's or an arrow's width alone) and the Transform through `writeItemTransform`, so a keyed Shape is auto-keyed, as one change (one undo step). Locked Track: no controls, so no Grips; `resizeShape` also refuses it.
- **Choice, keyed position**: when a Shape's `x` or `y` is keyed, its edges resize it about its centre (`aboutCentre`, the opposite edge going as far the other way), as a Text Layer's box Grip does, so a resize never writes a position Keyframe. Unkeyed, the opposite edge stays put. A line's end drag always moves the centre and turns it, so with keyed x, y or rotation it writes Keyframes at the playhead (auto-key), as other Grips do.
- **Stroke after a resize**: the preview shows the backend's new picture of the new width and height, the render the same; the stroke's even thickness at any size is 03's backend test (outline at 400×400 and 1000×200).
- Tests: `frontend/src/pages/job/advanced/shapeGrips.test.ts` (edge drag on a plain, turned and scaled rectangle, top edge, bounds, about the centre; arrow head and tail drags keeping the other end, a scaled line, the short way round and snaps; `gripsIn("ends")`; the held picture stretched per axis; `sizedStyle` for a rectangle and an arrow; `resizeShape` one change, locked, and keyed). Not checked in a browser.
