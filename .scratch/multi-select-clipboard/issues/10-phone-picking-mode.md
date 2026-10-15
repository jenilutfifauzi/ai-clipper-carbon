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

**Status:** done

- [x] In the browser at phone width with touch emulation, and on a real phone if one is at hand:
  - [x] picking mode toggles items by tap;
  - [x] the bar's count is right;
  - [x] Delete, Duplicate, Copy and Paste act on the Pick;
  - [x] Done leaves the mode;
  - [ ] a long press still drags (unchanged in code; left for a real phone in the walkthrough, 11).
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** Picking mode is the toolbar's Pick, and lives only while the layout is a phone's; Done leaves it and empties the Pick. Taps on the Timeline, the stage and the Overlays toggle while it is on. Found and fixed on the way: a long press picks the item it lifts, and its release then picked it again, which in picking mode took it back out; a lifted item's release no longer picks. Checked at 390 px with touch emulation (quick taps sent as touch pointer events, as the automation's own touches last longer than a long press): three taps pick three items, a fourth takes one out, Copy, Paste with nothing picked, Duplicate, Delete and Done all act as the spec says.
