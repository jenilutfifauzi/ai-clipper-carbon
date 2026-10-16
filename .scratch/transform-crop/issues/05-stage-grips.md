# 05: Grips for pictures on the stage

**Parent spec:** `spec.md` (user stories 2–7, 28, 38–40, 45–47; Implementation Decisions "The stage"); ADR 0007.

**What to build:** a picked picture shows Grips on the Advanced Edit's stage:
- dragging the body moves it;
- corners scale it about its centre;
- edges stretch it;
- a handle above it rotates it, with snaps.

The pictures are Overlays, media Segments and Manual Scenes. Overlays move into `StageEdit`.

- **A pure module of picture gestures** (Seam H): move, corner scale, edge stretch on the picture's own axis, and rotate with snaps (0, 90, 180 and 270 within 3°, Shift in 15° steps, Alt for none). It returns the new Transform.
- **`StageEdit`.**
  - `StageId` gains `overlay:<id>` and `picture`.
  - The Grips are drawn on the rotated box.
  - While a Grip is held, the picture is drawn from the drag until the plan arrives.
  - It commits once on pointer up, as one step of undo.
- **Overlays** drop their own handlers in `PreviewOverlays.tsx`.
- **Picking.** A click on the picture behind every Overlay picks the Segment under the playhead.
  - On a Manual Scene, the Grips edit that Scene's Framing: its override's, or else the Candidate's.
  - On an automatic Source Scene, only its outline shows. The inspector offers "Reframe by hand" (04).
  - Pictures on locked Tracks can't be picked.
- **Multi-item Picks** move together as today, with no group Grips.

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] Seam H:
  - [ ] move and the centre clamp;
  - [ ] corner scale ×2 and its clamps;
  - [ ] edge stretch on a picture rotated 90°;
  - [ ] the rotate snaps with and without Shift and Alt.
- [ ] Walkthrough:
  - [ ] rotate, stretch and scale an Overlay, a media Segment and a Manual Scene, and compare each with the render;
  - [ ] each drag is one step of undo;
  - [ ] a locked Overlay Track can't be picked.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `frontend/src/pages/job/editor/pictureGestures.ts` (tests beside it) covers this ticket's Seam H list. Hold a `Grabbed` (`{ transform, fitted, frame }` at pointer down; `fitted` = `fittedSize(croppedSize(item, crop), frame)` from `cropGestures.ts`) and the grab point, then on each move call `dragged(grab, grip | "body", from, to, { shift, alt })`: it does `moved`, `scaled` (corners), `stretched` (edges) or `rotated` (with `snapRotation`). Draw the held picture and its Grips with `placed(transform, fitted)`, `gripsOf(placed, reach)` (`reach` = the rotate handle's CSS distance × frame px per CSS px), `cornersOf` and `boundsOf`. `PictureTransform` is shaped like the API's `Transform`, so the real type can replace it. Shift with Alt: Shift's 15° steps apply; Alt only drops the 3° snap to quarter turns. A turn is added the short way round and kept within −360..360.
