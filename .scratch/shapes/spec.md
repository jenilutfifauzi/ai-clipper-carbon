# Shapes at parity with Concat: seven figures on the Stickers tab

Status: done
Created: 2026-10-18

## Problem Statement

The Advanced Edit can add words (Text Layers), pictures and videos (Overlays) over a Clip, but no figures.

**No figures.** Short-form edits use a bar behind a title, a circle round a face, an arrow at a product, or a line under a word. Today the owner can only do this with an image made elsewhere and uploaded to the Media Library as an Overlay. Its colours can't be changed, and stretching it thickens its outline on the long sides.

**Concat has them.**
- Its Stickers page has one shelf, Shapes, with seven figures: square, circle, triangle, parallelogram, trapezoid, line and arrow.
- Each figure has a fill (or none), a stroke and a stroke width.
- Each is a clip of its own, placed and keyed like a still.

**Out of Scope until now.** `.scratch/advanced-edit/spec.md` lists stickers. ADR 0011 overturns that for Shapes only.

## Solution

A **Shape** is a new item of the Advanced Edit, added from a new **Stickers tab**. It is a twin of a Text Layer with a figure in place of words:
- its time in Timeline time;
- a Transform (position, scale, rotation and opacity, with Keyframes; never stretched nor flipped);
- a **Shape Style**;
- the Text Layer's in/out animations.

It is drawn as a Text Layer is (ADR 0010, ADR 0011):
- the planner writes the figure as a `\p1` drawing;
- libass draws it once into a PNG;
- the PNG is placed by the Transform and Keyframes in the render;
- the preview shows the same PNG.

**Shape Style.**
- **Kind:** rectangle, ellipse, triangle, parallelogram, trapezoid, line or arrow.
- **Size:** `width` and `height` in output pixels.
- **Fill:** a colour, or none for an outline alone.
- **Stroke:** a colour and a width, drawn inside the width and height.
- **Radius:** a rectangle's corners, as a fraction of its shorter side (0.5 makes a pill).
- **Drop shadow:** as a Text Style's.

A line and an arrow are all stroke. Their width is their length, the stroke width their thickness and the stroke's colour theirs (the fill's when the stroke has none). The arrow's head is in proportion to the thickness.

**On the stage.** The corner Grips scale the Shape and the top handle turns it. The edge Grips change its width or height, which re-draws the picture, so a stroke stays one thickness and a corner stays round. A line's and an arrow's Grips are their two ends and the rotate handle.

**Layering.** Segments < Overlays < Watermark < captions < **Shapes** < Text Layers < hook. On the Timeline, Shapes have their own Track, Shape, under Text.

**Everywhere a Text Layer goes.** A Shape is picked, moved, trimmed, split, copied, pasted and deleted like a Text Layer, with the same:
- Magnetic timeline and Ripple delete;
- Split all and Edit Points;
- Smart Guides, Keyframes pane and Auto-key;
- Revision merge and Clipboard.

The agent adds, changes and removes Shapes through the MCP tools.

## User Stories

1. As the owner, I want a Stickers tab with a Shapes shelf, so that I can find figures beside Text and Media.
2. As the owner, I want to click a figure's tile to add it at the playhead, centred, white, for the length a new Text Layer gets, so that adding one is one click.
3. As the owner, I want to drag a tile onto the Timeline or the preview, so that it lands where and when I drop it.
4. As the owner, I want to drag a rectangle's side to make it wider without its stroke getting thicker, so that a bar behind a title looks right at any size.
5. As the owner, I want rounded corners on a rectangle up to a pill, so that I can make a label plate or a button.
6. As the owner, I want an outline-only figure (no fill), so that I can circle something in the video.
7. As the owner, I want a line and an arrow whose length I drag by their ends and whose thickness is their stroke width, so that pointing at something is quick.
8. As the owner, I want a drop shadow on a figure, as on a title, so that it stands off busy video.
9. As the owner, I want to move, turn, scale and fade a Shape, and key those over time, so that it can follow or pop as titles do.
10. As the owner, I want the same in and out animations as a Text Layer, so that a plate and its title come on together.
11. As the owner, I want Shapes drawn over the captions and under Text Layers, so that a Shape can sit behind a title.
12. As the owner, I want a Shape Track I can hide and lock, so that I can work on titles without catching Shapes.
13. As the owner, I want copy, paste, duplicate, split, ripple and multi-select to treat Shapes as they treat Text Layers, so that nothing new needs learning.
14. As the owner, I want the preview to show exactly what the render draws, so that what I place is what I publish.
15. As the agent, I want to add, change and remove Shapes and see their bounds and picture in a dry run, so that I can lay out a Clip's graphics as I do its titles.

