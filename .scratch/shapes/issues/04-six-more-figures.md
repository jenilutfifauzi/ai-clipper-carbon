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

**Status:** ready-for-agent

- [ ] Each kind's picture has ink inside its figure and none outside (sampled points per kind), with clean alpha.
- [ ] An outline-only ellipse and triangle keep the stroke's thickness all round.
- [ ] A line and an arrow have ink along their length at the stroke's thickness; the arrow has a head on the right.
- [ ] Each tile adds its kind with the default look; the ellipse's tile shows a circle.
- [ ] Switching a rectangle to an ellipse keeps its width, height, colours and shadow.

## Comments
