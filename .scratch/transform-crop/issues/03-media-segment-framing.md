# 03: A media Segment's Framing and Background

**Parent spec:** `spec.md` (user stories 22–25, 53; Implementation Decisions "Model", "Migration", "Planner", "Renderer", "Preview"); ADR 0007.

**What to build:** a media Segment is placed by a `Framing` (a Transform, a Crop and a Background), which replaces `fit`. It is drawn from the plan in the preview, no longer with `object-cover`.

- **Model.** Add `Background` (`blur`, or `colour` with `#rrggbb`) and `Framing`. `Segment.fit` goes, and `Segment.framing` comes in: required on a media Segment, refused on a Source Segment.
- **Migration.** Fill becomes the cover scale, and Blur becomes scale 1. Both get a blurred Background.
- **Planner.** A media Segment's Scene is a Background panel (today's blurred cover, or a colour) plus a `Picture`.
- **Renderer.** Draw the Background (today's blur panel, or a `color` source), then `_picture` over it.
- **Preview.** `PreviewSegments` draws the plan's Background panel and `PicturePanel`.
- **Inspector.** The Transform section on a picked media Segment, plus Background (Blur or a colour). Fill is the default for a newly inserted media Segment, as today.
- **Transitions** between media Segments render and preview as before.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] the Framing is required or refused by Segment kind;
  - [ ] migration of fill and fit, with the same boxes as before within a pixel.
- [ ] Seam A:
  - [ ] scale 0.5 over a colour shows the colour at the frame's corners;
  - [ ] an old Job with filled and fitted Segments renders the same plan boxes;
  - [ ] a Transition between two media Segments still renders.
- [ ] Walkthrough: a sideways phone video rotated 90° and filled matches the render.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
