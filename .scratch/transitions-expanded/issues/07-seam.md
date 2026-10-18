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

**Status:** ready-for-agent

- [ ] A join with a Transition shows a band spanning its overlap. One without shows the diamond.
- [ ] Dragging a grip outward by x Timeline seconds lengthens the Transition by 2x, up to 3 s and half the shorter Segment (vitest on the drag rule).
- [ ] The tooltip shows the length during the drag.
- [ ] One drag is one undo step.
- [ ] Clicking the band picks the join and opens it in the inspector.
- [ ] A locked Video Track shows no grips and refuses the drag.
