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

**Status:** ready-for-agent

- [ ] Apply to all gives every join the picked join's kind, `secs`, `strength`, `colour` and `sound`, in one undo step.
- [ ] Randomise all never gives two neighbouring joins the same kind (vitest with a seeded random over many joins). Every kind is reachable.
- [ ] Remove from all leaves no Transition, in one undo step.
- [ ] The Random card sets a kind unlike its neighbours' on its target join.
- [ ] On a locked Video Track the three actions and the Random card are disabled.
