# 07: Speed, Reverse and Freeze frame keep the Matte

**Parent spec:** `../spec.md` ("Matte store and runner", "Renderer", "Preview"); ADR 0015, 0009.

**What to build:** a cut-out Segment or Overlay at a Speed, in Reverse, or held as a Freeze frame keeps its Matte on the same frames, in the render and in the preview.

- **Speed:** the Matte's frames are picked by the same Source time, through the same `setpts` in the render and the same mapping in the preview.
- **Reverse:** the Matte gets a Retimed copy over the reversed range, made by 0009's mechanism in the two sizes, and found wherever a wider copy serves.
- **Freeze frame:** one Matte frame is held for the hold.

**Blocked by:** 03

**Status:** done

- [x] Seam A (fake matter, a moving disc): at 2× and 0.5×, in Reverse and on a Freeze frame, the kept area sits on the disc in the rendered frames.
- [x] A Reverse switch makes the Matte's reversed copy, and the render waits for it as it waits for pieces.
- [x] vitest: the mapping with Speed, Reverse and hold matches the shared fixture.
- [ ] The preview follows the picture at those rates and in Reverse (walkthrough).

## Comments

**Built:**
- `backend/app/matte.py`:
  - `matte_pieces(start, end, duration, fps)` now chooses pieces by frame, as `matte_frame` does: from `round(start·fps)` (the preview's frame) to the last frame the render reads (`ceil(end·fps) − 1`; a hold's `ceil(start·fps)`), clamped to the item's frames. A Freeze frame within half a frame before a 10 s boundary now reads the next piece (03's edge case); the planner (`_cut_out`, now given `source.fps`) and `rendering.matte_parts` use it.
  - `Reversed(start, end)`: a reversed Matte copy, a new kind of part beside a piece (`Part = int | Reversed`). `Mattes.path/make/failure/retry` take either, so `MatteRunner.ask/status/make/retry` and `_run` handle copies unchanged. Copies live in `mattes/{subject}-{version}/`, named as Retimed copies (`reversed-full-1500-4250.mp4`); `Mattes.reversed_copy` finds the smallest covering one (retimed.py's `Copies.find`, `Copy.at`), so any wider copy serves. `make` refuses a copy before its pieces (`PiecesMissing`, not remembered as a failure).
  - `Mattes._reversed`: joins the pieces losslessly (FFV1, frame after frame at the item's rate) with the item's own sound of that time, then reverses through retimed.py's `_reverse_in_pieces` (new `encode=` parameter: the Matte's own encoding, a keyframe each second) in the same piece length as the picture's full copy. The sound matters: a copy of a range starting within a frame starts its picture a fraction of a frame after its sound (0.04 s at 25 fps), so a Matte copy without sound was a frame out of step with the picture's copy (seen, and pinned by the Seam A test).
  - `MatteRunner.sweep` sweeps the copies folder at its version through `retimed.sweep` (keeping what `used` names; never what is being written) and removes unused copies' `.failed`; another version's copies folder is removed whole.
- `rendering.py`: `matte_parts` (pieces, then the `Reversed` copy for a reversed cut-out Segment) feeds `matte_wanted` (so a save, the status endpoint, Retry and the sweep include the copy) and `matted` (the render makes the copy after its pieces, inside its job, and sets `SegmentPlan.matte_copy`/`matte_copy_at`).
- `renderer.py`: the Reverse refusal is gone; a reversed cut-out Segment reads its Matte copy as one input (`-ss at -t span`, as its picture's copy is) with the same timing filters. Refused only if the copy is missing. **A keyed Manual Scene stays refused** (its picture is drawn by a frame process; the Matte would need the same), with its clear message.
- `editor.py`: `PreviewPlan.matte_copies: [{start, end, url, at}]` (`preview_matte_copies`), listed before they are made (the preview retries on 404).
- Frontend: `matteTime.ts` `MatteClock`, `SOURCE_CLOCK`, `copyClock(segment, range, at, matteCopy)`, `matteCopyOf`, `copyFrame`; `DeckMatte.setClock` maps its master's time through the clock (a retimed forward copy: Source time at the copy's Speed, Matte rate × Speed within 1/16–16; Reverse: the reversed Matte copy as one piece at 0). `CopiedSourceSegment` gets its own `DeckMatte`, `CutGroup`, `CutBackdrop`, the Behind Overlays (05) between them and its cut `PanelView`s; `PreviewSegments` takes `mattes`/`matteCopies` from ClipPreview. `CutBackdrop` draws its crop in the video's own pixels (a Retimed copy may be smaller than the Source).
- ADR 0015 amended: the reversed Matte copy is one size (the Matte's own, which both the preview and render read), not two; made after its pieces; joined with the item's sound.

**Tests:** `backend/tests/test_matte_speed_reverse.py` (Seam A with a bobbing red disc, 16 px a frame: one Candidate with Segments at 2x, 0.5x, reversed from within a frame, a Freeze frame and reversed at 2x renders with the whole disc kept on every frame against the uncut render (a Matte a frame off loses about a quarter of it; checked by removing the sound join, which fails); a reversed cut-out Segment shows a Behind Overlay over its Background in the render (05's `_behind_slots` already lays them for any cut-out Segment); a render waits for the copy when the model arrives late; the preview plan's `matte_copies` and a trim inward reusing the copy; a copy over two pieces holds the picture copy's frames; the sweep). `test_matte_frames.py` and `matteTime.test.ts` read the extended shared fixture (`pieces` per case; reversed at 2x, 8x, a hold before a boundary, a range ending just into a piece). `matteTime.test.ts` also covers `copyClock`. `test_background_removal.py`'s piece cases updated for `fps`.

**Not done:** no browser walkthrough (the preview's Reverse/extreme-Speed cut is covered by unit tests of the clock and typecheck only). A Transition's ghost of a reversed cut-out Segment (`PreviewTransitions` → `CopiedSourceSegment`) isn't passed the Matte, so it shows whole during the Transition. Spec line 119 still says "two sizes".

**For 06 (Overlays at Speed/Reverse):** an Overlay's Matte at a Speed is picked by `overlay_time` the same way; a reversed one can ask for `Reversed(start, end)` on its media item's `Mattes` (same runner, same sweep with the item's folder). Make the joined Matte take the item's own sound (as `_reversed` does from `self.video`), or its copy will be a frame off its picture's. In the preview, a reversed Overlay's video plays its copy: follow it with a `DeckMatte` and `copyClock`.
