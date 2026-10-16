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

**Status:** ready-for-agent

- [ ] Seam H:
  - [ ] a snap at 4 CSS px, with its line reported;
  - [ ] no snap at 10 px;
  - [ ] no snap with Alt;
  - [ ] a rotated picture snaps by its bounds;
  - [ ] the picture being dragged is not its own target.
- [ ] Walkthrough: two Overlays snap edge to edge, and an Overlay snaps to a media Segment scaled down.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: pure gesture modules ready.** `frontend/src/pages/job/editor/smartGuides.ts` (tests beside it) covers this ticket's Seam H list. `guideTargets(frame, pictures, dragged)` takes the pictures at the playhead as `{ id, bounds }` (the plan's `Picture.bounds`) and leaves out `dragged`. After `moved(...)` call `snapMoved(transform, fitted, targets, { unit, alt })`, and after a corner's `scaled(...)` call `snapScaled(...)`; `unit` is frame px per CSS px. Both return `{ transform, guides: { x: [], y: [] } }`, the lines to draw. `GUIDES_X`, `GUIDES_Y` and `SNAP_CSS_PX` are exported from `StageEdit.tsx`. Edge stretch doesn't snap.
