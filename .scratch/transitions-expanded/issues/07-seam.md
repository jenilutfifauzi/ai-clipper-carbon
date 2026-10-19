# 07: The Seam: a Transition's band and grips on the Timeline

**Parent spec:** `../spec.md` (Solution "Seams on the Timeline", "Advanced Edit" Seam); GLOSSARY **Seam**.

**What to build:** on the Video Track, a join with a Transition is drawn as a **Seam**: a band from its event's start to its end (the real overlap), with a grip at each edge.
- **Dragging either grip** changes the Transition's length from both edges at once: twice the pointer's travel in Timeline seconds.
  - It is clamped to 0.1–3 s and to half the shorter neighbour, and shown live with a tooltip of the length ("0.50 s").
  - It is committed on release as one step of undo.
  - There is no snapping.
- **Clicking the band** picks the join. The band accepts card drops, as the diamond does.
- **A join without a Transition** stays a diamond.
- **Grips have hit areas** big enough for a finger on a phone.
- **On a locked Video Track** the band is drawn without grips.

As ADR 0004 says, changing a Transition's length moves no layers.

**Blocked by:** 02.

**Status:** done

- [x] A join with a Transition shows a band spanning its overlap. One without shows the diamond.
- [x] Dragging a grip outward by x Timeline seconds lengthens the Transition by 2x, up to 3 s and half the shorter Segment (vitest on the drag rule).
- [x] The tooltip shows the length during the drag.
- [x] One drag is one undo step.
- [x] Clicking the band picks the join and opens it in the inspector.
- [x] A locked Video Track shows no grips and refuses the drag.

## Comments

**2026-10-19, agent:** Built.
- **Drag rule** (`seamDragged(secs, travel, before, after)` in `advanced/timelineView.ts`): from the length the Transition overlaps its Segments by (`transitionOverlap`, so a stored 3 s over short Segments drags from what is seen), plus twice the outward travel in Timeline seconds, clamped to `TRANSITION_BOUNDS` and half the shorter Segment, never under 0.1; rounded to 0.01 s. No snapping.
- **Seam** (`Seam` in `advanced/Tracks.tsx`): a `<button>` band from the outgoing Segment's end less the overlap to that end (the planned `track`, now a prop of `Tracks`: that end doesn't move when the length changes, so the band doesn't jump while the plan catches up), with a centre line. It picks the join on click (`onJoin`, which also opens the Transitions tab on a desktop) and takes card drops as the diamond does (the same `join` props). A grip at each edge: 16 px hit areas, 40 px under a coarse pointer (`pointer-coarse:w-10`), `touch-none`, pointer captured, propagation stopped so the Timeline doesn't scrub or rubber-band. While dragged the band stays centred where it was grabbed, so both edges follow the pointer, with a "0.50 s" tooltip; the length is committed once on release through the new `onTransition` handler, one `history.set` without a group (one undo step), and only if it changed. Joins without a Transition stay diamonds.
- **Locked Video Track**: the band is drawn without grips, and `onTransition` in `AdvancedEdit` refuses with the lock notice anyway.
- The band's label and title use the catalogue's label ("Fade, 0.50 s") instead of the stored id.

Checked: vitest `timelineView.test.ts` (2x travel out and in, the 0.1/3 bounds, half the shorter Segment either side, dragging from the clamped overlap), plus `Transitions.test.tsx`, `transitionPanel.test.tsx`, `editor/transitions.test.ts`: 93 passed; `tsc` clean. The full suites weren't run (as asked). The Seam component itself has no rendering test: the advanced tests call components as functions, which a hooked component can't be.
