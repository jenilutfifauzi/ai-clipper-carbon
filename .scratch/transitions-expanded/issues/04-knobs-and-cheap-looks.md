# 04: Strength and colour, with Dip to colour, Film burn, Light leak and RGB split

**Parent spec:** `../spec.md` ("Model", "Catalogue and rendering" recipe sketches, "Preview", "Advanced Edit" join inspector); ADR 0012.

**What to build:** a Transition gains two knobs, and the first four of the looks that use them.

**Knobs:**
- `strength`: 0–1, or unset for the kind's own default.
- `colour`: read by Dip to colour only, black by default.
- A knob on a kind that doesn't read it is kept, so switching kinds and back restores it.
- Stored Transitions read with both unset.

**New kinds:**

| Kind | Group | Recipe | Strength |
|---|---|---|---|
| `dipcolour` (Dip to colour) | Basic | the `fade` filter out to the colour on the first half and in from it on the second, then an xfade `fade` | |
| `filmburn` (Film burn) | Light | a non-sampling expression: crossfade plus a warm, triangular flash clamped to white | the heat |
| `lightleak` (Light leak) | Light | a non-sampling expression: a warm diagonal band sweeping with `P`, added and clamped | the warmth/brightness |
| `rgbsplit` (RGB split) | Glitch | `rgbashift` on both sides over the overlap, then `fade` | the spread |

Each has a CSS look that reads the knobs:
- Dip to colour: a veil of the colour.
- Film burn and Light leak: a gradient layer blended with `screen`.
- RGB split: an SVG filter, with a plain crossfade where a browser lacks it.

**Inspector:**
- The join inspector shows Strength (a 0–100% slider) only for kinds that read it, and Colour only for Dip to colour.
- Each change is one undo step.
- The Render Plan's `TransitionEvent` and the dry run carry `strength` and `colour`.
- The tool descriptions say which kinds read which knob.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Dip to colour's middle frame is the chosen colour (real render).
- [ ] Film burn and Light leak brighten the middle frame above both sides' own pictures.
- [ ] For each strength-reading kind here, strength 0 and 1 give measurably different middle frames.
- [ ] A 0.5 s join of each new kind renders within a set budget of a fade join on the same input (the budget is written in the test).
- [ ] A Transition stored without the knobs reads with them unset. A knob on a kind that doesn't read it is kept through a save.
- [ ] The inspector shows Strength and Colour only where they apply. The preview's look changes with them.
- [ ] `merge_candidate_items` can set `strength` and `colour` alone, and the dry run shows them.
