# 06: Smart Guides

**Parent spec:** `spec.md` (user stories 41–44; Implementation Decisions "The stage"); ADR 0007.

**What to build:** while a picture is moved or scaled, its edges and centre (its box after rotation) snap within 6 CSS px to:
- the frame's edges and centre;
- the fixed guides;
- the edges and centres of the other pictures shown at the playhead.

A line marks each snap, and Alt turns snapping off.

- **The targets** are a pure function of the plan at the playhead: the other pictures' `bounds`, the frame, and `GUIDES_X`/`GUIDES_Y`. Text is not a target.
- **The snap** returns the adjusted Transform and the lines to draw. Corner scale snaps the moving edges.

**Blocked by:** 05

**Status:** done

- [x] Seam H:
  - [x] a snap at 4 CSS px, with its line reported;
  - [x] no snap at 10 px;
  - [x] no snap with Alt;
  - [x] a rotated picture snaps by its bounds;
  - [x] the picture being dragged is not its own target.
- [ ] Walkthrough: two Overlays snap edge to edge, and an Overlay snaps to a media Segment scaled down.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `frontend/src/pages/job/editor/smartGuides.ts` (tests beside it) covers this ticket's Seam H list. `guideTargets(frame, pictures, dragged)` takes the pictures at the playhead as `{ id, bounds }` (the plan's `Picture.bounds`) and leaves out `dragged`. After `moved(...)` call `snapMoved(transform, fitted, targets, { unit, alt })`, and after a corner's `scaled(...)` call `snapScaled(...)`; `unit` is frame px per CSS px. Both return `{ transform, guides: { x: [], y: [] } }`, the lines to draw. `GUIDES_X`, `GUIDES_Y` and `SNAP_CSS_PX` are exported from `StageEdit.tsx`. Edge stretch doesn't snap.

**2026-10-16: done.** Built on `smartGuides.ts` above, test first for the new seam (`smartGuides.test.ts`).

- **`smartGuides.ts`** now holds `SNAP_CSS_PX`, `SAFE_TOP`, `SAFE_BOTTOM`, `GUIDES_X` and `GUIDES_Y` (moved out of `StageEdit.tsx`, which imports them, as `ClipPreview.tsx` does the safe area), so the pure module no longer imports a React file. New `picturesAt(plan, time, scene)`: the pictures shown at the playhead by their stage ids, the Scene's picture (`picture:<n>`; none for an automatic Scene, or with `scene` null) and then the Overlays showing (`overlay:<id>`, `start <= time < end`, as `PreviewOverlays` shows them).
- **`useStageEdit`** takes a last argument `atPlayhead` (default none). In `pictureHandlers`' `move`, after `dragged(…)`, a body drag goes through `snapMoved` and a corner through `snapScaled`, with `guideTargets(plan, others, id)`, where `others` are `atPlayhead()`'s pictures by their bounds as drawn (`shownPicture`), less those moving with it when several are picked. `{unit, alt: pointer.altKey}`. Edges and rotate don't snap. The lines go in the stage's `guides` state, now `SmartGuides` (`{x: number[], y: number[]}`); a text's one fixed-guide snap is put in it as a list of one. They're cleared on pointer up and cancel.
- **`StageHandles`** draws one line per entry in `guides.x` and `guides.y`.
- **`ClipPreview.tsx`** passes `() => picturesAt(plan, playback.time, blank ? null : sceneAt(plan, playback.time, playback.shownSegmentIndex))`. Locked Overlays are still targets, since they're shown. Hidden Tracks aren't: hidden Overlay Tracks are already left out of the plan, and a hidden Video Track drops the Segment's picture.

Not tried: no browser walkthrough (two Overlays snapping edge to edge; an Overlay snapping to a media Segment scaled down).
