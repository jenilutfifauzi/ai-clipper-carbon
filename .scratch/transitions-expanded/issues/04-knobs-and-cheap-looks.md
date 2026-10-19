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

**Status:** done

- [x] Dip to colour's middle frame is the chosen colour (real render).
- [x] Film burn and Light leak brighten the middle frame above both sides' own pictures.
- [x] For each strength-reading kind here, strength 0 and 1 give measurably different middle frames.
- [x] A 0.5 s join of each new kind renders within a set budget of a fade join on the same input (the budget is written in the test).
- [x] A Transition stored without the knobs reads with them unset. A knob on a kind that doesn't read it is kept through a save.
- [x] The inspector shows Strength and Colour only where they apply. The preview's look changes with them.
- [x] `merge_candidate_items` can set `strength` and `colour` alone, and the dry run shows them.

## Comments

**2026-10-19, agent:** Built.
- **Model** (`app/candidates.py`): `Transition.strength` (0..1 or None) and `Transition.colour` (`Colour` or None), after `sound`; stored Transitions read with both None, and either is kept on any kind. `TransitionKind` gains `dipcolour` (Basic, after `fadegrays`), `filmburn`, `lightleak` (Light) and `rgbsplit` (Glitch, first). `Join` and `TransitionEvent` (`app/planner.py`) carry `strength` and `colour` after `sound`; `app/rendering.py` passes them.
- **Recipes** (`app/transitions.py`): `SideChain` is now `(TransitionEvent, Side) -> str`, `Side(start, incoming, width, height, name)`, so a chain can be a small graph of its own (its labels from `name`) and know the picture's size. `STRENGTHS` and `strength(event)` give the kind's own strength when unset (filmburn 0.6, lightleak 0.7, rgbsplit 0.5). All four are side chains around a plain xfade `fade`:
  - `dipcolour`: `fade=t=out` to the colour over the first half on the outgoing side, `fade=t=in` from it over the second on the incoming one.
  - `filmburn`: `eq` with per-frame `brightness` (lifted, clamped to white) and chroma `gamma_r`/`gamma_b` (warm), peaking at the middle by the heat, `enable`d over the overlap.
  - `lightleak`: a warm diagonal band drawn by `geq` on a 48×48 RGBA frame (alpha = strength × a triangle in time × the band's falloff), scaled to the picture and laid over with `overlay=eof_action=pass`, on both sides alike.
  - `rgbsplit`: `rgbashift` (red left, blue right, `strength × width/27` px) on the overlap only: the side is split, trimmed at the overlap's edge, the overlap shifted and brought back to yuv420p, and concatenated. That keeps the rest of the side from going through planar RGB (5 ms a frame at 1080×1920 otherwise, on the whole Clip so far).
- **Not `custom` expressions.** Measured on ffmpeg here at 1080×1920 (0.5 s join, 1.5 s test): `fade` 0.9–1.5 s. xfade's plainest custom one (`A*P+B*(1-P)`) took 2.6–4.7 s. A film burn expression clamped with `clip()` took 9.6–12.8 s, and 4.9–5.5 s without the clamp (it wraps past 255). So both light looks are native filters. ADR 0012's Consequences gained a bullet saying so, and `Recipe.expr` stays unused. The native recipes took 1.1–2.6 s in the same test.
- **Renderer**: `_crossed` takes the plan, for each `Side`'s size.
- **MCP**: the dry run's `transitions` add `strength`/`colour` when set (`_compact`). The instructions name Light and the new kinds, and say which kinds read `strength` and `colour` and that a knob is kept on any kind. `TOOLS_BUDGET_BYTES` went from 71_000 to 72_000, with a comment (71_798).
- **Preview** (`editor/transitions.ts`): `look(progress, knobs?)` with `knobs: TransitionKnobs` (`api.ts`'s `{strength?, colour?}`, which `Transition` and `TransitionEvent` extend). Knobs are optional, so the cards (03) can call `look(p)` and get the kind's own strength. Catalogue entries gain `strength?` (the kind's own; present only for kinds that read it) and `colour?` (`dipcolour`'s `#000000`), built by `strong(own, look)`. `LayerLook.mixBlendMode` ("screen") is set and cleared by `showLook`.
  - Dip to colour: `dip(colour)`.
  - Film burn: a warm radial gradient on the veil, `screen`, opacity strength × peak.
  - Light leak: a 135° band on the veil sweeping −30%→130%, `screen`, opacity strength × peak.
  - RGB split: a crossfade with `url(#transition-rgbsplit-N)` on both layers inside the overlap, N the strength in tenths (`RGBSPLIT_LEVELS`). `TransitionFilters.tsx` draws those filters in `objectBoundingBox` units, so the spread is a share of the width as in the render.
  - `PreviewTransitions` passes the event as the knobs.
- **Inspector** (`advanced/Transitions.tsx`): Strength (0–100% slider, the kind's own when unset) only for kinds with `strength`; Colour (`ColorField`, black when unset) only for `dipcolour`. Each is one history group per field (`transition:<after>:strength` / `:colour`), as Length is. Picking a kind keeps the knobs: `AdvancedEdit.setTransition` spreads the old Transition (checked). The Light section now shows, since `SECTIONS` drops only empty groups.

Checked:
- Seam B: the planner's `TransitionEvent` carries strength and colour, unset by default.
- API: knobs are saved and drawn, kept when the kind changes to one that doesn't read them, and refused out of range or not #RRGGBB. A Candidate stored without them reads None.
- Seam A, real ffmpeg, on a new `striped_video` fixture (stripes that brighten, for RGB split's edges). Each of the four renders a Clip shortened by the overlap with a middle unlike both sides. Dip to colour's middle is #3366FF within 12. Film burn and Light leak lift the middle's luma more than 10 above both sides (e.g. 55 to 178 and 152 at strength 1, sides 77/26). Strength 0 and 1 give middles differing by a mean of 131, 76 and 22 for filmburn, lightleak and rgbsplit.
- Render budget: `RENDER_BUDGET_SECS = 3.0` over a fade join. Each kind is rendered alone; the fade is rendered first and last and the quicker kept, since the first render warms up. Here fade took about 1.8 s, the others 1.8–2.0 s.
- MCP: `merge_candidate_items` sets `colour` alone, then `strength` alone, keeping the other; the dry run shows a set knob and leaves an unset one out; the instructions' knob sentences name their kinds.
- vitest: the catalogue's groups with the new labels; which kinds read which knob and their defaults; Dip to colour by colour (black unset); Film burn/Light leak blend by strength, none at 0, the kind's own unset, the leak's band moving; RGB split's filter level by strength, none at 0; `showLook` clears the blend; every kind still shows all of the outgoing at 0 and only the incoming at 1. The inspector: Strength only on filmburn/lightleak/rgbsplit at its own default (60%), Colour only on dipcolour (black), each change a group keeping the rest.
- Tests run (only the related files, as asked): backend `test_transitions.py`, `test_mcp.py`, `test_planner.py`, `test_advanced_rules.py`: 141 passed. Frontend `transitions.test.ts`, `Transitions.test.tsx`, `transitionPanel.test.tsx`, `transitionSound.test.ts`, `merge.test.ts`, `actions.test.ts`: 166 passed. `tsc` clean. `git merge main`: already up to date.

For later tickets:
- **05 (Concat looks):** use `Side` (its `name` for labels, `width`/`height`, `incoming`). `strength(event)` with an entry in `STRENGTHS`, and `strong(own, look)` in the preview. `_split`'s trim-and-concat is how to keep an RGB-only filter (glitch's `rgbashift`) to the overlap. `_peak`/`_overlap` are the in-`t` triangle and `enable` for `gblur`/`rotate` ramps. Add each kind to `test_a_join_of_each_new_look_renders_within_its_budget_of_a_fade` and to the knob lists in the MCP instructions (the test reads the `strength` sentence up to "`colour`").
- **03 (cards):** `look(p)` without knobs draws the kind's own strength; `<TransitionFilters />` now holds RGB split's filters too.
- **08/09 (all joins, Join Transition):** "Apply to all" and a Join Transition copy `strength` and `colour` with the rest; Randomise keeps the picked join's knobs (they're kept on any kind).

