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

**Status:** done

- [x] Every kind has a card, drawn by its catalogue `look`, with no image assets added.
- [x] Hovering a card animates it. Leaving it returns it to its resting moment.
- [x] A click with a join picked sets that join's kind and keeps its length.
- [x] A click with nothing picked sets the kind on the join nearest the playhead and makes that join the Pick (vitest on the target rule).
- [x] Dragging a card onto a join applies it.
- [x] A single-Segment Clip shows disabled cards and the hint.
- [x] The picked join's kind is marked among the cards.

## Comments

**2026-10-19, agent:** Built.
- **Cards** (`frontend/src/pages/job/advanced/TransitionCard.tsx`): a button per kind holding the incoming, outgoing and veil layers over a black ground (for Iris and Box, which go through black), each picture drawn in CSS (a blue one with a light disc going out, orange stripes coming in), and the label. The layers take the kind's look at its resting moment (`CARD_MOMENTS`: 0.3 for the dips, Iris and Box, else 0.5) as React styles; a mouse's hover plays the kind with `requestAnimationFrame` and `showLook` on the layers (1.2 s through, held to 1.6 s, from the resting moment so nothing jumps), and leaving puts it back at rest. Nothing plays under `prefers-reduced-motion: reduce` or for touch. `look` is called in one place, `cardLook(kind)`.
- **Tab** (`advanced/Transitions.tsx`): the sections' text buttons are now `TransitionCard`s; `<TransitionFilters />` is mounted once beside them for Pixelize (its 24 px blocks read fine on a card at rest). New prop `cuts` (the Clip has a join): without one the cards are `disabled` and the hint says "A transition needs a cut". With no join picked the hint now says a click goes to the join nearest the playhead.
- **Target rule** (`cardTarget` in `advanced/actions.ts`): the picked join, else the join nearest the playhead (where its Segment ends as played, as the diamonds are drawn; the earlier of two as near), none with one Segment. `AdvancedEdit`'s `onPick` calls it with `playback.time`, then `setTransition`, which keeps the join's length and sound and makes it the Pick. Dragging onto a join is unchanged (`DRAG_TRANSITION`). The phone's join inspector renders the same panel with `kinds`, so it shows the same cards.
- The picked join's kind is marked with `aria-pressed` and an accent ring, as before.

Checked: vitest `advanced/transitionCards.test.tsx` (new: the target rule, picked join / nearest / tie / one Segment; every kind has a card with no image; Fade rests at 0.5 opacity, Push left with both layers moved, a dip before its middle; the picked kind marked; disabled cards and the hint in a one-Segment Clip; the filters drawn once), `Transitions.test.tsx` (now reads the labels from the cards), `transitionPanel.test.tsx`, `actions.test.ts`, `editor/transitions.test.ts`: 136 passed; `tsc` clean. Not looked at in a browser.

For later tickets:
- **04 (knobs):** change `cardLook` in `TransitionCard.tsx` to pass the knobs (the kind's defaults, or the picked join's). New looks get a card by being in `TRANSITIONS`; add a `CARD_MOMENTS` entry where mid-way reads badly (Film burn's flash, say).
- **08 (Random card):** a card in `TransitionPanel` before the sections, calling a new prop (or `onPick` with a kind chosen there); it should be disabled with the others when `cuts` is false. The target for it is the same `cardTarget`.
- The preview's Ghost mounts `TransitionFilters` too, so the page can hold two copies of the same filter ids; they are identical, so `url(#...)` reads the same either way.
