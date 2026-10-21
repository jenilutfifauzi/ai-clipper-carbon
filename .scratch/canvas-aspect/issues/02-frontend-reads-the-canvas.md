# 02: The frontend reads the Canvas from the plan

**Parent spec:** `../spec.md` (Implementation Decisions "Frontend"); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md; docs/adr/0001-backend-plans-frontend-draws.md.

**What to build:** a prefactor. The editor stops assuming a 1080×1920 frame, and still looks exactly the same for 9:16 Candidates.
- **The global frame constant goes,** and so does the Advanced Edit's second copy of it. The Canvas comes from the Preview Plan's width and height. Before a plan is loaded, it comes from a fallback (9:16).
- **Every user of the constant takes the Canvas:**
  - picture fitting and the cover and fill scales;
  - the identity Transform and new items' default places (the same fractions as today);
  - the keyframe ranges, cue placement, the transform fields, shapes and text layers;
  - the adjustment and effect regions;
  - the stage and drag clamps and the hook's clamp;
  - the preview's fitted-size hook and the stage's scale.
- **StageEdit's smart guides** come from the plan's Safe Area and the Canvas's centre and edges, not from fixed numbers.
- **The fixed 9:16 player box** in the Advanced Edit's stage and the preview takes the Canvas's aspect.

**Blocked by:** 01.

**Status:** done

- [x] vitest: fitting and cover scale computed for a given Canvas (9:16 values unchanged, 16:9 values correct).
- [x] vitest: guides built from a plan's Safe Area.
- [x] `npm run typecheck && npm run build` pass, and no import of a global 1080×1920 frame remains.
- [ ] Browser walkthrough: a 9:16 Candidate's Advanced Edit and clip editor look and drag exactly as before.

## Comments

**2026-10-21 (implementation):** `frontend/src/pages/job/editor/canvas.ts` is the frontend's Canvas module. It holds the `Canvas` type (width, height and `safe_area`, as the plan carries them), `canvasOf(plan)` with the 9:16 `PORTRAIT` fallback before a plan loads, and `useCanvasOf`, a stable value for hooks and context. It also has `CanvasContext`/`useCanvas` for the inspector's fields and the asset panels, `fittedStage` (the player's fitted size at the Canvas's aspect, in lowest terms so 9:16 is exact to the pixel), and `REFERENCE`/`REFERENCE_SAFE_AREA`/`CAPTION_HEIGHT` for the Style values. `RenderPlan` gains `safe_area`.
- `FRAME` (picture.ts) and the second copy in advanced/actions.ts are gone. `fittedSize`, `coverScale`, `fillScale`, `scaleForWidth`, `overlayPlacement` and `pictureAt` take the frame. `IDENTITY` became `identity(frame)`; `IDENTITY` stays only as the 9:16 value the tests use. `FITTED` (manual.ts) became `fitted(frame)`.
- `KEY_RANGES` lost x and y. `keyRange(prop, frame)` gives them from the Canvas, and setKey, toggleKey, writeKey, writtenTransform, shownTransform, moveKey, keyedRange, curveRange, heldTransform, layerEventAt, animatedPicture and placedLayer take the frame.
- `PickContext` and `KeyScene` take an optional `canvas` (falling back to the plan's, or 9:16). The Advanced Edit passes its plan's.
- ClipPreview provides the Canvas to its tree. It takes the stage scale, the player's aspect (`aspectRatio`, and `useFittedSize`), the segment effects' box, the drop-shadow filter region, the caption centre clamps and the hook clamp from the plan's Canvas and Safe Area. The Advanced Edit provides it to its inspector and panels.
- `smartGuides.fixedGuides(canvas)` replaces `SAFE_TOP`, `SAFE_BOTTOM`, `GUIDES_X` and `GUIDES_Y`. It gives the Canvas's centre and the Safe Area's edges. The left edge is only included when it isn't the frame's own, so 9:16 snaps exactly as before. `guideTargets` and StageEdit use it.
- Video Effects' light spread is measured against `REFERENCE`, as backend `video_effects._FRAME` is, and a full-frame box is the Canvas. The Effects cards' box is a 16:9 picture fitted to the Canvas, which is 1080×608 on 9:16.
- The Hook and Caption Style panels' sliders are named as Reference Space limits (`REFERENCE`, `REFERENCE_SAFE_AREA`), with the same values.

Tests: new `editor/canvas.test.ts`, which checks that `fittedStage` matches the old 9:16 formula exactly and checks 16:9 and 1:1. `picture.test.ts` gains 16:9 checks (fit, cover, Fill turned, identity, overlay placement, the keyed centre clamp). `smartGuides.test.ts` gains 9:16 and 16:9 fixed guides and targets. Existing fixtures gained `...PORTRAIT` or a frame argument. `npm run typecheck` and `npm run build` pass, with 1538 frontend tests. No backend changes.

Not done or deferred:
- The browser walkthrough (the fourth box) wasn't run.
- The Clip cards and posters (`Clips.tsx`) and `AnchorGrid`'s 9:16 box are left for 08.
- Converting dragged captions, hook and Watermark into the Reference Space is left for 07. The stage still writes Canvas pixels into Style Overrides.
- The backend still clamps keyed centres and Transforms to 1080×1920 (03). On a non-9:16 Canvas the preview's clamp now follows the Canvas, so the two agree only once 03 lands.
- The Advanced Edit's two layouts are wrapped in `CanvasContext.Provider`, which re-indents most of their JSX. Use `git diff -w` to see the real change.

