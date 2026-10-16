# 04: Keyed media Segments

**Parent spec:** `spec.md` (user stories 5, 15, 44; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Editor actions").

**What to build:** a media Segment's Framing can move. Its position, scale, rotation and opacity can be keyed, and so can its sound's volume. A push into a detail of a B-roll clip, or a zoom out from cover, works in the preview and the Clip. The Segment's Background shows wherever the moving picture leaves the frame uncovered. Transitions see the moving picture.

- **Model.** `keys` on the Segment, for a media Segment only: the picture properties and `volume`. Keyframes on a Source Segment are refused.
- **Planner.** A keyed media Segment's picture carries its motion in Timeline time. Its Background is drawn unless the picture covers the frame at every frame, sampled at the Clip's frame rate.
- **Renderer.** The keyed picture comes from the frame process and its video decode (from 02). It is laid over the Background inside its Segment's chain, before Transitions. A keyed volume uses 03's expression in the Segment's own audio chain.
- **Editor.** The Segment's inspector shows its Transform and Volume fields' Keyframe diamonds (from 06, when 06 is in: otherwise 06 adds them). Trimming a media Segment's ends re-anchors its Keyframes (the re-anchoring from 07, when 07 is in: otherwise 07 wires it).
- **MCP.** A change of a media Segment's range that strands a Keyframe is refused, naming it.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] a media Segment zooming out from cover to scale 1 gets its Background;
  - [ ] one that stays covered at every frame doesn't.
- [ ] Seam A, real ffmpeg:
  - [ ] a media Segment keyed in `scale` has its picture at the sampled size at two times;
  - [ ] a zoom out shows the blurred Background at its edges;
  - [ ] a fade Transition into a keyed Segment shows the moving picture mid-transition.
- [ ] Seam A, HTTP: Keyframes on a Source Segment are refused; an MCP range change that strands a Keyframe is refused.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
