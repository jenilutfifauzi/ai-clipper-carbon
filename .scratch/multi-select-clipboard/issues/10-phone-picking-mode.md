# 10: Picking mode on a phone

**Parent spec:** `spec.md` in this feature folder (user stories 53–58).

**What to build:** on a phone, the owner picks several items and acts on them without a keyboard.

- **A Pick button in the phone toolbar** starts picking mode. In picking mode, a tap on a Segment, Text Layer, Music Clip or Overlay adds it to the Pick or removes it.
- **The bottom bar** shows "N picked" with:
  - Delete, Duplicate and Copy;
  - Paste, enabled while the Clipboard holds something, even with nothing picked;
  - Done.
- **Done** leaves picking mode, and a tap picks one item again.
- **A long press** still lifts an item to drag it, as today.
- **No rubber band** on touch.

**Blocked by:** 03, 08.

**Status:** ready-for-agent

- [ ] In the browser at phone width with touch emulation, and on a real phone if one is at hand:
  - [ ] picking mode toggles items by tap;
  - [ ] the bar's count is right;
  - [ ] Delete, Duplicate, Copy and Paste act on the Pick;
  - [ ] Done leaves the mode;
  - [ ] a long press still drags.
- [ ] Typecheck, test, build.
