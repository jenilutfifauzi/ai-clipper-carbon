# 04: Rubber band on empty lane space

**Parent spec:** `spec.md` in this feature folder (user stories 4–9).

**What to build:** on a desktop, the owner drags on empty lane space to pick every item a box touches.

- **A drag on empty lane space** (mouse, past the tap slop) draws a box. On release, it picks every Segment, Text Layer, Music Clip and Overlay that overlaps it, across the rows it spans. It never picks the hook, the captions or joins.
- **Shift** while dragging adds to the Pick instead of replacing it.
- **A press on empty lane space without movement** moves the playhead and empties the Pick.
- **Scrubbing** happens on the ruler only.
- **Touch is unchanged:** a swipe on the tracks scrolls, and there is no rubber band.
- **The rubber band's rule** (which items a box over these rows and times touches) is a small pure function tested in Seam D.

**Blocked by:** 02.

**Status:** done

- [x] Seam D: the rubber band picks by overlap. It spans rows, skips the hook, captions and joins, and adds with Shift.
- [x] In the browser:
  - [x] the box draws and picks on release;
  - [x] a click on empty lane space seeks and empties the Pick;
  - [x] the ruler still scrubs;
  - [x] a phone swipe still scrolls (touch emulation, see 11).
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** The Timeline reads each pickable item's drawn area from its `data-pick` key on release and hands them to the Pick's `bandPick` rule. Checked in the browser with a mouse: the band draws while dragging from empty text-lane space and picks the Text Layer and the Segment it crosses; a click there seeks and empties the Pick. The ruler and touch paths are unchanged in code; a phone swipe is left for the walkthrough (11).
