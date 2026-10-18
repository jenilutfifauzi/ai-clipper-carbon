# 04: Six more figures: ellipse, triangle, parallelogram, trapezoid, line and arrow

**Parent spec:** `../spec.md` (Solution; Implementation Decisions "Drawing", "Advanced Edit"); GLOSSARY (Shape Kind, Shape Style).

**What to build:** every Shape Kind, each with a tile on the Stickers tab.
- **The four filled figures** (ellipse, triangle point up, parallelogram leaning right, trapezoid narrower at the top) take the fill, the stroke inside, and the shadow, as the rectangle does. Their centre is the picture's centre. Radius is a rectangle's only.
- **A line and an arrow are all stroke.** Their width is their length and their stroke width their thickness. Their colour is the stroke's, or the fill's when the stroke has none. Their height isn't used.
  - A new one is 600 long with stroke 12.
  - The arrow's head is on the right, in proportion to the thickness.
  - A line or an arrow with no stroke width is refused.
- **The inspector's kind field** switches a Shape's figure, keeping its size, colours and shadow. Fields a kind doesn't use are hidden.

**Blocked by:** 03

**Status:** done

- [x] Each kind's picture has ink inside its figure and none outside (sampled points per kind), with clean alpha.
- [x] An outline-only ellipse and triangle keep the stroke's thickness all round.
- [x] A line and an arrow have ink along their length at the stroke's thickness; the arrow has a head on the right.
- [x] Each tile adds its kind with the default look; the ellipse's tile shows a circle.
- [x] Switching a rectangle to an ellipse keeps its width, height, colours and shadow.

## Comments

**2026-10-18, agent:** Built.
- **Model** (`app/candidates.py`): `ShapeKind` has all seven kinds; `ShapeKind.all_stroke` is a line's and an arrow's. `ShapeStyle.size` is the box a figure fills: `(width, height)` for the five filled kinds, `(width, stroke_width)` for a line, `(width, ARROW_HEAD × stroke_width)` for an arrow (ARROW_HEAD = 4). A line's or an arrow's `height` and `fill` are stored and validated as before but not used, so that switching the kind back finds them; its colour is `stroke_colour`. A line or an arrow with `stroke_width` 0 is refused: "Shape s1 has nothing to draw: a line (an arrow) is all stroke, its stroke_width its thickness: give it one".
- **Colour of a line:** "the stroke's, the fill's when the stroke has none" can't be a stored rule, since a line's stroke width is never 0. It is the editor's: a new line or arrow is 600 × 12 with `stroke_colour` white, and a figure with no stroke switched to a line or an arrow gets a 12 px stroke in its fill's colour (`withKind` in `shapeStyle.ts`). GLOSSARY's Shape Style says so now.
- **Planner**: `shape_event` uses `style.size` for the area, the bounds and the picture; the centre is the Transform's as before (an arrow's is the middle of its length, on its shaft's centre line).
- **Drawing** (`app/text_pictures.py`): `figure_drawing` draws the rectangle, ellipse (four Béziers; inset, the true parallel curve as 360 short lines, with the part that crosses itself cut where the stroke is thicker than the ends are round), triangle (point up, filling its box), parallelogram (leaning right) and trapezoid (narrower at the top), whose slant is SLANT = 0.25 of the shorter side, so the angle stays put as the width changes. The polygons are inset by cutting with each side moved in square to itself (`_inset`), so a stroke is even. `line_drawing` draws a line as a bar with round ends and an arrow as a shaft with a round tail and a solid head 4 thicknesses tall and 3 long (all head when shorter); `shape_script` fills it in `stroke_colour`, with its shadow.
- **Editor**: `ShapeKind` widened in `api.ts`; `SHAPE_KINDS`, `allStroke`, `withKind` and `drawsSomething` (a line needs a thickness) in `shapeStyle.ts`. Stickers tab: an SVG tile per kind (a square, a circle, …). Inspector: a Figure field switching the kind (`withKind`), Corners for a rectangle only, and for a line or an arrow Length, Thickness (at least 1 px) and Colour with no Height nor Fill; several picked Shapes get the Figure field (Mixed where they differ), and Height and Fill (on the filled ones) and Corners (on the rectangles) while one of them uses it.
- Tests: `backend/tests/test_shapes.py` (sizes and bounds per kind, refusals, ink inside and none outside with clean alpha per filled kind, an outline ellipse's even thickness at 24 and 40 px on 800 × 200 and a triangle's across each side, a line's and an arrow's ink along their length at their thickness in their stroke's colour, the arrow's head at the right, a line's shadow) and `frontend/src/pages/job/advanced/shapes.test.ts` (tiles, default looks, `drawsSomething`, the kind switch, fields per kind, several picked).
- For 05: a line's or an arrow's box on the stage is its `style.size` (length × thickness, or length × head), and its corner Grips are those of that thin box today. The two ends are at ±width/2 along the Transform's rotation from its centre, on the shaft's centre line; dragging an end sets `width` (the length) and moves `transform.x/y` to the new middle (and `rotation` to the new angle), its thickness unchanged. Its stored `height` is never touched by its Grips.
