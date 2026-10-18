# 02: Tracer: a white rectangle from the Stickers tab to the render

**Parent spec:** `../spec.md` (Solution; Implementation Decisions "Domain and model", "Drawing", "Planning and rendering", "Advanced Edit"); GLOSSARY (Shape, Shape Style, Shape Kind, Stickers tab, Track); docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:** the thinnest Shape that works end to end.
- **The Stickers tab** is a new asset tab with one shelf, Shapes, and one tile for now: rectangle, shown as a square.
- **Clicking the tile** adds a Shape at the playhead for a new Text Layer's length (or to the Clip's end), centred, 400×400, white fill, and picks it.
- **It is stored** in the Candidate's `shapes`:
  - its id, start, secs and Transform (stretch and flips refused);
  - a Shape Style with kind (rectangle only), width, height and fill;
  - `animation_in`, `animation_out`, `animation_ms` and `keys` in the model, with their defaults.
- **It is drawn as a `\p1` picture** on the picture-layer path from 01, over the captions and under the Text Layers. It shows in the preview and in the rendered Clip.
- **It sits on a new Shape Track** under Text, where it can be picked, moved, trimmed and deleted with undo. Corner Grips scale it and the top handle turns it.
- **The inspector** shows its Transform, timing, width, height and fill.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Clicking the rectangle tile adds a picked 400×400 white Shape at the playhead, as one undo step.
- [ ] The preview and a rendered frame show it at its planned bounds; where it overlaps a caption the Shape shows, and where it overlaps a Text Layer the Text Layer shows.
- [ ] Its picture has clean alpha and the planned size at the largest scale it reaches (capped).
- [ ] A Shape with stretch or a flip is refused with a clear message.
- [ ] A stored Candidate without `shapes` reads and renders as before.
- [ ] Moving, trimming and deleting it on the Shape Track work with undo and redo.

## Comments
