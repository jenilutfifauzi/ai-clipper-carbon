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

**Status:** ready-for-agent

- [ ] Seam D: the rubber band picks by overlap. It spans rows, skips the hook, captions and joins, and adds with Shift.
- [ ] In the browser:
  - [ ] the box draws and picks on release;
  - [ ] a click on empty lane space seeks and empties the Pick;
  - [ ] the ruler still scrubs;
  - [ ] a phone swipe still scrolls.
- [ ] Typecheck, test, build.
