# 08: Apply to all, Randomise all, Remove from all, and the Random card

**Parent spec:** `../spec.md` (Solution "The join inspector", "Advanced Edit" Randomise); GLOSSARY **Transition**.

**What to build:** actions that act on every join of the Clip.

**In the join inspector:**
- **Apply to all joins** writes the picked join's whole Transition (kind, length, strength, colour, sound) over every join, with each join's own `after`.
- **Randomise all joins** gives each join, in order, a kind picked uniformly from all kinds, never the kind of the join before. It keeps the picked join's length, knobs and sound. Each join stores a concrete kind; there is no "random" kind.
- **Remove from all** removes every Transition. It is shown when any exists.

**In the Transitions tab:** a **Random card** applies one random kind to its target join (the picked one, else the nearest to the playhead, as in 03), avoiding the kinds of that join's neighbours.

**Rules for all of them:**
- Each action is one step of undo.
- They are disabled on a locked Video Track.
- Lengths are clamped per join at render, as always.

**Blocked by:** 03, 04, 06.

**Status:** done

- [x] Apply to all gives every join the picked join's kind, `secs`, `strength`, `colour` and `sound`, in one undo step.
- [x] Randomise all never gives two neighbouring joins the same kind (vitest with a seeded random over many joins). Every kind is reachable.
- [x] Remove from all leaves no Transition, in one undo step.
- [x] The Random card sets a kind unlike its neighbours' on its target join.
- [x] On a locked Video Track the three actions and the Random card are disabled.

## Comments

**2026-10-19, agent:** Built.
- **Rules** (`advanced/actions.ts`, pure, each taking an injectable `random` that defaults to `Math.random`): `randomKind(avoid, random)` picks uniformly from `TRANSITION_KINDS` less `avoid`; `randomisedTransitions(model, segments, random)` gives each join in order such a kind, avoiding the one before, with `model`'s (the picked join's) `secs`, knobs and sound; `appliedToAll(model, segments)` is `model` on every join with its own `after`; `randomCardKind(transitions, segments, after, random)` avoids the kinds of the joins either side of `after`. Every join stores a concrete kind.
- **Panel** (`advanced/Transitions.tsx`): new optional props `any`, `locked`, `onRandom`, `onApplyAll`, `onRandomiseAll`, `onRemoveAll`. The Random card (a dice tile shaped like the kind cards, `data-random`) comes before the sections, disabled when `cuts` is false or `locked`. Below the picked join's fields, a block shown while any join has a Transition: Apply to all joins and Randomise all joins (only with a picked Transition), and Remove from all; all three disabled when `locked`.
- **AdvancedEdit**: `setAllTransitions` writes every join's Transitions with one `change` (one `history.set`, no group, so one undo step), refused with the lock notice on a locked Video Track. The Random card targets `cardTarget`'s join and goes through `setTransition` (which keeps length, knobs and sound, picks the join, and refuses a lock). Lengths are left to the render's clamp.

Checked: vitest `advanced/allJoins.test.ts` (new; seeded mulberry32: 2000 joins never repeat a neighbour, keep the model's fields and reach all kinds; Apply to all; the Random card avoids both neighbours, or the one at the last join, and reaches every other kind), `transitionPanel.test.tsx` (the three buttons and their actions, Remove from all alone without a picked Transition and hidden with none, disabled when locked; the Random card's click and its disabling), plus `transitionCards.test.tsx`, `Transitions.test.tsx`, `actions.test.ts`, `editor/transitions.test.ts`: 160 passed; `tsc` clean. Full suites not run (as asked); not looked at in a browser.
