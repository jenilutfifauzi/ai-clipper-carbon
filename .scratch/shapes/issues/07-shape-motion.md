# 07: Shapes move: Keyframes and in/out animations

**Parent spec:** `../spec.md` (Implementation Decisions "Domain and model", "Planning and rendering"); GLOSSARY (Keyframe, Auto-key, Keyframes pane); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:**
- **Keyframes.** A Shape's position, scale, rotation and opacity can be keyed from the Keyframes pane, the inspector's key buttons and Auto-key on the Grips, as a Text Layer's can. The preview and the render play them. Trim, split, and the Clipboard keep the motion on the same moments.
- **In/out animations.** A Shape comes on and goes off with the Text Layer's animations (Fade, Pop, Slide) and length, stacked on its keyed values.
- **The picture size** follows the largest keyed scale.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A keyed Shape is at its keyed place and opacity at given frames of a render, and at the same places in the preview.
- [ ] Pop over a keyed scale peaks at the product of the two.
- [ ] On a keyed Shape, corner and rotate Grips write Keyframes at the playhead.
- [ ] Splitting a keyed Shape keeps its motion on the same moments in both halves.

## Comments
