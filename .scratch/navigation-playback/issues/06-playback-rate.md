# 06: Playback rate

**Parent spec:** `spec.md` in this feature folder (user stories 49–54; Implementation Decisions "`Playback` with two decks: Rate").

**What to build:** a menu in the Advanced Edit's player bar plays the preview at 0.5×, 1×, 1.5× or 2×.

- **Everything follows the rate.** It is set on `Playback`, which applies it to:
  - both decks;
  - every element that follows it: media Segments, Overlays and Music Clips;
  - the clock of a media Segment.
- **The browser keeps the pitch.**
- **The bar shows the rate** whenever it isn't 1×.
- **It is kept in the editor only.** It starts at 1× each time the editor opens, and it is not saved. It is not a Clip's speed.
- **On a phone,** the rate goes in the Playback sheet of 10. This ticket adds it to the desktop player bar only.

**Blocked by:** 05 (two decks).

**Status:** ready-for-agent

- [ ] Seam F (vitest):
  - [ ] 2× sets `playbackRate` on both decks, and a swap keeps it;
  - [ ] a media Segment's clock runs twice as fast.
- [ ] At 2× and at 0.5×, a Clip with Music, an Overlay video and a media Segment stays in sync, with speech intelligible.
- [ ] Reopening the editor starts at 1×.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
