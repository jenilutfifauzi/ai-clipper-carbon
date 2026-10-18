# 03: A rectangle's look: stroke, no fill, rounded corners and a drop shadow

**Parent spec:** `../spec.md` (Implementation Decisions "Domain and model", "Drawing", Inspector); GLOSSARY (Shape Style).

**What to build:** the rest of a Shape Style, on the rectangle.
- **A stroke** with a colour and a width, drawn inside the width and height.
- **No fill,** for an outline alone. A Shape with no fill and no stroke is refused, in the model and in the inspector.
- **Corner radius** as a fraction of the shorter side, up to 0.5 (a pill).
- **The drop shadow,** as a Text Layer's: the same fields in the inspector, drawn into the picture.

The owner sets them all in the inspector and sees them in the preview and the render.

**Blocked by:** 02

**Status:** done

- [x] An outline-only rectangle has the stroke's colour within its width of every edge and transparency inside, at 400×400 and at 1000×200 alike.
- [x] A thicker stroke doesn't change the Shape's bounds.
- [x] A pill's corners are transparent and its middle is filled.
- [x] A shadow's offset follows its angle and distance in a rendered frame.
- [x] Turning fill off with no stroke is refused with a clear message.

## Comments

**2026-10-18, agent:** Built.
- **Model** (`app/candidates.py`): `ShapeStyle` gains `stroke_colour` (#000000), `stroke_width` (whole px, 0–SHAPE_STROKE_MAX = 200, 0 for none), `radius` (0–0.5 of the shorter side) and `shadow: DropShadow`, all defaulting to "none", so stored Shapes read as before. `Shape` refuses no fill and no stroke: "Shape s1 has nothing to draw: give its style a fill or a stroke (stroke_width)". `CandidateUpdate.shapes`' one-line schema names the new fields (`style:kind,width,height,fill,stroke_*,radius,shadow`): the tools' budget had only ~15 bytes to spare, so 08 will have to raise TOOLS_BUDGET_BYTES to describe Shapes properly.
- **Planner**: a Shape's picture room is SHAPE_ROOM + `shadow.reach`, about the same centre; `area` and `bounds` are its width and height whatever its stroke or corners.
- **Drawing** (`app/text_pictures.py`): `shape_script` writes its shadow, then its fill, then its stroke. `figure_drawing(style, inset)` draws a kind's figure inset on every side ("" when nothing is left); the stroke is the figure plus the figure inset by `stroke_width` turned round (`reversed_drawing` in `app/ass.py`): libass fills by the nonzero rule, so a hole has to go the other way (checked: same direction stays filled). The fill is the figure inset by half the stroke, under the stroke, so no seam shows. A rectangle's corners are `rounded_box` (now taking fractional sizes) with radius `radius × shorter side − inset`, so the inner corners of a ring are concentric. The shadow is the figure (or the ring of an outline alone) moved by `shadow.offset` with `shadow_tags(shadow, 0)` (`\blur`). SHAPE_PICTURE_FORMAT is unchanged: a fill-only Shape draws as before, and the new fields change the layout's hash anyway.
- **Inspector** (`Shapes.tsx`): a Fill switch (off: an outline alone; on again: white) and its colour, Stroke (None at 0) and its colour, Corners (the Overlay's format, `cornersFormat`), and the Text Style's shadow fields (`shadowControls`). With no stroke the Fill switch is disabled and says why (`NOTHING_TO_DRAW`); with no fill the Stroke slider's least is 1 px; `setStyle` never saves a style that `drawsSomething` refuses. `Switch` takes `disabled`. Several picked Shapes (06's `ShapesFields`) get the same fields, Mixed where they differ: a change that would leave one of them with nothing to draw leaves that one as it was, the Fill switch is disabled while any filled one has no stroke, the Stroke's least is 1 px while any has no fill, and turning the fill on or setting its colour keeps each one's own colour or outline.
- Tests: `backend/tests/test_shapes.py` (outline at 400×400 and 1000×200 sampled along every edge, a thick and a thin stroke over a fill keeping its edges, pill corners and round ends, a rounded outline's even thickness into its corners, a rendered frame's shadows at 45°, 180° and −90°, the planner's room and bounds, refusals) and `frontend/src/pages/job/advanced/shapes.test.ts` (default look, the fields, the refusals, one and several picked).
- For 04: give each kind a `case` in `figure_drawing` that draws its figure inset by `inset` on every side, from (0, 0) to (width, height), the same way round as the rectangle (clockwise on screen), returning "" when the inset leaves nothing; the stroke, fill and shadow then come for free. A line and an arrow are all stroke: give them their own branch in `shape_script` (their outline filled in the stroke's colour, or the fill's) rather than a ring. Hide Corners for kinds other than a rectangle.
