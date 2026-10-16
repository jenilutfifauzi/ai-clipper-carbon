# 10: Phone: gestures and a Transform sheet

**Parent spec:** `spec.md` (user stories 48–50; Implementation Decisions "Advanced Edit inspector and phone"); ADR 0007.

**What to build:** on a phone, in the Advanced Edit:
- one finger moves a picked picture, a pinch scales it, and a two-finger twist rotates it, with the same snaps;
- the Grips are larger;
- a Transform sheet holds the inspector's fields (and Background or decoration), and Crop mode opens from it.

- **The gesture module** gains pinch and twist from two pointers.
- **One gesture is one step of undo.**

**Blocked by:** 05, 07

**Status:** done

- [x] Seam H: two pointers moving to twice the distance and turning 30° give twice the scale and +30°; a twist near 90° snaps.
- [ ] Walkthrough on iPhone Safari: pinch, twist, the sheet's fields, and Crop mode, with no page zoom or scroll while gesturing.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `pinched(grab, [fromA, fromB], [toA, toB], keys)` in `frontend/src/pages/job/editor/pictureGestures.ts` covers this ticket's Seam H list. It scales by the ratio of the fingers' distance, turns by the turn of the line between them (snapped as the rotate handle by `snapRotation`), and moves the picture with the fingers' middle; scale is about the picture's centre. One finger is `moved`. `from` is the two pointers when the second went down, and `grab` the `Grabbed` at that moment. No Smart Guides while pinching.

**2026-10-16: done.** Built on `pinched`; the new pure part test first (`pictureGestures.test.ts`, "a gesture under one finger or two"). The Seam H list itself was already covered by the `pinched` tests.

- **Pure module** `pictureGestures.ts` gains a tracker of a gesture under one finger or two: `Fingers` (`grip`, `grab`, `down`: each pointer's id, `from` and `at`), `fingersOn(grab, grip, id, at)`, `fingerDown(fingers, id, at, held)`, `fingerMoved(fingers, id, at)`, `fingerUp(fingers, id, held)` and `fingersHeld(fingers, keys)` (one finger: `dragged` of its Grip or the body; two: `pinched`). A second finger starts again from both fingers where they are and from `held`, the picture as the stage shows it then (so the first finger's move so far, snapped, is the pinch's grab); a third is left out. One of two lifted: the other starts again from where it is and moves the body (not the Grip it went down on); the last lifted gives null.
- **`StageEdit.tsx`.** A picture's `Gesture` holds `Fingers` and the Transform now; `Gesture` also keeps whether its pointer is a finger (`touch`) and the element holding it (`target`). A window capture `pointerdown` listener takes a second finger while a finger holds something, wherever it lands: on a picture gesture that isn't "together" (one of several picked) it joins it (`fingerDown`, `setPointerCapture` on the first finger's element, so its moves and lift come to the same handlers), and otherwise it is swallowed, so it picks nothing else. Its element gone (`!isConnected`), the stuck gesture is dropped instead. While pinching there are no Smart Guides; a picture with `grips: "corners"` (the clip editor's) isn't turned by a twist. The gesture commits once, when the last finger lifts: one group `drag:stage-picture:<n>`, one step of undo. In Crop mode, a second finger while a crop handle is held is swallowed too (it neither keeps the Crop nor takes another handle). A non-passive `touchmove` listener on the stage element prevents the default while a finger holds something.
- **Grips larger under a finger** (`pointer-coarse:`): corner dots 16 px (from 12), edge bars 10×20 (from 8×16), the rotate handle 20 px (from 14) and 40 CSS px above the picture (from 24, `ROTATE_REACH_FINGER_CSS_PX`, by `useMediaQuery("(pointer: coarse)")`) so that its hit area and the top edge's stay apart. Crop mode's handles, drawn from the same `GRIPS`, grow too. The hit areas were already larger (`GRIP_DOT`).
- **`ClipPreview.tsx`.** The Advanced Edit's stage (`fit` with `controls`) is `touch-none`, so a drag or pinch on it neither scrolls nor zooms the page. The clip editor's isn't, so a swipe over its preview still scrolls that page.
- **The Transform sheet** (`advanced/TransformPanel.tsx`, `TransformPanel`): the phone toolbar shows Transform (after Edit) with an Overlay or a Segment picked alone, opening `sheet === "transform"`. It holds, for an Overlay, `TransformFields` and `DecorationFields`; for a video's Segment, `FramingFields` (now exported from `MainTrack.tsx`: Transform, Crop, Background); for a Segment of the episode, `SceneFields` (the Scene at the playhead: its Layout, "Reframe by hand", and a Manual Scene's Framing). Each field is the inspector's history group. Its Crop button is `cropMode(kind, id)`, which now closes the Transform sheet as well as the inspector's.

Choices: a pinch also works from a Grip (the second finger turns any one-finger gesture on a picture picked alone into a pinch). A second finger on one of several picked does nothing (a pinch would scale only one of them, and their `onTransform` moves them all by the centre alone). A `pointercancel` of either finger drops the whole gesture, as before. The Transform sheet stays open while the stage is edited (it is under the stage, over the timeline).

Not tried: no device walkthrough (the iPhone Safari box above is unticked). Worth watching there: a second finger landing outside the stage (on the timeline or the toolbar) while the first holds a picture: it pinches, but whether iOS still zooms the page then depends on the `touchmove` listener being on the stage only; and the 40 px rotate reach against a small picture near the top of the stage.
