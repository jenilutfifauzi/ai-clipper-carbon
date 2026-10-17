# 02: Text Layers are rendered and previewed as pictures

**Parent spec:** `spec.md` (Implementation Decisions "Rasteriser", "Renderer", "Preview and editor"); docs/adr/0010-text-layers-are-rasterised-pictures.md.

**What to build:** a Text Layer is drawn once by libass onto a transparent picture, and that picture is what both the Clip and the preview show.

- **Prove the canvas first.** ffmpeg's `ass` filter with `alpha=1`, over a transparent `rgba` `color` source, should give clean straight alpha with antialiased edges. If it doesn't, recover alpha from a white-on-black and a black-on-white render (difference matting), still with libass.
- **The rasteriser:** it takes a Text Layer event's planned layout and style. It writes the ASS for it (each line at its planned anchor, the stroke as `\bord`, the plate as `\p1` drawings) and runs one ffmpeg into a PNG at the planned size, with a fonts directory holding just the Faces the layout needs.
  - Pictures are cached on disk by a hash of the layout and style, beside the other derived files, and swept with them (ADR 0005).
  - A render makes any missing picture before it starts.
- **The Render Plan:** a Text Layer's event carries its layout, its picture's size and hash, and its Transform planned as an Overlay's, with bounds once turned and scaled.
  - The picture's scale is the layer's Transform scale (keyed scale comes in ticket 12), capped at 4096 px on its longest side.
- **The renderer:** Text Layers leave the ASS script. Each one's picture enters the filter graph by the Overlay's image path, at the same stacking (over the captions, under the hook).
  - Fade, Pop and Slide become opacity, scale and a y offset over time, with the hook's curves.
- **The preview:** it shows the picture (served by the backend by its hash) as an image in the stage's SVG, placed with the Overlay's maths and animated the same way. The last picture stays on screen until a new one has loaded.
  - Inline editing of the words on stage keeps its editable field over the picture.
- **The dry run** lists each Text Layer's picture URL and bounds.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A Text Layer's picture has alpha 0 away from its ink. A white stroke over transparency shows no dark fringe. The same layout gives the same file and isn't made twice.
- [ ] A rendered frame shows a Text Layer's colour, stroke and plate at the planned bounds, matching what ticket 01's ASS path drew within a small tolerance.
- [ ] Fade, Pop and Slide in and out render at the same moments and extents as before.
- [ ] A Text Layer is drawn over the captions and under the hook.
- [ ] The preview shows the picture at the plan's bounds. Moving the layer doesn't request a new picture; changing its colour does.
- [ ] A swept Job's unused pictures are removed, and one used by a Revision is kept.
