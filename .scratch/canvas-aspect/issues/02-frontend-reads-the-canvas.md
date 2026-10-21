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

**Status:** ready-for-agent

- [ ] vitest: fitting and cover scale computed for a given Canvas (9:16 values unchanged, 16:9 values correct).
- [ ] vitest: guides built from a plan's Safe Area.
- [ ] `npm run typecheck && npm run build` pass, and no import of a global 1080×1920 frame remains.
- [ ] Browser walkthrough: a 9:16 Candidate's Advanced Edit and clip editor look and drag exactly as before.