## Implementation Decisions

### Domain and model

- **`Candidate.shapes: list[Shape]`** (backend `candidates.py`, beside `TextLayer`) holds:
  - `id`, `start` and `secs` (Timeline time);
  - `transform`, with stretch and flips refused unless at their defaults, as a Text Layer's are;
  - `style: ShapeStyle`;
  - `animation_in`, `animation_out` and `animation_ms` (the `Animation` enum and range a Text Layer has);
  - `keys` (position, scale, rotation and opacity only).
- **`ShapeStyle`** holds:
  - `kind: ShapeKind` (rectangle, ellipse, triangle, parallelogram, trapezoid, line, arrow);
  - `width` and `height` (px, bounded; `height` ignored for a line and an arrow);
  - `fill: Colour | None`;
  - `stroke_colour: Colour` and `stroke_width` (px, 0 for none);
  - `radius` (0–0.5, used by a rectangle only);
  - `shadow: DropShadow`.
- **Colours are the existing `Colour`,** with no alpha. Opacity is the Transform's, so it can be keyed.
- **A Shape with nothing to draw is refused,** with a clear message: no fill and no stroke, or a line or arrow with no stroke width.
- **No migration:** stored Candidates read with `shapes` empty.
- **Revision merge** treats `shapes` item by item, as `text_layers`.

### Drawing (ADR 0011)

