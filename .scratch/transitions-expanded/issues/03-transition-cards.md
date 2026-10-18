# 03: Moving cards in the Transitions tab

**Parent spec:** `../spec.md` (Solution "The Transitions tab shows every kind moving", "Preview" cards, "Advanced Edit" Transitions tab).

**What to build:** each kind in the Transitions tab is a card that shows what it does.
- **Sample pictures.** A card holds two sample pictures, drawn in CSS with no image files and clearly unlike each other (a cool one with a round figure, a warm one with stripes). They are styled by the kind's own `look`, the same function the preview uses.
- **Motion.**
  - At rest, a card holds part-way through the kind: mid-way, or a moment set per kind where mid-way reads badly.
  - On hover (desktop) it plays the kind in a loop.
  - It holds still under reduced motion.
- **Applying.**
  - Clicking a card applies the kind to the picked join.
  - With no join picked, it applies to the join nearest the playhead and picks that join.
  - Dragging a card onto a join still works.
  - In a Clip of one Segment the cards are disabled, with a hint that a Transition needs a cut.
- **The current kind.** The card of the picked join's kind is marked.
- **Phone.** The join inspector shows the same grouped cards.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Every kind has a card, drawn by its catalogue `look`, with no image assets added.
- [ ] Hovering a card animates it. Leaving it returns it to its resting moment.
- [ ] A click with a join picked sets that join's kind and keeps its length.
- [ ] A click with nothing picked sets the kind on the join nearest the playhead and makes that join the Pick (vitest on the target rule).
- [ ] Dragging a card onto a join applies it.
- [ ] A single-Segment Clip shows disabled cards and the hint.
- [ ] The picked join's kind is marked among the cards.
