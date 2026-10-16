# 0007: One Transform for every picture, and a Manual Layout

Status: accepted
Date: 2026-10-16

## Context

The `transform-crop` feature (`.scratch/transform-crop/spec.md`) brings Concat's `SetClipTransform` and `Crop` to the Advanced Edit: scale, position, non-uniform stretch, rotation, flips, opacity and per-edge crop, with grips on the stage.

Today three kinds of picture are placed in three different ways:
- **An Overlay** has a centre `x`/`y` and a width `size`, in output pixels, and an `opacity`. The planner clamps it inside the frame.
- **A media Segment** has only `fit`: filled (a centred 9:16 crop) or fitted over its blur.
- **A Source Segment** is framed by the planner per Scene, by its Layout (Track, Split, Blur, or Auto), with Layout Overrides keyed by Source time. Track follows faces with a moving crop.

Two Out of Scope lines stand in the way:
- **Rotation**: `.scratch/advanced-edit/spec.md` ("Keyframes, masks, rotation, …") and `.scratch/preview-direct-edit/spec.md`.
- **Manual crop positioning**: `.scratch/clip-editor/spec.md` ("moving a Track crop or Split panel by hand") and `.scratch/ai-clipper-v1/spec.md`.

## Decision

- **One `Transform` value object** places every picture: Overlays, media Segments, and the Source in a Manual Scene.
  - `x`, `y`: the centre, in output pixels. It is clamped to the frame, so a grip can always be reached, but the picture may go past the frame's edges.
  - `scale`, 0.05–8: a multiplier over the picture's fitted size, the largest that fits in 1080×1920 keeping its aspect. 1 fits the frame.
  - `stretch_x`, `stretch_y`, 0.1–10: multipliers on the fitted width and height beyond `scale`. 1 keeps the aspect.
  - `rotation`: in degrees, clockwise about the centre.
  - `flip_h`, `flip_v`, and `opacity` (0..1).
- **One `Crop` value object**: what is cut off each edge, as fractions 0..0.9 of the picture's width and height, with at least a tenth kept. The crop is taken first, so the fitted size is that of the cropped picture (as in Concat).
- **A Framing** is a Transform, a Crop and a **Background** (the Segment's own picture blurred, or a colour). The Background is what shows where the picture doesn't cover the frame.
  - A media Segment has a Framing. It replaces `fit`: Fill becomes the scale that covers the frame, and Blur becomes scale 1 over a blurred Background.
  - An Overlay has a Transform and a Crop, plus corners (a radius as a fraction of the shorter side), a border and a shadow (both in output pixels). It has no Background.
- **A new Layout, Manual,** frames the Source by hand with a Framing.
  - A Layout Override can be Manual and then carries its Framing. The Candidate's own Layout can be Manual, with one Framing for every Scene that has no override.
  - A Manual Scene is static: face tracking is not run for it, and re-running the analysis does not move it. Its override is keyed by Source time like any other, so a piece of the Source shown twice is framed alike (ADR 0002). Auto never chooses Manual.
  - Manual shows one picture. Split stays automatic.
  - A Scene switched to Manual starts from what it showed: every planned Scene carries the Framing equal to its first frame. The editor copies that Framing, so it never computes framing itself (ADR 0001).
- **One drawing order for every picture,** in the renderer and in the preview:
  1. crop;
  2. scale to the fitted size times `scale` and `stretch`;
  3. flip;
  4. corners and border;
  5. rotate, with a transparent fill;
  6. shadow;
  7. opacity;
  8. lay it over at its centre.

  The crop, corners and border turn with the picture, and the shadow falls in the frame's own directions.
- **The Render Plan carries each picture's resolved geometry:**
  - the crop in the picture's pixels;
  - its drawn width and height;
  - its centre, rotation and flips;
  - its opacity, radius, border and shadow.

  The preview draws exactly that with CSS transforms. Media Segments are drawn from the plan too, no longer with `object-cover`.
- **Keyframes stay out.** A Transform is constant for its item's whole length. (Amended 2026-10-16: position, scale, rotation and opacity can have Keyframes. See docs/adr/0008-keyframes-for-pictures-and-sound.md.)

## Considered options

- **Separate fields per item** (rotation, flips and a crop on each of Overlay and Segment). This is a smaller diff, but it means two copies of the rules and of their MCP shape. Templates and keyframes later want one shape.
- **Concat's fractional offsets** for position. The Text Layers, hook and Watermark are placed in output pixels, and the smart guides compare all of them.
- **Keeping the Overlay's width in pixels.** A media Segment then has no meaning for "1 = fits". The agent also could not say "half size" without knowing the item's size.
- **A Transform per Source Segment** instead of a Manual Layout. One framing for a whole Segment ignores its cuts. A Segment shown twice would also be framed in two places.
- **A nudge on top of face tracking** (offset and zoom relative to the tracked camera). The result moves with the faces, which is hard to predict, and it can't rotate or show the Background.
- **Crop after rotation, in the frame's axes.** Concat crops the source, and a crop that turns with its picture is what a crop mode on the stage shows.

## Consequences

- **Overturns two Out of Scope lines:** rotation (Advanced Edit, preview-direct-edit) and manual crop positioning (clip editor, v1). Keyframes, masks, Split panels framed by hand, and face tracking on uploaded videos stay out.
- **Stored Candidates migrate when a Job is read.**
  - An Overlay's `size` becomes `scale` = `size` / the fitted width of its media item. The item's size is known from the Media Library, and an item in use can't be deleted.
  - A media Segment's `fit` becomes its Framing.
  - The API and MCP accept only the new shape.
- **The renderer gains `rotate`, `hflip`, `vflip`,** an alpha mask for corners and a shadow branch. A picture that is not rotated, cropped or decorated keeps a graph close to today's.
- **MCP gets every field through the dataclasses.** `merge_candidate_items` merges a Transform, Crop or Framing field by field, and the dry run lists Overlays and Scene framings.
- **The clip editor can choose Manual and pan and zoom it.** Everything else about Transforms is in the Advanced Edit.