- **The planner gives each Shape a layout:** its kind, its size at the largest scale it reaches (as ADR 0010's, capped at `MAX_TEXT_PICTURE`), and its fill, stroke, radius and shadow scaled to match.
- **The figure is one `\p1` drawing,** in the picture's own pixels:
  - The fill is the figure.
  - The stroke is the figure less the figure inset by the stroke width (an even-odd ring), so it is drawn inside. A line or an arrow is drawn as its own outline.
  - A rectangle's corners reuse `rounded_box`.
  - An ellipse is four béziers.
  - The shadow is the figure again, moved and blurred, as a Text Layer's.
- **It is rasterised by `text_pictures`' difference matting,** kept in the same folder, named by the layout's hash, and swept with the Text Layers' pictures (`pictures_used` counts Shapes).
- **Every kind keeps its centre** at the picture's centre, so the Transform's centre is the figure's.

### Planning and rendering

- **In the Render Plan, Shape events are placed by the Overlay's path,** with Keyframes and animations stacked on the keyed values as a Text Layer's are.
- **The filter graph lays them after the captions and before the Text Layers.**
- **The preview shows each picture by URL,** moved, turned, scaled and faded by CSS with the same maths. While a new picture is being made, the last one stays on screen.

### Advanced Edit

- **Stickers tab:** a new `AssetTab` ("Stickers", lucide `sticker`) with one shelf, Shapes, and a tile per kind.
  - The tiles show a square and a circle for rectangle and ellipse.
  - Clicking a tile adds a Shape at the playhead for `TEXT_SECS` (or to the Clip's end), centred, 400×400 (a line or an arrow 600 long, stroke 12), white fill and no stroke, and picks it.
  - A tile can also be dragged to the Timeline or the preview.
- **Track:** a new `TrackKind` `"shape"`, under Text, with hide and lock. Its lanes are worked out as the Text Track's are.
- **Generic actions** take Shapes wherever they take Text Layers:
  - Pick and multi-select;
  - move, trim and split (Split all included);
  - delete and Ripple delete, and the Magnetic timeline;
  - duplicate and the Clipboard;
  - Edit Points, Smart Guides, the Keyframes pane and Auto-key;
  - Zoom to fit.
- **Inspector:**
  - the kind (to switch a Shape's figure, keeping its size and look);
  - width and height;
  - fill (with a "none" switch), stroke colour and width, radius (rectangle only);
  - the drop shadow (the Text Style's shadow fields);
  - the Transform fields and the timing and animation fields, as for a Text Layer.
- **Grips:** the corners scale, the top handle turns, and the edges set `width` or `height`.
  - While a drag lasts, the preview stretches the last picture with CSS. On release the new size is saved (one undo step) and its picture replaces the old one.
  - A line's and an arrow's Grips are their two ends: dragging one end moves that end, and with it the centre and the length.
- **The clip editor** shows Shapes in its preview but doesn't add or edit them.

### Agent (MCP)

- **`edit_candidate` and `merge_candidate_items` take `shapes`.** `merge_candidate_items` merges `style` and `transform` field by field, as for Text Layers.
- **The dry run lists each Shape's id, times, bounds and picture URL.**
- **The tool descriptions name the Shape Kinds, the stacking order** and the refusals.

## Testing Decisions

Good tests here check what is seen and stored: pixels of a rendered frame or of a Shape's picture, bounds in a Preview Plan, what the API and MCP accept and refuse, and what the editor's actions leave in a Candidate. They don't check how a `\p1` path is spelled.

- **Pictures and renders (HTTP and real ffmpeg; prior art: the Text Layer picture and render tests):**
  - **Each kind.** The picture has ink where its figure is and none outside (sampled points per kind), with clean alpha.
  - **Stroke.** An outline-only rectangle has the stroke's colour within `stroke_width` of the edge, and transparency inside. Widening it keeps the stroke's thickness on every side.
  - **Corners.** A pill's corners are transparent and its middle is filled.
  - **Line and arrow.** Ink is along the length at the stroke's thickness, and the arrow has a head at the right.
  - **Placement and motion.** A Shape's fill lands at the planned bounds in a rendered frame. A rotated one's corners are where the turned bounds say. A keyed one is at its keyed place at given frames.
  - **Order.** Where a Shape and a Text Layer overlap, the Text Layer's colour shows. Where a Shape and a caption overlap, the Shape's shows.
- **Planner (pure):**
  - The scale of the picture comes from the keyed maximum and is capped.
  - A Shape's bounds follow its width and height.
  - Shapes come after the captions and before the Text Layers in the plan's order.
- **Model and API:**
  - A Shape with stretch or flips is refused, and so is one with nothing to draw.
  - `merge_candidate_items` changing only `style.fill` keeps the rest.
  - A Revision merge takes another editor's new Shape.
- **Editor (vitest; prior art: the Advanced Edit `actions` and keyed Text Layer tests):**
  - A tile adds the default Shape at the playhead.
  - Edge Grips set `width` and `height`, and corner Grips set the scale.
  - Split, Ripple delete, the Magnetic timeline and the Clipboard treat a Shape as a Text Layer.
  - A hidden Shape Track hides Shapes in the preview, and a locked one refuses hand edits.

## Out of Scope

- **Image stickers,** a built-in PNG or GIF pack. They would be Overlays of built-in items, in a feature of their own. The Media Library still takes no GIF.
- **Shape Presets.** A tile adds the default look; duplicate and the Clipboard reuse one.
- **Keyframes on colour, stroke or size.** Each key would need a picture of its own.
- **Gradient fills,** and a "Draw" animation for lines and arrows.
- **Rounded corners on figures other than a rectangle.**
- **A saved stacking order** among Shapes and Text Layers (bring forward or send back).
- **Adding or editing Shapes in the clip editor.**

## Further Notes

- Decided in a grilling session on 2026-10-18. See ADR 0011 and GLOSSARY (Shape, Shape Style, Shape Kind, Stickers tab).
- Reference: `docs/referensi/concat/src/crates/concat-project/src/model.rs` (`ShapeKind`, `ShapeStyle`) and `concat-host/src/titles.rs` (one painter for titles and shapes).
