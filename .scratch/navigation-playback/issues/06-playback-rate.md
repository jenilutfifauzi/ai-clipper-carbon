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

**Status:** done

- [x] Seam F (vitest):
  - [x] 2× sets `playbackRate` on both decks, and a swap keeps it;
  - [x] a media Segment's clock runs twice as fast.
- [ ] At 2× and at 0.5×, a Clip with Music, an Overlay video and a media Segment stays in sync, with speech intelligible.
- [ ] Reopening the editor starts at 1×.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. `Playback` (`playback.ts`) has a `rate`, 1 to begin with, set with `setRate(rate)`; `RATES` lists the four. It sets `playbackRate` on both decks' videos when the rate changes, when a deck is registered, when a video loads (a load sets it back to the default) and whenever a deck is played, so a swap keeps it. A media Segment's clock runs at the rate, and is re-based when the rate changes, so that its time doesn't jump. `follow` sets each follower's `playbackRate` to the playback's, so media Segments, Overlays and Music Clips follow it; its drift check is unchanged. The Transition ghost takes the main playback's rate, and its follower its master's. Nothing sets `preservesPitch`, so the browser keeps the pitch. The menu is a native select at the end of the Advanced Edit's compact transport (`ClipPreview`'s new `rates`, passed on a desktop only), showing the rate, in the accent whenever it isn't 1×. The clip editor and the phone get no menu (the phone's is ticket 10). The rate lives on the Advanced Edit's `Playback`, made anew each time the editor opens, so it starts at 1× and is never saved. Tests in `playback.test.ts`: 2× on both decks and kept through the swap, a deck registered later, a media Segment's clock and video at 2×, and a rate change mid-clock. Not tried in the browser: a Clip with Music, an Overlay video and a media Segment in sync at 2× and 0.5×, speech intelligible; reopening at 1×. Worth watching: with the menu focused, Space opens it (a select is a field for the keymap, as the scrubber is), so after picking a rate with the mouse Space doesn't play until the focus leaves it.

**2026-10-16: Review fixes.** The rate menu no longer counts as a field for the keymap (it carries `data-shortcuts`), and it lets go of the focus once a rate is picked, so Space plays straight after.
