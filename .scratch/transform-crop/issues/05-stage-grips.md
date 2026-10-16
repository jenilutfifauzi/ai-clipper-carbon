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

**Status:** done

- [x] Seam H:
  - [x] move and the centre clamp;
  - [x] corner scale ×2 and its clamps;
  - [x] edge stretch on a picture rotated 90°;
  - [x] the rotate snaps with and without Shift and Alt.
- [ ] Walkthrough:
  - [ ] rotate, stretch and scale an Overlay, a media Segment and a Manual Scene, and compare each with the render;
  - [ ] each drag is one step of undo;
  - [ ] a locked Overlay Track can't be picked.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `frontend/src/pages/job/editor/pictureGestures.ts` (tests beside it) covers this ticket's Seam H list. Hold a `Grabbed` (`{ transform, fitted, frame }` at pointer down; `fitted` = `fittedSize(croppedSize(item, crop), frame)` from `cropGestures.ts`) and the grab point, then on each move call `dragged(grab, grip | "body", from, to, { shift, alt })`: it does `moved`, `scaled` (corners), `stretched` (edges) or `rotated` (with `snapRotation`). Draw the held picture and its Grips with `placed(transform, fitted)`, `gripsOf(placed, reach)` (`reach` = the rotate handle's CSS distance × frame px per CSS px), `cornersOf` and `boundsOf`. `PictureTransform` is shaped like the API's `Transform`, so the real type can replace it. Shift with Alt: Shift's 15° steps apply; Alt only drops the 3° snap to quarter turns. A turn is added the short way round and kept within −360..360.

**2026-10-16: done.** Built on the pure gesture modules above, test first where there was a seam (`frontend/src/pages/job/editor/stagePicture.test.ts`; `advanced/actions.test.ts` for the stage ids).

- **Pure module** `frontend/src/pages/job/editor/stagePicture.ts`: `segmentOfScene(plan, scene)`; `pictureSource(edits, plan, segment, scene)` → `{kind: "media", segment, transform}` (its Framing's), `{kind: "manual", segment, scene, transform}` (from `framingSource`: the override's or the clip's) or `{kind: "auto", segment, scene}`, null while the plan isn't of the edits' Main Track; `withPictureTransform(edits, plan, source, transform)` (a video's `framing.transform`, or `withSceneFraming`; an automatic Scene's edits unchanged); `tidyTransform` (centre to the pixel, scale and stretch to 4 places, rotation to 0.01°); `fittedOf(picture, frame)` (the plan Picture's crop box fitted); `heldPicture(picture, transform, frame)` (the plan's Picture redrawn from a Transform, bounds turned); `gripsOnFrame(placed, frame, reach, inset)`; `gripCursor(grip, rotation)`.
- **`StageEdit.tsx`.** `useStageEdit(plan, stage, items, pictures, picked, onSelect)` takes `StagePicture`s (`id`, `label`, `start`/`end`, the plan's `picture`, the saved `transform` (null: outline only), `behind`, `onTransform`) beside the text `StageItem`s; the `outside` drift argument is gone. A picture gesture holds a `Grabbed` and calls `dragged(…, {shift, alt})` on each move, draws from it (`shownPicture`, `heldPicture`) and commits once on pointer up through `onTransform` with its own group `drag:stage-picture:<n>` (one undo step; nothing when the tidied Transform is the saved one). It is held until the next plan, as text is. Arrow keys nudge a Tab-focused picture (`stage-nudge:<id>`). `StageHandles` (now given the stage's `scale`) draws, under the text handles, each picture's handle on its box as turned (`PictureHandle`), and over everything the `Grips` of the one picture picked alone: four corners, four edge bars and a rotate handle 24 CSS px above, with cursors turned with the picture.
- **The picture behind.** `StageId` gains `overlay:<id>` and `picture:<n>`. The id carries the Scene (n, the plan's Scene under the playhead) so that a picture held into the next Scene while playing isn't drawn there nor saved to it (a drag let go over another Scene's picture is dropped). Its handle is the whole frame: a press picks the Segment under the playhead, and starts a move only when it is on the picture as drawn; picked, its box (if it has a Transform) or the frame (an automatic Scene) is outlined. It never moves with the others picked (`nudge` doesn't move Segments), and with anything else picked it has no Grips.
- **Grips off the stage.** A Manual Scene starts at a cover scale, its corners and edges far off the stage, so `gripsOnFrame` pulls any Grip that isn't 10 CSS px inside the stage in towards the centre along the line to it (the rotate handle 24 px less far in, so they stay apart). Each gesture goes by the pointer's distance and angle from the centre (and an edge's by its own axis), the same anywhere on that line.
- **`ClipPreview.tsx`.** The `overlays` prop and the Overlay hold (`OverlayHold`, `heldArea`, `overlayKey`, `overlayDrift`) are gone. `StageControls` gained `overlays: {transformOf, onTransform}` and `pictureAt(segment, scene) → PictureTarget {picked, onPick, transform, onTransform}`; `PickedOnStage` is `StageId` without the picture. While anything is held or drifts, the decks, `PreviewSegments`, `PreviewTransitions` and `PreviewOverlays` are given `drawnPlan(plan, edit, scene)`: the plan with the held Overlay's and the Scene's `picture` replaced. So a Manual Scene is still drawn by slot 1 of the Source decks (`slotView`), and a video by `MediaSegment`, no new video element. A hidden Video Track's picture isn't picked.
- **`PreviewOverlays.tsx`** only draws (`plan`, `playback`, `selected`); its video's sync no longer re-runs on each new event object. **`PicturePanel`** lost `children` and its second box.
- **Advanced Edit.** The stage's `selected` is `stageIdsOf(pick)`, now with `overlay:<id>`; `stageItem` names an Overlay. `overlays` is left out on a locked Overlay Track and `pictureAt` on a locked Video Track (and in full screen, with the rest of the stage). An Overlay of several picked moves them all by `nudge`, as before; one alone takes the whole Transform. The picture's `onTransform` is `history.set(withPictureTransform(…), group)`; its `onPick` picks the Segment (`clicked`, with picking mode on a phone). The inspector then shows the Segment's fields, with "Reframe by hand" on an automatic Scene.

Choices: the picture behind is picked by the whole frame, so a click on a video's Background picks that video. A Grip drag commits once on pointer up, but a text's gesture still saves as it goes (one group), as before. The Overlay's handle is now Tab-focusable and nudged by the arrow keys, as Text Layers are. With a Segment and an Overlay picked, the Overlay has no Grips only while the playhead is on that Segment (the stage counts what it shows).

Hooks for what follows:
- **06 Smart Guides:** in `pictureHandlers`' `move` (`StageEdit.tsx`), after `dragged(…)`, call `snapMoved`/`snapScaled` for `grip === "body"` and the corners, with `guideTargets(plan, pictures' shown bounds (shownPicture(…).bounds, the behind one's too), id)` and `{unit: point.unit, alt: pointer.altKey}`; store the lines in state (as `guides` is for text) and draw them in `StageHandles`; clear them in `end`/`cancel`.
- **07 Crop mode:** `PictureHandle`'s box is the place for `onDoubleClick` (or the double-tap test `handlers`' `end` does for text); a stage state in `useStageEdit` (the picture's id and a `CropEntry`) would draw the dimmed whole picture and the crop handles in place of `Grips`, and commit the Crop and Transform through a new `onCrop` on `StagePicture`, beside `onTransform`.
- **09 clip editor:** give `CandidateEditor`'s `stage` a `pictureAt` from `pictureSource`/`withPictureTransform` on its own edits (only `kind: "manual"`), and let `StagePicture` say which Grips it has (corners only, no edges or rotate) for `Grips` to draw.
- **10 phone:** `pinched(grab, from, to, keys)` slots into `pictureHandlers`: keep the second pointer's down point in the gesture and, with two, call `pinched` instead of `dragged`; `GRIP_DOT`'s hit area is already larger under a finger.

Not tried: no browser walkthrough (rotating, stretching and scaling an Overlay, a media Segment and a Manual Scene against their renders; undo per drag; a locked Overlay Track not picked; the Grips pulled in on a cover-scaled Manual Scene).
