# 03: The preview draws the cut

**Parent spec:** `../spec.md` ("Preview"); ADR 0015, 0006 (two decks), 0009 (the per-Segment mapping).

**What to build:** in the Advanced Edit's preview, a cut-out Source Segment plays with only the speaker over its Background, in step with the picture, while playing, paused and scrubbing. Until a piece of its Matte is ready, that stretch shows the picture whole. The Grade and Video Effects look as they did on the whole picture.

**The mapping:** a pure TypeScript function takes the deck's time and gives the Matte piece and the frame within it, following the per-Segment mapping. It is pinned by a fixture shared with the Python side.

**The compositor:**
- A cut-out picture's video element is replaced by a canvas. The Matte pieces play on hidden videos following the picture's deck.
- On each `requestVideoFrameCallback`, the canvas draws the picture, turns the Matte's luminance into alpha, blurs it by the planned feather, and masks the picture with it.
- The Grade's and effects' SVG filters stay on the element. The Background (the picture blurred) is drawn under it.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] vitest: the deck time → piece and frame mapping matches the shared fixture.
- [ ] Across a join, a Transition and a seek, the Matte stays on the picture's frame (walkthrough, desktop and phone).
- [ ] A piece that isn't ready shows the picture whole, and the cut appears when it lands.
- [ ] A Segment far from the playhead holds no Matte videos.
- [ ] `npm run typecheck && npm run build` pass.
