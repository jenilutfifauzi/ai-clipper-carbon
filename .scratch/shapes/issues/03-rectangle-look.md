# 03: A rectangle's look: stroke, no fill, rounded corners and a drop shadow

**Parent spec:** `../spec.md` (Implementation Decisions "Domain and model", "Drawing", Inspector); GLOSSARY (Shape Style).

**What to build:** the rest of a Shape Style, on the rectangle.
- **A stroke** with a colour and a width, drawn inside the width and height.
- **No fill,** for an outline alone. A Shape with no fill and no stroke is refused, in the model and in the inspector.
- **Corner radius** as a fraction of the shorter side, up to 0.5 (a pill).
- **The drop shadow,** as a Text Layer's: the same fields in the inspector, drawn into the picture.

The owner sets them all in the inspector and sees them in the preview and the render.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] An outline-only rectangle has the stroke's colour within its width of every edge and transparency inside, at 400×400 and at 1000×200 alike.
- [ ] A thicker stroke doesn't change the Shape's bounds.
- [ ] A pill's corners are transparent and its middle is filled.
- [ ] A shadow's offset follows its angle and distance in a rendered frame.
- [ ] Turning fill off with no stroke is refused with a clear message.

## Comments
