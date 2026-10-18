# 07: Shapes move: Keyframes and in/out animations

**Parent spec:** `../spec.md` (Implementation Decisions "Domain and model", "Planning and rendering"); GLOSSARY (Keyframe, Auto-key, Keyframes pane); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:**
- **Keyframes.** A Shape's position, scale, rotation and opacity can be keyed from the Keyframes pane, the inspector's key buttons and Auto-key on the Grips, as a Text Layer's can. The preview and the render play them. Trim, split, and the Clipboard keep the motion on the same moments.
- **In/out animations.** A Shape comes on and goes off with the Text Layer's animations (Fade, Pop, Slide) and length, stacked on its keyed values.
- **The picture size** follows the largest keyed scale.

**Blocked by:** 02

**Status:** done

- [x] A keyed Shape is at its keyed place and opacity at given frames of a render, and at the same places in the preview.
- [x] Pop over a keyed scale peaks at the product of the two.
- [x] On a keyed Shape, corner and rotate Grips write Keyframes at the playhead.
- [x] Splitting a keyed Shape keeps its motion on the same moments in both halves.

## Comments

**2026-10-18, agent:** Built. Most of the seam was already in place from 01 and 02; this ticket adds the inspector's Motion fields and the tests that hold Shapes to the Text Layer's motion.
- **Inspector**: `MotionFields` (`TextLayers.tsx`), the Motion group (Comes on, Goes off and, once either animates, Animation length) taken out of `TextLayerFields` for a Text Layer or a Shape (`kind`; history groups `text:<id>:animation_in` and so on, as before). `ShapeFields` (`Shapes.tsx`) shows it under the Transform.
- **Keyframes**: no change was needed. `KINDS.shape` in `keying.ts` gives the Keyframes pane (Dopesheet, Curves), K and the ruler's diamonds the Shape's position, scale, rotation and opacity rows. The stage's Grips auto-key through `writeItemTransform`. Split, trim (`retimed`), nudge and the Clipboard (`copy`/`paste`, which `rekeyed` what is cut short) go by `actions.ts`' `KINDS`, which has `shape`. The preview's `PictureLayerView` animates every picture layer by `hookLook` on its Keyframes. The renderer's `layer_at` and the planner's `picture_scale` already took Shapes.
- Tests: `frontend/src/pages/job/advanced/keyedShapes.test.ts` (rows, toggle, Grips writing scale and rotation Keyframes at the playhead, ruler drag, Clear all and Reset, split, trim, Clipboard, nudge, the Motion fields' markup and what they store) and `backend/tests/test_keyed_shapes.py` (model refusals, picture motion in Clip time and keyed bounds, Pop over a keyed scale, a split's halves playing the whole's values, and a render: a slid bar at its eased x, a faded square at its keyed opacity, and a popped square peaking at its keyed scale 2 and at 85% of it half way in, with the preview plan carrying the same Keyframes in Clip time).
- The backend tests passed as soon as they were written: they pin behaviour 01 and 02 had already built.
- Checked: backend 799 passed (3 deselected); frontend 739 passed; tsc clean.
