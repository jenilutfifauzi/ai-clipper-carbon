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

**Status:** done

- [x] Seam H:
  - [x] cropping the left 0.25 at scale 1 returns a Transform whose kept part covers the same frame pixels;
  - [x] the same on a picture rotated 90°;
  - [x] the tenth kept.
- [ ] Walkthrough: crop a rotated Overlay, then Escape a second crop, and check that nothing moved.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `frontend/src/pages/job/editor/cropGestures.ts` (tests beside it) covers this ticket's Seam H list. When Crop mode opens, keep a `CropEntry` (`{ transform, crop, item, frame }`, `item` the media's size in pixels) and a working Crop. Draw the dimmed whole picture with `wholePicture(entry)` and the bright kept part with `keptPart(entry, crop)`; its handles are `gripsOf(keptPart(...), 0)` without `rotate`. A handle drag is `cropDragged(entry, cropAtGrab, handle, from, to)`, in the picture's own axes (on a `flip_h` picture the left handle moves `crop.right`). On Enter or a click outside, commit `tidyCrop(crop)` with `cropCommitted(entry, crop)`, which returns the Transform that keeps the kept part in place (clamped at scale 0.05–8 and the frame), as one edit. Escape drops the working Crop.

**2026-10-16: done.** Built on `cropGestures.ts`; the new pure parts test first (`frontend/src/pages/job/editor/stagePicture.test.ts`, "Crop mode on a picture"). The Seam H list was already covered by `cropGestures.test.ts`.

- **Pure module** `stagePicture.ts`: `pictureCrop(edits, plan, source)` (a video's Framing's Crop, or a Manual Scene's where its Framing is kept; null for an automatic Scene); `withPictureCrop(edits, plan, source, crop, transform)` (both at once, through `withSceneFraming` for a Manual Scene; `withPictureTransform` now shares its body); `wholeOnStage(picture, entry)` (the plan's Picture as Crop mode draws it: the whole item at `wholePicture`, with no corners, border or shadow); `croppedPicture(picture, crop)` (the crop box in item pixels, each edge at the nearest pixel as `pictures.kept` does, to draw a kept Crop until its plan comes); `cropKept(entry, crop)` (the Crop to four places and tidied, with `cropCommitted`'s Transform tidied as a gesture's; null when it is the Crop it opened on).
- **`StageEdit.tsx`.** `StagePicture` gains `crop` and `onCrop(crop, transform, group)`; without them a picture has no Crop mode (nor with `grips: "corners"`, the clip editor's). `useStageEdit` takes an 8th argument `crop: { asked?, onOpen? }`. Crop mode state is `Cropping` (`id`, `CropEntry`, the working Crop). It opens on a double-click or double-tap on a picture's body (the text handler's tap test, in `pictureHandlers`' `end`), or when `crop.asked` goes up while a croppable picture is picked alone; `onOpen` pauses the playback. While open, `shownPicture` gives `wholeOnStage`, so `drawnPlan` draws the whole picture through the usual paths (the Source decks' `slotView` for a Manual Scene, `MediaSegment` for a video, `PreviewOverlays`), and `moving` is true. `CropHandles` (in place of `Grips`) dims the whole picture but the kept part (an even-odd SVG path of the two turned outlines), draws the eight handles on the kept part (`gripsOnFrame` with no rotate reach, so they are pulled in from off the stage), and a bar at the top with Cancel and Done. A handle drag is `cropDragged` from the Crop at the grab. Enter keeps and Escape drops (a window capture listener, before the editor's keys; not while typing in a field), and a press anywhere but on the kept part, a handle or the bar (`data-crop-mode`) keeps. Keeping holds the picture at the new Transform and Crop (`Held.crop`) until the next plan and calls `onCrop` once, group `stage-crop:<n>`: one step of undo. It closes by itself when its picture is gone or its Transform or Crop changes elsewhere (an undo, another editor).
- **`ClipPreview.tsx`.** `PictureTarget` gains `crop` and `onCrop`; `StageControls.overlays` gains `cropOf` and `onCrop`; `StageControls.cropAsked` is passed on as `crop.asked`.
- **Advanced Edit.** The Overlays' `onCrop` sets `crop` and `transform` together; the picture behind's is `history.set(withPictureCrop(…), group)`. `cropMode(kind, id)` gives the inspector's Crop for a Segment or an Overlay (none on a locked Track or in full screen): it puts the playhead in the middle of the item if it isn't on it, closes the phone's inspector sheet, and counts `cropAsked` up.
- **Inspector.** `TransformFields` takes `onCropMode` and shows a Crop button under the Crop legend; Overlays, media Segments (`FramingFields`) and Manual Scenes (`SceneFields`) pass it on. `onCrop(crop, field, transform?)`: Reset now clears the Crop too, with the Transform, as one change (`…crop.reset`).

Choices: double-click goes by the tap test rather than `onDoubleClick`, so a double-tap opens it on a phone too, and the picture behind (whose box only appears once picked) works. In Crop mode the whole picture is drawn plain (an Overlay's corners, border and shadow come back on keeping). A press on the kept part doesn't close Crop mode; the bar's Cancel and Done are there for a phone, which has no Enter or Escape. The Crop button on a media Segment the playhead isn't on moves the playhead into it first.

For 10 (phone): open Crop mode from the Transform sheet through the same `cropMode(kind, id)` in `AdvancedEdit.tsx` (it already closes the "inspector" sheet; close the Transform sheet the same way), or count `cropAsked` up with the picture picked alone. The handles use `GRIP_DOT` (larger hit area under a finger), and the bar's buttons grow to 44 px under a coarse pointer. A pinch in Crop mode isn't handled: `cropHandlers` take one pointer each.

Not tried: no browser walkthrough (crop a rotated Overlay, then Escape a second crop and check nothing moved; Crop mode on a media Segment and a Manual Scene against their renders; undo of a crop as one step).
