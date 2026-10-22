# 08: Matte housekeeping

**Parent spec:** `../spec.md` ("Matte store and runner", "Model download", "Model"); ADR 0015.

**What to build:** Mattes don't pile up, and the fields move with items like any other.

- **Sweep:** when a Job is opened, Matte pieces (and reversed copies) that no Candidate nor its Revision History shows are removed, as Retimed copies are. The same applies to a media item's pieces across Jobs.
- **Model removal:** removing the person model is refused (409) while a Matte is being made, and once done it removes every Matte.
- **Moving items:** copy, paste, duplicate, split and the Revision merge carry `background_removal`, a Segment's `background` and an Overlay's `behind`.

**Blocked by:** 02

**Status:** done

- [x] Seam A: the sweep removes unused pieces and keeps those a Candidate or its Revision History shows.
- [x] Removal while busy is refused; removal deletes every Matte.
- [x] vitest: copy and paste, split and the Revision merge carry the fields.

## Comments

**Built:**
- `backend/app/matte.py`:
  - `MatteRunner.sweep(folder, used)`: removes from an item's MATTES_DIR the pieces (`*.mp4`) not in `used` (paths at the runner's version, so another version's, e.g. `rvm-mnv3-1`, are always removed), unused pieces' `.failed` files (a used piece's failure stays until its Retry), and leftover `.{stem}.{uuid}.part.mp4`. It leaves other files, and any piece being made now, with its part. The runner and a render both mark the piece they make in `_writing` (`_written`), under the runner's lock, which the sweep holds while it runs. It takes a folder and paths, so 06 can call it for a media item's folder.
  - `MatteRunner.idle(busy)`: a context manager, as `Narrations.idle`. It raises `MatteBusy` while a request is waiting, a piece is being made (by the runner or a render), and it holds the one-piece lock while the body runs.
  - `remove_mattes(folders)`: removes the folders whole.
- `backend/app/api.py`:
  - `get_job` passes the runner to `sweep_unused`, which now also sweeps the Source's pieces: those `matte_wanted` gives for every Candidate and every state in its Revision History.
  - `DELETE /api/models/person` runs inside `mattes.idle(...)`: 409 "A Matte is being made: remove the person model once it is done". On success it removes every Job's `mattes/` (`store.root.glob("*/mattes")`).
- Moving items: copy, paste, duplicate, Split and the Revision merge already carry `background_removal`, since they spread the item or merge it whole. No code change was needed; the tests pin it.
- Tests:
  - `backend/tests/test_matte_housekeeping.py` (5 tests): opening a Job sweeps unused pieces, failures, parts and the older version, and keeps a piece only the Revision History reads; a used piece's failure is kept; the sweep never removes a piece being made (a fake matter held mid-piece); removal is refused (409) while a Matte is being made and then removes every Job's Mattes; `idle`.
  - `frontend/src/pages/job/advanced/matteHousekeeping.test.ts`: copy and paste (same and another Candidate), duplicate, Split and `mergeEdits`.

**For 04/05 (fields):** add a case for the Segment's `background` (04) and the Overlay's `behind` (05) to `matteHousekeeping.test.ts`. They should pass as they are, since every one of these paths spreads the item. Split of an Overlay goes through `KINDS.overlay.cut`, which spreads the item too. Check the backend's MCP `merge_candidate_items` (it validates whole items).
**For 06 (media items):** call `mattes.sweep(<item's matte folder>, used)` for each media item that only this Job's Candidates use (as `sweep_unused` does for Retimed copies with `media_uses`), with `used` from the media's `matte_wanted`. Add the media folders to `remove_mattes(...)` in `remove_person_model`.
**For 07 (Reverse):** reversed Matte copies would be swept with Retimed copies' sweep, or in MATTES_DIR by extending `MatteRunner.sweep`'s recognised names.
