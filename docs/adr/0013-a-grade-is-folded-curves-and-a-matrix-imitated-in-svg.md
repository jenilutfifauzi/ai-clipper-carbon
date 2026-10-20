# 0013: A Grade is folded into curves and a matrix, imitated in SVG

Status: accepted
Date: 2026-10-20

Builds on 0001 (the backend plans, the preview draws), 0006 (the decks) and 0012 (looks imitated in CSS, not WebGL).

## Context

The `color-adjust` feature (roadmap #11, `.scratch/advanced-edit-v2/roadmap.md`) brings colour at parity with Concat: Adjust dials, Looks in categories, `.cube` import, and Adjustment Layers. It overturns "filters" in the Out of Scope list of `.scratch/advanced-edit/spec.md`. Effects stay out of scope; they are `video-effects` (#12), which builds on this.

- **Concat grades on the GPU.** Adjust, its 57 filters and imported LUTs are WGSL shaders, and the preview and the export share them. Every filter is mixed over the untouched picture by an intensity. Imported `.cube` files become filter packages, not media.
- **Our preview is a DOM composite** of `<video>` and `<img>` elements with CSS (ADR 0006, 0007). ADR 0012 refused a WebGL canvas for Transitions: it would need a second compositor for panels, crops, the blurred Background, Transforms and Keyframes, matching the DOM exactly.
- **CSS filters are too coarse** for colour: `saturate()`, `contrast()` and `sepia()` are not what ffmpeg's `eq`, `colortemperature` or `colorbalance` do.
- **SVG filters can be exact** for two kinds of operation: a per-channel table (`feComponentTransfer type="table"`) and a 4×5 matrix (`feColorMatrix`). ffmpeg has the same two, as `lutrgb`/`curves` and `colorchannelmixer`.
- **A 3D LUT has no SVG equivalent.**

## Decision

- **A Grade is an Adjust, then a Look at an intensity.** It is constant over its item, never keyed. A Segment, an Overlay and the Candidate may each have one. An Adjustment Layer carries one over a span of Timeline time, with a strength and fades.
- **The backend folds a Grade into a few operations, in this order:**
  1. One table per channel: exposure, brightness, contrast, highlights, shadows, whites, blacks and fade.
  2. One colour matrix: temperature, tint and saturation.
  3. A Look's colour table, for an Imported Look.
  4. `unsharp` for sharpen and `vignette`.

  The fold is written twice, once in the backend and once in the frontend, and kept identical by one shared JSON fixture of Grades and their tables and matrix, which both test suites read. The Render Plan carries the Grades as given, not folded. This lets a dragged dial, the Filters tab's cards and a hovered Look show at once, with no wait for a Preview Plan:
  - **Render:** `lutrgb` (or `curves`), `colorchannelmixer`, `lut3d`, `unsharp` and `vignette`.
  - **Preview:** an SVG filter of `feComponentTransfer` tables and an `feColorMatrix`, on the DOM elements the preview already has.

  The tables and the matrix match the render closely. Sharpen and vignette are only near.
- **Where a Grade applies:**
  - **A Segment's Grade** applies to its whole frame (panels, picture and Background, a colour Background too), before the joins. So a Transition crossfades graded pictures.
  - **The Candidate's Grade** applies over the joined Main Track, never over the Overlays.
  - **An Overlay's Grade** applies to its picture after it is scaled, before its corners, border and shadow.
  - **Adjustment Layers** apply over the Main Track and the Overlays, under the Watermark, captions, Shapes, Text Layers and hook, one after another. Each is mixed back by its strength times its fades.
- **Looks are data, never shaders.** A built-in Look is a set of Adjust values, written for this app (about 20, in six categories). It never changes once shipped; a new version of it gets a new id. An imported `.cube` becomes a Look in the Imported category: neutral Adjust and the table, kept in a global store as Faces are. Each import is a new Look, never a replacement. A Look can't be deleted while anything uses it. Only 3D tables are accepted, of size 65 at most.
- **The preview approximates an Imported Look.** The backend fits per-channel tables and a matrix to the `.cube` file once, at import, and lists them with the Look.
- **"Compare render" shows the exact pixels.** While the preview is paused, the server renders one frame of the Candidate (or the unsaved draft) at the playhead through the render path. The preview shows it under a split line. The frame is not kept as an Export file.

## Considered options

- **A WebGL canvas with the same maths.** This would be the most faithful option. It was refused for the reason ADR 0012 gives: a second compositor that must match the DOM.
- **Native filters per dial** (`eq`, `colortemperature`, `colorbalance`, `curves`). These are easier to read in the graph. But their maths is spread across filters that SVG can't reproduce, so the preview would drift.
- **Folding only in the backend, carried in the Render Plan.** This would keep one source of truth. But every dial drag, card and hovered Look would wait for a Preview Plan. The Keyframe sampler (ADR 0008) and the Speed mapping are already written twice and pinned by a shared fixture.
- **One generated `lut3d` per Grade.** This would mean one filter, but a temporary file per item, and the preview would still need an approximation.
- **Looks as free ffmpeg filter strings.** These are more expressive, but each one would need a hand-written SVG imitation.
- **LUTs as a Media Library kind.** Uploads there are probed and normalized by ffmpeg, and a LUT is a colour rather than a picture or sound. As a Look it needs no second slot in the Grade.
- **Keyframed dials, as Concat has.** This would need `sendcmd` per dial and interpolated SVG tables. A split gives a change of grade, and an Adjustment Layer's fades give a gradual one.

## Consequences

- The Render Plan grows a Grade per Segment, per Overlay, for the Candidate and per Adjustment Layer. The MCP dry run shows them too.
- The fold exists twice, which is the price of instant dials. The shared fixture is the guard: a change to the maths on one side fails the other side's tests.
- Keyed pictures take a different route, through Python frame processes. Their Grade has to be applied there too: in the decoder's `-vf` for a video, and once to an image before it is drawn.
- Imported Looks render exactly but preview only near; "Compare render" is the way to check them.
- Wheels and curves can be added later as more table and matrix terms, with no change to the preview's approach.
- `video-effects` (#12) builds on this. Its effects, too, must either fold into the same SVG-imitable operations or be imitated by hand, as Transitions are.
