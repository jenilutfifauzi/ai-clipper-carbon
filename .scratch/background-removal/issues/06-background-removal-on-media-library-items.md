# 06: Background removal on Media Library items

**Parent spec:** `../spec.md` ("Model", "Matte store and runner", "Renderer", "Preview"); ADR 0015, 0014.

**What to build:** the owner cuts out a person in a media Segment, or in an Overlay video or image. A media Segment shows its Framing's Background where the person isn't. An Overlay shows what is under it. On an Overlay, Background removal may join a Chroma or Luma key, and their alphas multiply.

**The Matte:** pieces are kept beside the media item on its own timeline, as for the Source. A still image gets one PNG, made from a single run of the matter.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Seam B: Background removal reaches OverlayEvents and media SegmentPlans with the feather scaled.
- [ ] Seam A (fake matter): a media Segment shows its Framing Background outside the kept area; an Overlay video and an image Overlay show the frame beneath; with Luma key the alphas multiply; an Overlay with Keyframes renders like an unkeyed one at the same frame.
- [ ] Two Overlays of the same item over the same time share pieces.
- [ ] The preview's compositor draws Overlays and media Segments, under their Corners, Border, Shadow and Blend Mode as the render orders them.
- [ ] The Inspector section appears for Overlays and media Segments.
