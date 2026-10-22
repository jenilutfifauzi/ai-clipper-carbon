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

**Status:** ready-for-agent

- [ ] Every rename is consistent in the backend, the frontend, the tests and the ticket Comments' references are left as history.
- [ ] The command fixture tests and every background-removal test file pass unchanged (apart from renamed imports).
- [ ] `npm run typecheck` is clean.
