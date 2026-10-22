# 11: Tidy the Matte code

**Parent spec:** `../spec.md`; GLOSSARY. From the branch's code review (2026-10-22). Behaviour must not change.

**What to build:** a refactor with no change in behaviour, covering what the Standards review raised:

- **Naming:**
  - Background removal is named "cut" across the code (`MatteCut.tsx`, `CutGroup`, `cutSlot`, `CutVideo`/`CutImage`, `_cut_out`, `_Cut`, `_cut_picture`), right beside the glossary's "Cutout" (the keys' category), which Background removal is not.
  - Rename these after GLOSSARY terms, Background removal or Matte (e.g. `MatteMask.tsx`, `_removed_background`), consistently in the backend and the frontend.
  - Rename `Part = int | Reversed` in `matte.py` to say what it holds.
- **Data Clumps:** `matte`, `matte_files`, `matte_at`, `matte_copy`, `matte_copy_at` (and the feather) are repeated on `SegmentPlan` and `OverlayEvent`. Bundle them into one Matte-read type that both carry. Then collapse the `isinstance(SegmentPlan/OverlayEvent)` cascades in `_matte_inputs` and `_check_matte`.
- **Duplicated Code:**
  - the feather scaling `replace(removal, feather=round(removal.feather * scale, 3))` (three places);
  - the `gblur` feather filter (twice);
  - the Matte copy's `-ss/-t/-i` input (twice).
- **Primitive Obsession:** name the tuple `tuple[OverlayEvent, int, FrameFeed | None, int, str | None]` in `renderer.py` (spelled six times).
- **Middle Men:** remove `planner.filled()` if it only calls `_filled()`, and the `KokoroSource` alias if nothing outside needs it.

**Blocked by:** 10, 12, 13

**Status:** done

- [x] Every rename is consistent in the backend, the frontend, the tests and the ticket Comments' references are left as history.
- [x] The command fixture tests and every background-removal test file pass unchanged (apart from renamed imports).
- [x] `npm run typecheck` is clean.

## Comments

**2026-10-22, done.** No behaviour change: the command fixtures, every background-removal test file and the vitest files pass, with only renamed imports and the bundled field's asserts changed.

- **Rename map** (Background removal is a Mask in the preview, and named after the glossary in the backend; "Cutout" stays the keys' category):
  - Frontend: `MatteCut.tsx` → `MatteMask.tsx`; `CutGroup` → `MaskGroup`; `cutSlot` → `maskSlot`; `CutVideo` → `MaskedVideo`; `CutImage` → `MaskedImage`; `CutBackdrop` → `MaskBackdrop`; the inner `cut()` → `drawMasked()`; `DeckMatte.cutting` → `masking`; `cutNow` → `maskNow`; `SlotCut` → `SlotMask` and the slots' `cut` prop → `mask`; `behindStage.cutAlpha` → `maskAlpha`.
  - The markup: `data-cut` → `data-masked`, `data-cut-picture` → `data-mask-picture`, Tailwind's `group/cut` → `group/mask` (`group-data-[masked]/mask`, `[[data-masked]>&]`).
  - Backend: `planner._cut_out` → `_segment_removal`; `renderer._cut_out` → `_removed_background`; `renderer._Cut` → `_PictureMatte`; `renderer._cut_picture` → `_matted_picture`; `Cut` (the plan place, in renderer.py and rendering.py) → `MattePlace`; `matte.Part` → `PieceOrCopy`; `rendering.matte_parts` → `pieces_and_copy`; `review._check_cut_out_pictures` → `_check_removal_keyframes` (its message unchanged).
- **Data Clump:** `planner.MatteRead` (`pieces`, `files`, `at`, `copy`, `copy_at`) is the one `matte` field of `SegmentPlan` and `OverlayEvent`; None without Background removal. The planner gives a Source Segment's `MatteRead(pieces)`, and `rendering.matted` the whole read. The feather stays on `background_removal`, which is already one value and the one the preview and the dry run read.
  - **The plan's JSON changes:** a Segment's `matte` was the pieces list (with `matte_files`, `matte_at`, `matte_copy`, `matte_copy_at` beside it, on Overlays too); it is now `{pieces, files, at, copy, copy_at}` or null. `api.ts` types it as `MatteRead`. Nothing in the frontend read it, and the MCP dry run never listed it, so the dry run is unchanged.
  - In renderer.py, `_read_matte(item)` gives a read with its files (or None), so `_check_matte` takes the read, and `_matte_inputs` lists each picture with its span and (an image's) itself rather than asking `isinstance`.
- **Duplicated Code:** `BackgroundRemoval.scaled(scale)` (three places), `renderer._feathered(feather)` (the two `gblur`s; frames.py's own, at a 0.01 threshold, is left as it is), `renderer._matte_input(matte, span, listings)` (the copy's `-ss/-t/-i` and the pieces' concat, for the still chain and the keyed decode).
- **Primitive Obsession:** `renderer.LaidOverlay(event, number, feed, place, matte=None)`, a NamedTuple; `LaidBehind` is gone (`Behind` holds them).
- **Middle Men:** `planner._filled` is now `filled` (the wrapper gone; test_media_segments imports it as `filled_crop`). The `KokoroSource` alias is gone; `kokoro.py` and its test use `ModelSource`.
- **Tests:** the feature's backend files, test_kokoro_download, test_media_segments, test_overlays, the two command fixtures and `test_mcp.py -k budget` pass; `npm run typecheck` is clean; the vitest files matteTime, backgroundRemoval, matteHousekeeping, segmentBackground, behindTrack and behindStage pass.
