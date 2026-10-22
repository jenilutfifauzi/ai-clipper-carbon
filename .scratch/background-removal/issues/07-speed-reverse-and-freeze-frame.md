# 07: Speed, Reverse and Freeze frame keep the Matte

**Parent spec:** `../spec.md` ("Matte store and runner", "Renderer", "Preview"); ADR 0015, 0009.

**What to build:** a cut-out Segment or Overlay at a Speed, in Reverse, or held as a Freeze frame keeps its Matte on the same frames, in the render and in the preview.

- **Speed:** the Matte's frames are picked by the same Source time, through the same `setpts` in the render and the same mapping in the preview.
- **Reverse:** the Matte gets a Retimed copy over the reversed range, made by 0009's mechanism in the two sizes, and found wherever a wider copy serves.
- **Freeze frame:** one Matte frame is held for the hold.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Seam A (fake matter, a moving disc): at 2× and 0.5×, in Reverse and on a Freeze frame, the kept area sits on the disc in the rendered frames.
- [ ] A Reverse switch makes the Matte's reversed copy, and the render waits for it as it waits for pieces.
- [ ] vitest: the mapping with Speed, Reverse and hold matches the shared fixture.
- [ ] The preview follows the picture at those rates and in Reverse (walkthrough).
