# 0014: Video Effects are a stack after the Grade, imitated in SVG

Status: accepted
Date: 2026-10-21

Builds on 0007 (one Transform), 0008 (Keyframes), 0012 (no WebGL), 0013 (the Grade) and 0017 (the effects catalogue).

## Context

The `video-effects` feature (roadmap #12, `.scratch/advanced-edit-v2/roadmap.md`) brings Concat's per-clip effect chain to the Advanced Edit.
- **Concat has 21 effect packages.** Each is a manifest plus a WGSL shader. Seven are colour (exposure, contrast, saturation, white balance, wheels, curves and the like), which our Grade already covers or 0013 leaves for later.
- **Concat runs the chain after Adjust,** after the picture is fitted to the frame and before its transform, cutout and blend.
- **None of Concat's chain knobs can be keyed in its UI.** Two effects read time: film grain reseeds every frame, and bloom pulse throbs with `sin(time·speed)`.
- **Each Concat clip has a blend mode:** normal, multiply, screen, add, lighten or darken.
- **Favourites are a global list** in Concat's app preferences, with a star on each library tile.
- **Our preview is a DOM composite,** and 0012 and 0013 refused a WebGL canvas. 0013 says effects must fold into SVG-imitable operations or be imitated by hand. 0017 made the catalogue a Python registry and said video effects would join it.

`.scratch/advanced-edit/spec.md` lists "filters and effects" as Out of Scope. 0013 overturned filters, and 0017 overturned effects for sound only.

## Decision

- **A Video Effect stack on Segments, Overlays and Adjustment Layers.**
  - Each entry is `{id, params, enabled}`, as an Audio Effect's is. Order is visible, and the owner can reorder the stack.
  - An effect appears at most once in a stack.
  - Parameters are constant over the item and never keyed. The shape leaves room for 0008's `keys` later.
  - There is no Candidate-wide stack: an Adjustment Layer over the whole Clip does that.
- **Eleven effects, in five categories:**

  | Category | Effect | Render | Preview |
  |---|---|---|---|
  | Blur | Gaussian blur | `gblur` | `feGaussianBlur` |
  | Blur | Motion blur | `dblur` | near |
  | Distort | Pixelate | `pixelize` | near |
  | Distort | Chromatic aberration | channels scaled about the centre | near |
  | Distort | Fisheye | `lenscorrection` | `feDisplacementMap` |
  | Light | Glow | blur at ¼ resolution + `blend=screen` | blur + `feBlend` |
  | Light | Bloom pulse | highlights, blur at ¼ resolution + screen, strength by `sin` | the same, updated per frame |
  | Stylize | Posterize | `lutrgb` table | `feComponentTransfer discrete` |
  | Stylize | Film grain | `noise`, a new pattern every frame | `feTurbulence`, reseeded every frame |
  | Cutout | Chroma key | `lut2` tables of BT.709 Cb and Cr: the alpha, and the spill taken out of R, G, B | near |
  | Cutout | Luma key | a `lut2` table of BT.709 luma and the alpha | luminance to alpha + a table |

  - The keys measure the display's RGB (as BT.709 Y, Cb, Cr at full range), as Concat's do and as the eyedropper picks. ffmpeg's `chromakey` and `lumakey` read the frame's own YUV, whose matrix and range differ between an image and a video; `despill` knows only green and blue. (Amended by the Chroma key ticket, 06.)
  - Concat's colour effects are dropped; the Grade has them.
  - Sharpen and Vignette are dropped because Adjust has them.
  - Halftone (only `geq`, far too slow, no SVG) and Zoom blur (no radial blur in ffmpeg, no SVG) are dropped.
- **Cutout effects are for Overlays only.** A key on a Segment or an Adjustment Layer is refused on save.
- **The catalogue is 0017's Python registry,** under a video kind. Each effect has an id, a name, a category, an order, its settings (one marked as the intensity) and a function that builds its ffmpeg chain. A setting may be a colour (the chroma key's).
  - A built-in effect never changes how it looks; a revision gets a new id.
  - An unknown id or setting, or a value out of range, is refused on save.
  - The editor reads the catalogue from the server, and the agent through `list_assets`.
