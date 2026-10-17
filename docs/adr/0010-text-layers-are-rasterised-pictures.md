# 0010: Text Layers are rasterised pictures

Status: accepted
Date: 2026-10-17

Amends 0001 (for Text Layers, the preview shows the render's own pixels), 0007 (Text Layers are placed by a Transform) and 0008 (Text Layers have Keyframes).

## Context

The `text-advanced` feature (roadmap #8, `.scratch/advanced-edit-v2/roadmap.md`) brings Text Layers to parity with Concat's title style. That adds:
- stroke, a drop shadow, and a plate with its own radius and padding;
- line height, tracking, wrap width and a fixed height;
- weight and italic, chosen among a family's faces;
- imported fonts, colour emoji and CJK;
- rotation, scale and opacity on stage, with Keyframes.

Today:
- **Text Layers are ASS events.** Each line is its own Dialogue event, centred on an anchor the planner works out, burned by libass along with the captions and the hook.
- **The preview draws them as SVG** `<text>` and `<rect>` at the planned boxes (ADR 0001).
- **libass 0.17 draws no colour glyphs** (sbix, CBDT, COLR). The planner strips emoji everywhere.
- **libass has no eased motion.** `\move` and `\t` are linear or exponential only, while ADR 0008's Eases are cubic-beziers. `\frz` turns each event about its own centre unless every line and the plate share a `\org`.
- **Glyph fallback is the operating system's.** No `fontprovider` is set, so a character the font lacks comes from CoreText on a Mac and fontconfig on Linux. `font_metrics` counts such a character as one em wide.
- **Overlays already have everything a moving picture needs:** a Transform (ADR 0007), Keyframes with Eases (ADR 0008) in the filter graph, and a preview that applies the same maths with CSS.

## Decision

- **A Text Layer is planned as text and rendered as a picture.**
  - The planner lays it out: it breaks lines at newlines and between words at the wrap width (UAX #14), measures runs per face, and works out the plate and the box.
  - libass draws the layout once onto a transparent canvas (ffmpeg's `ass` filter with `alpha=1`) into a PNG.
  - Emoji are pasted into that PNG from Noto Color Emoji's images, at the places the planner gave them.
  - The PNG goes into the filter graph by the Overlay's path, placed by the layer's Transform and Keyframes. Fade, Pop and Slide become operations on that transform, stacked on the keyed values.
- **The picture is rasterised at the largest scale the layer reaches,** constant or keyed, at most 4096 px on its longest side, so the render only ever scales it down. Pictures are cached by a hash of their layout and style, as derived files are (ADR 0005).
- **The preview shows the same PNG.** It is served by the backend, and moved, turned, scaled and faded by CSS with the Overlay's maths. While a new picture is being made (inside the plan's 250 ms debounce), the last one stays on screen.
- **Fallback is explicit.** The planner gives a run the style's face lacks a `\fn` of one bundled CJK face, and measures it with that face; emoji go to the image path. libass's own fallback is never relied on.
- **The look is a `TextStyle`, the place a Transform.** A Text Layer is its text, its time, a `transform` and a `style`. Opacity belongs to the Transform only, so it can be keyed. The Transform's centre stays on the frame, while the picture may go past its edges.

## Considered options

- **Keep Text Layers as vector ASS events.**
  - Text stays sharp at any scale, with no cache.
  - Every eased span would have to become many linear `\t` and `\move` steps, with `\org` on each line and the plate.
  - Emoji, as separate pictures, would need the same motion worked out a second time, and the two would have to stay in step.
- **A text engine of our own** (Pillow or HarfBuzz with FreeType, which draws colour glyphs). This is closest to Concat. But Text Layers would be set by a different engine from the hook and the captions, and the bundled fonts would be shaped two ways.
- **SVG drawn by the browser in the preview** (as today). It is instant, but stroke joins, shadow blur, tracking and fallback would each differ a little from libass. With the PNG, the preview and the Clip are the same pixels.
- **SVG while editing, the PNG once ready.** The most responsive option, but the drawing would visibly swap under the owner.
- **The system's colour emoji font, as Concat does.** On a Mac that means Apple Color Emoji, whose licence is unclear for published video, and Linux would draw other emoji. Noto's images (Apache-2.0) look the same everywhere, in the preview and in the render.
- **Rasterising at 1× or 2×.** Simpler, but text scaled past that blurs.

## Consequences

- **Overturns the Out of Scope line on rotation and keyframes** in `.scratch/advanced-edit/spec.md`, for Text Layers.
- **Stored Text Layers are migrated.** Their flat look fields move into `style`, and `x`/`y` into `transform`. The size the planner used to shrink a too-wide layer to is computed once and stored, with a wrap width wide enough for its longest line, so that a stored Clip renders as it did.
- **Text is no longer shrunk to fit.** As in Concat, the box grows to hold its words, and the fixed height is a least height.
- **Text Layers leave the ASS script.** The hook, the Kicker, the captions and the Watermark stay ASS events and keep stripping emoji. Captions now strip them too, since libass would draw them as nothing.
- **Changing a Text Layer's text or look costs a rasterisation** (one short ffmpeg run) before the preview shows it. Moving, turning, scaling and fading it costs nothing.
- **The renderer builds one fonts directory per render** from the bundled and the imported faces it needs, because the `ass` filter takes one `fontsdir`.
- **The agent sees the plan's lines and bounds, and the picture's URL,** in a dry run.
