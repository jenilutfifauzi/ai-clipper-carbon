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

**Status:** done

- [x] Every existing backend and frontend test passes unchanged, apart from renames.
- [x] A Candidate with each of the ten kinds renders the same frames as before: compare a mid-Transition frame per kind against frames rendered before the change.
- [x] A backend test checks that every `TransitionKind` has a recipe.
- [x] The frontend type check fails if a kind lacks an entry in the catalogue.
- [x] The preview's ten looks are unchanged on screen.

## Comments

**2026-10-18, agent:** Built. The seam:
- **Backend catalogue** (`app/transitions.py`): `Recipe(xfade=None, expr=None, outgoing=None, incoming=None)`, one of `xfade` (a built-in's name) or `expr` (xfade's `custom` expression) and, optionally, a `SideChain` per side: `(TransitionEvent, start) -> str`, a comma-joined filter chain given the event (its knobs, from 04 and 06) and when the overlap starts in that side's own seconds (the outgoing side's are the Clip's, the incoming side's start at 0), which enables itself only over the overlap. `Recipe.transition` is xfade's `transition` option. `RECIPES: dict[TransitionKind, Recipe]` holds the ten kinds as plain built-ins of their own names.
- **Renderer**: `_joins` builds a picture join with `_crossed`, from the kind's recipe: each side through its chain (labelled `[x{i}o]`, `[x{i}i]`), then the recipe's xfade. With no side chains the graph is the same string as before. The sound's acrossfade is unchanged.
- **Preview catalogue** (`frontend/src/pages/job/editor/transitions.ts`): `TRANSITIONS: Record<TransitionKind, { label, group, look }>` in the tab's order, `TRANSITION_KINDS`, `TransitionGroup` (the seven groups), `look(progress) -> TransitionLook { outgoing, incoming, veil }` of `LayerLook`s (opacity, transform, clipPath, maskImage, background), and `showLook(look, layer)`, which also clears what an earlier look set. The labels "Slide left/right/up/down" are now "Push …"; groups as the spec's table.
- **Preview wiring**: `ClipPreview` wraps the decks and `PreviewSegments` in one `incoming` layer, under the ghost and inside the Segments' layer, so the Overlays, captions, Picture layers, hook and Watermark are outside it. `PreviewTransitions` takes it as a ref; the Ghost shows the look's three parts on the ghost, that layer and the veil, and clears the incoming layer outside the Transition and when it unmounts. Every existing look leaves the incoming layer alone.
- The Transitions tab reads `TRANSITIONS`/`TRANSITION_KINDS` instead of its own list.

Checked:
- A Candidate per kind (testsrc2, two Segments, 0.8 s) rendered before and after: frames at 25, 50 and 75% through each Transition are byte-identical for all ten kinds.
- A throwaway vitest compared the old `look()` with the new catalogue at 101 progress values per kind: the same opacity, transform, clip-path, mask and veil on screen, and the incoming layer untouched.
- Adding a kind to `TransitionKind` alone fails `tsc` on the catalogue (TS2741, one error).
- New tests: every kind has a recipe, the first ten being xfades of their names (test_transitions.py); the catalogue's labels and groups in order, and `showLook` replacing an earlier look (transitions.test.ts).
- Backend 821 passed (11 timed out first under the machine's load (load average about 25: Job-status waits and an upload proxy, none touching Transitions) and passed when run again); frontend 795 passed, and 853 after merging main; tsc clean.
