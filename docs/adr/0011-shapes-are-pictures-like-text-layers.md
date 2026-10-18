# 0011: Shapes are pictures, like Text Layers

Status: accepted
Date: 2026-10-18

Builds on 0010 (a Shape takes the Text Layer's path: drawn once by libass, placed as a picture) and 0008 (Shapes have Keyframes).

## Context

The `shapes` feature (roadmap #9, `.scratch/advanced-edit-v2/roadmap.md`) brings Concat's shapes to the Advanced Edit:
- **Concat has seven figures:** square, circle, triangle, parallelogram, trapezoid, line and arrow.
- **Each has a fill, a stroke and a stroke width**, on a Stickers page whose only shelf is Shapes.
- **In Concat a shape is its own clip kind,** painted by the painter of its titles ("a shape is a title with no words") and placed like a still.
- **A rectangle there is a stretched square.**

The proposal was to draw Shapes as ASS vector drawings (`\p1`) "through libass like Text Layers". Since ADR 0010, Text Layers aren't ASS events: libass draws each one once into a PNG, which goes into the filter graph by the Overlay's path, placed by a Transform and Keyframes. The Text Layer's plate is already a `\p1` drawing with rounded corners (`rounded_box`).

`.scratch/advanced-edit/spec.md` lists stickers as Out of Scope.

## Decision

- **A Shape is its own item, not a Text Layer with no words.**
  - It lives in a list of its own on the Candidate, `shapes`.
  - Each Shape has an `id`, a `start` and `secs` in Timeline time, a `transform`, a `style` (a Shape Style), the Text Layer's in/out animations and `keys`.
  - It gets its own Track, Shape, under Text.
- **It is drawn as Text Layers are (ADR 0010).**
  - The planner writes the figure as a `\p1` drawing.
  - libass draws it once into a PNG with straight alpha, by the same difference matting, cached by a hash of its style.
  - The PNG is placed by the Shape's Transform and Keyframes. Fade, Pop and Slide are operations on that transform.
  - The preview shows the same PNG.
- **A Shape has a width and height of its own, and is never stretched.**
  - The Shape Style holds `width` and `height` in output pixels, before the Transform's scale.
  - The Transform refuses stretch and flips, as a Text Layer's does.
  - On the preview, a Shape's edge Grips change its width or height. While the drag lasts, the last PNG is stretched with CSS; the new one replaces it when it is ready.
  - So a stroke stays one thickness all round, and a rounded corner stays round.
- **Its stroke is drawn inside its width and height.** The Grips' box is the picture's edge, and a thicker stroke doesn't make a figure bigger.
  - A line and an arrow are all stroke instead: their width is their length and their stroke width their thickness.
  - The arrow's head is in proportion to the thickness.
- **Only a rectangle has rounded corners.** Its radius is a fraction of its shorter side (0.5 makes a pill), as an Overlay's is.
- **Shapes are drawn over the captions and under the Text Layers.**
  - The order is Segments < Overlays < Watermark < captions < Shapes < Text Layers < hook.
  - The order is fixed by kind. No item saves a place in a stack.
- **The figures are named for what they draw:** rectangle, ellipse, triangle, parallelogram, trapezoid, line and arrow. A square and a circle are a rectangle and an ellipse of equal sides, as the Stickers tab's tiles add them.

## Considered options

- **ASS vector events in the script with the captions and the hook,** as proposed. They are sharp at any scale, but they bring back what ADR 0010 left behind:
  - Eases would have to be broken into many linear `\t` and `\move` steps.
  - Rotation would need `\org`.
- **A Text Layer with an optional figure and no words.** This is less new code, but every reader of Text Layers would ask "words or figure?": the wrap, the fallback Face, emoji, Text Presets and the agent's tools.
- **An Overlay of a generated image.** It would get stretch, radius, border and shadow for free. But the Media Library would fill with generated files, and a Shape's colours couldn't be edited as colours.
- **Our own rasteriser** (SVG through resvg, or Pillow). It would be quicker than an ffmpeg run, but it is a second drawing engine beside libass, for figures that `\p1` draws already.
- **Stretching the picture for rectangles, as Concat does.** It is instant, but a stroke would come out thicker on the stretched sides, and rounded corners would turn elliptical.
- **A saved stacking order shared by Shapes and Text Layers** (bring forward, send back). It is the most flexible, but it would bring a new kind of order into the model and the Timeline. Today the fixed order covers what a Shape is for: a plate or an accent under a title, over the captions.

## Consequences

- **Overturns the Out of Scope line on stickers** in `.scratch/advanced-edit/spec.md`, for Shapes only. Image stickers (a built-in PNG or GIF pack) stay out, and the Media Library still takes no GIFs.
- **Changing a Shape's look or size costs a rasterisation** (one short ffmpeg run). Moving, turning, scaling and fading it costs nothing.
- **Pictures are rasterised at the largest scale the Shape reaches,** at most 4096 px on the longest side, as in ADR 0010. A Shape's pictures are kept and swept with the Text Layers' pictures.
- **Colours and sizes have no Keyframes.** Each key would need a picture of its own. Only position, scale, rotation and opacity are keyed.
- **The agent adds, changes and removes Shapes** as it does Text Layers. A dry run shows each Shape's bounds and its picture's URL.
- **Not now:**
  - Shape Presets (a tile adds the default look; duplicate and the Clipboard reuse one);
  - gradients (`\p1` fills one colour);
  - a "Draw" animation for lines and arrows.
