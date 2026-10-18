# 05: Resizing a Shape on the stage

**Parent spec:** `../spec.md` (Solution "On the stage"; Implementation Decisions Grips); GLOSSARY (Grips); docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:**
- **Edge Grips.** A Shape's edge Grips set its width or height, never stretch.
  - While the drag lasts, the preview stretches the last picture.
  - On release the size is saved as one undo step, and the new picture replaces the old one when it is ready.
- **Line and arrow ends.** A line's and an arrow's Grips are their two ends and the rotate handle. Dragging one end moves that end alone: the centre, length and rotation follow, and the other end stays put.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] An edge drag on a rectangle changes its width (or height) and leaves its scale and stroke width as they were.
- [ ] After the drag, the stroke is the same thickness on every side in the preview and the render.
- [ ] Dragging an arrow's head leaves its tail where it was.
- [ ] One drag is one step of undo.

## Comments
