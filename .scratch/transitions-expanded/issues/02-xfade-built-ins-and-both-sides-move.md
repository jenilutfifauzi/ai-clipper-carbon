# 02: 31 xfade built-ins in seven groups, both sides moving in the preview

**Parent spec:** `../spec.md` (Solution's table, "Model", "Preview", "Advanced Edit", "Agent (MCP)"); ADR 0012.

**What to build:** the owner sees the Transitions tab grouped into Basic, Slide, Wipe, Shape, Zoom, Light and Glitch, and can apply any of xfade's 31 built-in kinds in the spec's table. That is 21 new ones beside the ten of today:
- `fadegrays`, `dissolve`;
- `coverleft`, `coverright`, `coverup`, `coverdown`;
- `wiperight`, `wipeup`, `wipedown`, `radial`;
- `circleclose`, `circlecrop`, `rectcrop`, `vertopen`, `horzopen`;
- `squeezeh`, `squeezev`;
- `pixelize`, `hblur`, `distance`, `hlslice`.

Each renders through its recipe (01) and is imitated in the preview with CSS:
- the outgoing and incoming layers are both styled over the overlap, so Push, Cover and Squeeze move both pictures as they render;
- wipes, doors, box and circles use `clip-path`;
- Clock wipe uses a `conic-gradient` mask;
- Dip through grey and Blur use `filter`;
- Dissolve uses a noise mask;
- Pixelize and Slices use an SVG filter or the nearest CSS;
- Distance is a crossfade.

A Transition's length is now 0.1–3 s (was 0.2–1.5), default 0.5, still at most half the shorter neighbour. The Length slider follows.

The Transitions tab lists the groups as sections with sticky headings. Kinds are still text buttons; cards come in 03. Groups with no kinds yet (Light) are hidden until they have some.

The agent sees every kind in the schemas. The tool descriptions name the groups and their kinds and the length bounds. The dry run's plan view gains `transitions` (after, kind, start, end).

**Blocked by:** 01.

**Status:** done

- [x] Each of the 21 new kinds is accepted by the API and MCP and renders: a sample (`coverleft`, `pixelize`, `radial`, `rectcrop`) has a mid-Transition frame unlike both sides, and the Clip is shortened by the overlap.
- [x] `secs` of 0.1 and 3.0 are accepted, and 0.05 and 3.5 are refused with a clear message. The half-the-shorter clamp still applies.
- [x] In the preview, Push left moves the incoming picture in from the right while the outgoing one leaves to the left. Cover left moves only the incoming one.
- [x] Each look shows only the outgoing picture at progress 0 and only the incoming one at 1 (vitest over the catalogue).
- [x] The tab shows group sections with sticky headings in the spec's order.
- [x] The dry run lists `transitions`.
- [x] Saved Candidates with the old ten kinds load and render unchanged.

## Comments

**2026-10-18, agent:** Built. What changed:
- **Model** (`app/candidates.py`): `TransitionKind` grows to xfade's 31 built-ins, in the tab's order by group; `TRANSITION_SECS = (0.1, 3.0)` and `TRANSITION_DEFAULT_SECS = 0.5` bound `Transition.secs`. The half-the-shorter clamp (`transition_overlap`) is untouched. Each new name was checked against `ffmpeg -h filter=xfade` (ffmpeg-full 9.x, all 31 present).
- **Catalogue** (`app/transitions.py`): `BUILT_INS`, the kinds that are xfade's own transitions of their names, and `RECIPES` made from it. The first ten recipes are the same objects as before (test), so saved Candidates render as they did.
- **MCP** (`app/mcp_server.py`): the instructions gain a "- A Transition ..." paragraph naming the length bounds, the default, the clamp, and each group with its kinds (Light left out as it has none yet). The dry run's `_plan_view` gains `transitions`: `{after, kind, start, end}`, `after` being the id of the Segment the event ends (`_ended`: the Segment that starts before the event and ends with it, as `PreviewTransitions` finds the ghost). `TransitionEvent` is unchanged, so the Render Plan's readers are untouched. The tools' schemas list every kind by the enum; their size went from 68.6 kB to 69.6 kB, so `TOOLS_BUDGET_BYTES` is 70_000 (04's knobs and 06's sound will push past it: raise it with a note, as before, or shorten a description).
- **Preview catalogue** (`frontend/src/pages/job/editor/transitions.ts`): `LayerLook` gains `filter`, and `showLook` clears it. `TRANSITION_GROUPS` is the seven groups in order. Helpers: `layers(outgoing, incoming?, veil?)`, `push`/`cover`/`wipe` by the side the incoming picture comes from (`off(side, share)` is the transform that moves a picture off that side), `doors`, `crop` (through black, as xfade's `circlecrop` and `rectcrop` are), `through(filter)` (a crossfade with a filter on both pictures peaking halfway), `noise(share)` (a data-URI SVG turbulence mask for Dissolve). The looks: Push now moves the incoming layer in from the far side (both move); Cover moves only the incoming one over the outgoing one, which is cut away where it has come; the wipes, Circle close, Box and Iris use `clip-path`; Clock wipe a `conic-gradient` mask; the doors and Slices `linear-gradient` masks; Dip through grey `grayscale()` on both; Blur `blur()`; Pixelize an SVG filter by level (`PIXELIZE_BLOCKS`, `pixelizeFilter(level)`); Distance a crossfade. Circle open's mask now reaches the corners at 1 (was 80%: the ghost is hidden at the end anyway, so nothing visible changed). wipeleft's label is "Wipe left".
- **`TransitionFilters.tsx`**: the `<svg>` of Pixelize's filters (a dot per block, tiled, dilated), mounted by the Ghost in `PreviewTransitions`. A browser that ignores `filter: url(#...)` on an HTML element shows the crossfade alone.
- **Transitions tab** (`advanced/Transitions.tsx`): `SECTIONS` (the groups with kinds, Light hidden) as `<section>`s under sticky `<h3>` headings (`sticky top-0`, over the Asset Panel's and the phone sheet's scroll); kinds are still text buttons. `TRANSITION_BOUNDS = {min: 0.1, max: 3}` is exported for the Length slider (step 0.05) and for 07's Seam drag. `api.ts`'s `TransitionKind` lists the 31.

Checked:
- Seam A, real ffmpeg (`test_transitions.py`): `coverleft`, `pixelize`, `radial` and `rectcrop` each render a Clip shortened by the 0.6 s overlap with a middle frame unlike both sides (luma differs by more than 8); `secs` 0.1 and 3.0 are saved, 0.05 and 3.5 refused with "greater than or equal to 0.1" / "less than or equal to 3" on `secs`; the clamp still halves a 3 s Transition to the shorter Segment. Seam B: a 3 s join between 10 s Segments overlaps by 3 s.
- MCP (`test_mcp.py`): all 21 new kinds pass through `edit_candidate`'s dry run, which lists `transitions` with `after`, `kind`, `start`, `end`; `merge_candidate_items` saves a 3 s one and refuses 3.5; the instructions name every `TransitionKind` under its group; the tools fit 70_000 bytes.
- vitest (`editor/transitions.test.ts`): the groups and labels in the spec's order; for each of the 31 kinds, the look at 0 shows the whole outgoing picture and no veil, at 1 none of it and the whole incoming one, and at 0.4 something is happening (`shows()` reads the opacity, transforms, inset/circle clip-paths, hard-stop gradient masks and filters); Push moves both layers and Cover only the incoming; `showLook` clears a filter. `advanced/Transitions.test.tsx`: the tab's six sections (no Light) with sticky headings, the Slide group's Pushes then Covers.
- Probed xfade's own frames (red into blue, 25/50/75%) to match the looks' directions: `coverleft` brings the incoming picture in from the right over a still outgoing one; `squeezeh` squeezes the outgoing picture to a line across the middle with the incoming one behind; `circlecrop`/`rectcrop` go through black; `radial` sweeps clockwise from twelve.
- Backend 825 passed (was 821; 3 deselected Whisper), frontend 886 passed (was 853), `tsc` clean. `git merge main`: already up to date.

For later tickets:
- **03 (cards):** mount `<TransitionFilters />` once beside the cards, or Pixelize's card shows a crossfade. `SECTIONS` in `advanced/Transitions.tsx` is the grouping to reuse.
- **04 (knobs/looks):** `look` is still `(progress) => TransitionLook`; the `Look` type and the helpers above are where strength and colour go. `through()` is the shape for Blur dissolve and the like.
- **06 (sound):** the MCP's "- A Transition" paragraph is where the sound options belong; the budget note above.
- **07 (Seam):** `TRANSITION_BOUNDS` for the drag's clamp; the dry run's `after` is found by `_ended()` in `mcp_server.py` if the Seam wants the same join id on the frontend (`PreviewTransitions` does the same lookup).
