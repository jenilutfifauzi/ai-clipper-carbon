# 08: A Cue's own place and size

**Parent spec:** `../spec.md` (Domain and model: `CueEdit.x`, `y`, `scale`; Planning Cues: place and size; Advanced Edit: Preview); user stories 27–30, 37 (position).

**What to build:** the owner moves one caption off a face, or makes one key caption bigger, without touching the others.

**Model:** Cue Edits gain `x`, `y` (output px, as the Caption Style's custom position) and `scale` (bounded, over the Caption Style's size).

**Planning:**
- `x` and `y` place that Cue as a custom position does, kept in the frame. They override the Caption Style's position for it alone.
- `scale` multiplies the Caption Style's size before shrink-to-fit, so the Cue follows later changes to the size.

**Preview:**
- A picked Cue shows Grips: move and corners only, no edges and no rotation. They write its Cue Edit, one drag per undo step, with Smart Guides.
- Clicking a Cue on the preview picks it.
- With the captions picked, the Grips write the Caption Style Override, as today.
- The inspector of a picked Cue has its place and scale, with Reset position.

**Blocked by:** 07.

**Status:** done

- [x] Planner: `x` and `y` move one Cue only and stay in the frame. `scale` 1.5 makes it 1.5× the style's size, and follows a style size change.
- [x] Render (real ffmpeg): the moved Cue's ink is at its place in a frame, and the next Cue's is at the style's position.
- [x] vitest: Grips on a picked Cue write `x`, `y` and `scale`. On the picked captions they write the Style Override. Reset position clears them.
- [x] The MCP accepts `x`, `y` and `scale` in `cue_edits`.
- [x] Browser walkthrough: drag and scale one Cue, then all captions. Smart Guides show.

## Comments

**2026-10-19, agent:** Built.

**Model.** `CueEdit` (`app/candidates.py`) gains `x: Width | None`, `y: Height | None` (output px, the Caption Style's types) and `scale: CueScale | None`, bounded by `CUE_MIN_SCALE` 0.25 and `CUE_MAX_SCALE` 4. Stored Cue Edits now carry the three as null.

**Planner** (`_captions` in `app/planner.py`):
- `y` puts the Cue in `_custom_caption_area(y)` (what `CaptionPosition.CUSTOM` now uses too), kept in the safe area; a Cue at its own height doesn't move or split at a Layout change.
- `x` goes to `_caption_placed` in place of the style's x, so the line stays in the frame's width.
- `scale` goes to `_caption_size(..., scale)`: the style's size times it (to 0.1), then the usual shrink-to-fit.
- Each field works alone: only `y` keeps the style's x, and only `x` keeps the style's height.

**MCP.** `cue_edits` takes `x`, `y` and `scale` from the dataclass schema, merged field by field (a null clears one). The dry run's Cues now give `centre` ([x, y] of the area) and `size`, and the instructions explain the fields. TOOLS_BUDGET_BYTES is 73_000, merged with 05's 72_000.

**Frontend.**
- `api.ts`: `CueEdit.x/y/scale` are optional (`?: number | null`), so code that builds a Cue Edit without them (07's, and 09's) still typechecks. `CUE_MIN_SCALE` and `CUE_MAX_SCALE` are added.
- `editor/cues.ts`: `cueStageId(key)` ("cue:<media>@<at>") and `cueKeyOf`. `StageId` gains `cue:${string}`, and `pick.ts`' `stageIdsOf`/`stageItem` map a Cue Pick to it and back.
- `ClipPreview`: `StageControls.cues.onPlace`. With it, and the captions not picked, each Cue is its own stage item (its entries at a Layout change are one): click picks it; move and corners only, from its size as shown; the same fixed-guide snapping and guide lines as the captions item. With the captions picked, the old all-captions item comes back. The clip editor passes no `cues`, so nothing changes there.
- `advanced/cuePlace.ts` (new, so 09's `cueEdits.ts` changes don't collide): `placedCaptions(scene, pick, place)` writes the Style Override for the picked captions, or the Cue Edit's x/y (and scale = size / style size from a corner) for a picked Cue. It returns null on a locked Captions Track. Also `placeCue(scene, key, fields)` for the inspector, and `resetCuePosition`. AdvancedEdit sends the captions' and Cues' stage moves through `placedCaptions`, one undo group per gesture.
- `cueEdits.ts`, minimal: `withCueEdit`, `placed` and `empty` are exported, and `empty` now counts the place fields. Reset timing only acts on a Cue Edit that has timing, and keeps it while it still places its Cue. Reset position keeps it while its timing remains.
- Inspector: `CueFields` renders the new `CuePlaceFields`: Across, Down and Scale sliders (each drag one undo group) and Reset position.

**Checks.**
- `tests/test_planner.py`, 2 new: place moves only its Cue, each axis alone, kept in the frame; scale 1.5 at size 110 is 165, at 120 is 180, and a too-wide line is still set smaller.
- `tests/test_render.py::test_a_cue_placed_and_scaled_alone_is_burned_at_its_place_and_the_next_at_the_styles` (real ffmpeg): the moved Cue's magenta ink is centred at 600 px down, as near 360 px across as keeps it in the frame, 1.5× wide. The next Cue's ink is at the style's place and size. The rendered plan equals the preview's, and out-of-range scale, x and y are refused. 07's saved-dict assertion now includes the null fields.
- `tests/test_mcp.py`: a dry run's centre and size, a refused scale, and a field-by-field merge with a null.
- vitest `advanced/cuePlace.test.ts` (8): a Cue's Grips write x/y/scale; the captions' write the Style Override; a locked Track refuses; stage ids round-trip; inspector fields; Reset position and Reset timing keep each other's fields.
- Browser walkthrough: the built frontend on a copy of one Job in a scratch DATA_DIR, port 8768, desktop.
  - Clicking "KAYAK GUE LOST" on the preview picked that Cue, with corner Grips and the inspector's Across, Down and Scale.
  - Dragging it up saved `{x: 410, y: 808}`. The next Cue stayed at the style's place.
  - A corner drag scaled it (`scale: 1.24`), and one Undo took back only the scale.
  - Reset position dropped the Cue Edit (`[]`).
  - Picking "Captions" on the Track's label and dragging on the preview wrote `style_overrides.caption {position: custom, x: 540, y: 1135}` and showed the centre guide. The moved Cue kept its own place.

**Bug found and fixed in the walkthrough.** The Cue's corner size started from its Cue Edit's scale. Once shrink-to-fit capped the drawn size, the scale ran away to 4 within one short drag. It now starts from the Cue's size as shown.

**Not done / deviations.**
- Stage items (the captions, and now a Cue) snap to the frame's fixed guides with guide lines, as the captions did. They don't snap to other pictures, as pictures' Smart Guides do.
- For 09: Reset position, like Reset timing, drops a Cue Edit with nothing left, which would also drop one that only starts a Cue (Split).
