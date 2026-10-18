# 01: Prefactor: a Transition catalogue on both sides

**Parent spec:** `../spec.md` ("Catalogue and rendering", "Preview"); docs/adr/0012-transitions-are-recipes-around-one-xfade.md.

**What to build:** a prefactor that changes no rendered pixel and nothing the preview shows, apart from one rename of labels.

Today a Transition's kind goes straight into ffmpeg's `xfade` as `kind.value`. The preview's look is a switch on the kind that styles the ghost alone. Give both sides a catalogue keyed by `TransitionKind`, so that later tickets add a kind by adding an entry.

**Backend:**
- A table maps every kind to a recipe: an optional filter chain on the outgoing side, one on the incoming side (each enabled only over the overlap), and one xfade (a built-in name, or a `custom` expression that reads only `A`, `B`, `X`, `Y`, `P` and constants).
- The renderer builds each join from its recipe.
- The ten existing kinds are plain built-ins with no side chains, so the filter graph is the same as today.

**Frontend:**
- An exhaustive `Record<TransitionKind, { label, group, look }>` replaces the Transitions tab's label list and the preview's look switch.
- `look(progress)` returns styles for the outgoing layer, the incoming layer and a veil.
- The preview has a place to apply the incoming layer's styles: the Segment picture layer only, never the Overlays, captions, Picture layers, hook or Watermark above it.
- For now, every existing look leaves the incoming layer alone.
- The labels "Slide left/right/up/down" become "Push left/right/up/down".

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Every existing backend and frontend test passes unchanged, apart from renames.
- [ ] A Candidate with each of the ten kinds renders the same frames as before: compare a mid-Transition frame per kind against frames rendered before the change.
- [ ] A backend test checks that every `TransitionKind` has a recipe.
- [ ] The frontend type check fails if a kind lacks an entry in the catalogue.
- [ ] The preview's ten looks are unchanged on screen.
