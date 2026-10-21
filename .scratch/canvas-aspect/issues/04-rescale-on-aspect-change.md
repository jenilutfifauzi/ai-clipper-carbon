# 04: Rescale a Candidate's positions when its aspect changes

**Parent spec:** `../spec.md` (Implementation Decisions "Rescale on an aspect change"); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md.

**What to build:** changing a Candidate's aspect, from the API or `edit_candidate`, keeps its edit looking the same on the new shape.

A pure function takes the draft, the old and new aspects, and the pictures' sizes that fitting needs. It returns the rescaled draft:
- **Centres** of every Candidate-owned Transform, position Keyframe and Cue Edit keep their place as a fraction of the Canvas.
- **Framings** (media Segments, the Source in Manual, Layout Overrides) keep their scale relative to the cover scale. A filled Segment still fills the frame, and 1.5× cover stays 1.5× cover.
- **Overlays, Text Layers and Shapes** keep their drawn size in pixels: new scale = old scale × old fitted size ÷ new fitted size.
- **Scale Keyframes** follow their item's rule.
- **Every result** is clamped to the new Canvas.

The backend runs it when an edit changes `aspect`. Positions sent in the same edit are taken as already on the new Canvas and are left as sent.

The rescaled state is the new Revision, and restoring the earlier Revision undoes it.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Seam B tests:
  - (270, 480) on 9:16 lands at (480, 270) on 16:9;
  - a filled media Segment stays at the cover scale, and a 1.5× cover Framing stays 1.5× cover;
  - an Overlay's and a Text Layer's drawn size is unchanged;
  - position and scale Keyframes follow;
  - Cue Edits move;
  - values are clamped;
  - positions sent with the aspect are left as sent;
  - 9:16 to 16:9 and back is within rounding for interior items.
- [ ] API/MCP test: `edit_candidate` with only `aspect` returns rescaled positions, and `dry_run` shows them without saving.
- [ ] Restoring the earlier Revision gives back the old aspect and positions.