- **Where the stack sits:** after the item's Grade.
  - **A Segment's Effects** apply to its whole frame, before the joins, as its Grade does. A Transition crossfades pictures that already carry their effects.
  - **An Overlay's Effects** apply after its crop, scale, flip and Grade, and before its corners, border, rotation, shadow, opacity and Blend Mode.
  - **An Adjustment Layer's Effects** apply after its Grade, over the Main Track and the Overlays. They are mixed back with the Grade by its strength times its fades.
- **Sizes are output pixels at the picture's fitted size** (scale 1), as in Concat, where effects come before the transform. The planner multiplies them by the item's scale, so a bigger picture gets a bigger blur. A keyed picture's frame process applies its Effects before the animated scale.
- **Time-dependent effects count from the item's start,** as a Keyframe's `at` does. Moving an item takes its pulse with it. A still image with Film grain or Bloom pulse is read as a looping video stream.
- **The preview imitates every effect in SVG,** on the elements that already carry the Grade's filter (0013). Bloom pulse and Film grain are updated on `Playback`'s frame, outside React's render. The imitations marked "near" are only near; **Compare render** shows the exact pixels.
- **An Overlay has a Blend Mode** (normal, multiply, screen, add, lighten, darken). The render blends the full frame with `blend`, and the Overlay's alpha masks the result back over what is under it. The preview uses CSS `mix-blend-mode`, which matches.
- **Glow and Bloom pulse blur at quarter resolution.** The spec measures each effect's render time on a 1080×1920 test clip and records it here; the UI shows no warning.
- **Favourites are one global list of catalogue ids** on the server, for Video and Audio Effects. They are shown as a star on each library tile and a Starred filter. They are not part of any Candidate and not in MCP.

## Considered options

- **A WebGL canvas,** Concat's way and the seed prompt's. Refused for 0012's reason: it would be a second compositor that must match the DOM.
- **An Effected copy of the picture,** as 0017 does for sound. Its pixels would be exact. But every slider would wait seconds, cards couldn't be tried on hover, and the Source decks (0006) would be broken up per Segment.
- **TOML manifests with a chain template** (Concat's, and the seed prompt's). Refused for 0017's reason: we would need an expression evaluator and a filter allow-list.
- **Effects before the Grade.** Keys and blurs would work on the original colours. But Concat grades first, and grain and glow look right over the graded picture. The chroma key's eyedropper samples the graded picture, so it matches the render.
- **Sizes in drawn pixels, or as a fraction of the picture.** Drawn pixels would make a keyed picture recompute its effects every frame. Fractions don't read like Concat's numbers.
- **Keys on Segments** (the Background showing through). This overlaps `background-removal` (#13).
- **Duplicates in a stack.** Concat greys out an effect that is already applied.
- **Timeline time for pulses** (Concat's `frame.time`). A moved item would throb out of step with where it was.

## Consequences

- **Overturns "effects stay out" in `.scratch/advanced-edit/spec.md` for pictures.** Blend modes for Text Layers and Shapes, keyed effect parameters, Halftone, Zoom blur and Concat's colour effects stay out.
- **Every stored Candidate plans, renders and previews as before.** An absent stack is empty, and an absent Blend Mode is Normal. A Segment with Effects is no longer "plain" for the concat fast path.
- **The Render Plan carries each item's enabled Effects with their sizes already scaled, and each Overlay's Blend Mode.** The dry run shows them.
- **The SVG imitations exist only in the frontend.** Unlike the Grade's fold, there is no shared fixture of exact values. Each effect's Seam A test renders a frame and checks it differs from its input as expected.
- **Keyed pictures take the frame process route (0008).** Their Effects run in the decoder's `-vf` after the Grade; a still is looped when an effect changes with time.
- **A Blend Mode other than Normal costs one full-frame `blend` per Overlay** over its span.
- **The Asset Panel gains an Effects tab.** Favourites gain a small global store and endpoint.
