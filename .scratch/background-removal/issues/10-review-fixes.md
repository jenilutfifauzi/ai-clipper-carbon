# 10: Review fixes: the plan carries the Matte's numbers, and the cut is the same in the preview and the render

**Parent spec:** `../spec.md`; ADR 0001, ADR 0015. From the branch's code review (2026-10-22).

**What to build:** the fixes the review found. After them, the preview and the render agree on every cut-out item, and no Matte number is copied by hand into the frontend.

- **ADR 0001:** the frontend hardcodes `MATTE_SIDE = 1280`, `MEDIA_FPS = 30` and `MATTE_PIECE_SECS = 10`, copied from the backend. The Render/Preview Plan must carry what the preview needs instead: the Matte's frame rate per item (the Source's, or the media item's real rate), its size, and its piece length.
- **Media frame rate:** Media Library Mattes are read at 30 fps. Check whether every Media Library video really is normalized to 30 fps on import (`media.py`). Either way, use the item's own rate, from the plan.
- **One fallback:** `matte_pieces` silently falls back to 30 fps when fps is 0, but `matte_frame` doesn't. Make the two agree (one rule, in one place).
- **Keyed pictures:** a cut-out Segment whose picture has Keyframes (a keyed Manual Scene or media Segment) is refused only at render, while the preview cuts it. Refuse it on save, naming the item, so the owner learns at once. The preview and the render then never disagree. If drawing it turns out to be cheap, drawing it in the render is also acceptable.
- **Feather scale:** the planner scales the feather by the Manual Framing only when the Candidate's own Layout is Manual. A Segment in a Manual Layout Override must use that override's Framing scale. A Track or Split override of a Manual Candidate must not use the Manual scale.
- **Sweep:** `sweep_unused` sweeps only media items still referenced by the Job's states. Matte pieces of a media item that no Candidate (nor its Revision History) uses any more must be swept too. Keep the rule that pieces an item still needs for another Job are kept, as for Retimed copies.
- **Drafts ask for the Matte:** a draft that turns Background removal on, or changes a range, asks for the pieces, as a save does (the spec's "saves and drafts").
- **Spec:** `../spec.md` still says CoreML runs ahead of the CPU. Bring it in line with ADR 0015 (CPU, until 13 lands).

**Blocked by:** 01–09

**Status:** done

- [x] The preview reads every Matte number from the plan; no backend constant is duplicated in the frontend (the shared `matte_frames.json` fixture stays).
- [x] A media item at another frame rate (e.g. 25 fps) is cut on the right frames in the render and the preview mapping (Seam A + vitest).
- [x] A keyed cut-out picture is refused on save with a message naming it (API and MCP), or drawn correctly in the render.
- [x] The feather of a Segment in a Manual Layout Override is scaled by its Framing; a Track override in a Manual Candidate isn't (Seam B).
- [x] An unreferenced media item's Matte pieces are swept; pieces another Job needs are kept.
- [x] A draft with Background removal on asks for the pieces.
- [x] The spec matches ADR 0015.

## Comments

**2026-10-22, done.**

- **The plan carries the Matte's numbers (ADR 0001):**
  - Each Preview Plan piece (`editor.MattePiece`) now has `fps` (its item's Matte rate: the Source's, or the video's own) and `piece_secs` (`matte.PIECE_SECS`).
  - `DeckMatte.setPieces(pieces)` takes both from the pieces. `matteFrame`, `matteAt` and `segmentMatte` take `pieceSecs`.
  - `MATTE_SIDE`, `MEDIA_FPS` and `MATTE_PIECE_SECS` are gone from the frontend, and so are the `plan.source_fps || plan.fps` arguments.
  - The canvas is drawn at the Matte frame's own size (`videoWidth`/`naturalWidth`). That frame is the Matte's size, so a plan field would only repeat it. The old `min(width, 1280)` capped only the width, which was wrong for a portrait item.
  - The shared fixture gained `"piece_secs": 10`. `test_matte_frames.py` checks it against `PIECE_SECS`, and `matteTime.test.ts` reads it.
- **Media frame rate:** every Media Library video has been normalized to `media.FPS` = 30 fps on import since the Library's first commit (144ac77). So no item kept at another rate exists today. The rate was still a constant read twice (`MediaStore.retimed` and `.mattes`).
  - `MediaItem.fps` is now recorded at import, from ffprobe's `avg_frame_rate` of the kept file. `MediaItem.rate` is `fps`, or `UNRECORDED_FPS` (30) for an item added before it was recorded.
  - Both `Mattes` and the Retimed `Copies` of an item use `item.rate`, and the plan's pieces carry it.
  - The Seam A test imports a video while `media.FPS` is 25, restores it, then checks the item's Matte (25/1, 50 frames) and that the render keeps a moving disc whole. With 30 forced it fails by about 15%. The vitest checks `DeckMatte` takes 25 fps from its pieces, and the 25 fps mapping.
- **One fallback:** `matte.matte_rate(fps)` (FALLBACK_FPS 30 when the rate is 0) is used by `matte_pieces` and `matte_frame`. `Mattes` stores its rate through it, so `rendering.matted`'s own copy of the fallback is gone, and the preview reads the rate after the fallback.
- **Keyed pictures: refused on save, not drawn.** Drawing them would mean cutting in the Scene's frame process (`VideoDecode` already takes a `KeyedMatte` for Overlays). But the Segment's Grade, Video Effects, Background and Behind Overlays are laid in `_cut_out`'s still chain, so it isn't cheap.
  - `review._check_cut_out_pictures` raises InvalidEdit (422) when an edit changes `segments` or `layout_overrides`. It refuses a cut-out media Segment with picture Keyframes, or a cut-out Source Segment (not a Freeze frame) whose range holds a Manual Layout Override with Keyframes (`start <= at <= end`, as `candidate_plan` gives them).
  - The message: "Segment X is cut out (Background removal) but its picture has Keyframes, which Background removal can't draw yet: remove its Keyframes or switch Background removal off".
  - Drafts go through `review.update`, so the preview is refused alike. MCP's `merge_candidate_items`/`edit_candidate` get the same message.
  - The renderer's `_check` stays as a guard. It is a little looser: an override whose Keyframes all fall past its Scene's end is refused on save but would render.
  - A stored Candidate that already has one still loads. Its next Segment or Override edit is refused until it is fixed.
- **Feather scale:** `planner._cut_out` takes the Segment's first Scene (`framed[0]`). A Manual or media Scene scales the feather by its Framing (a Manual Layout Override's, or the Candidate's). Track, Split, Blur and pass-through scale it by 1, even in a Manual Candidate.
  - One feather per Segment: a Segment whose Scenes are framed differently takes its first one's.
- **Sweep:** `sweep_unused` now sweeps the Matte folder of every video and image in the Library that no other Job's Candidates use, not only those this Job's states name. So an item nobody uses loses its pieces. It works out the other Jobs' items once, rather than calling `media_uses` per item. Pieces an item needs for another Job are kept. Retimed copies keep their old rule (only items this Job names), as the ticket asked.
- **Drafts ask:** the preview-plan endpoint with a body adds `ask_mattes` for the drafted Candidate as a BackgroundTask (`_draft_plan(..., drafted=)`). MCP's `dry_run` goes through it too. Save frame and Compare render don't ask: they make their pieces in their own job.
- **Spec:** CPU (CoreML MLProgram is 13's), the image's own size, the plan-carried numbers and the keyed refusal. ADR 0015's preview bullet now says the plan gives the rate and the piece length.
- **Tests:**
  - Backend: `test_matte_frames.py` (piece length, one fallback), `test_background_removal.py` (feather in overrides, the draft asks, keyed override refused in save, draft and Override edit, pieces' `fps`/`piece_secs`), and `test_media_background_removal.py` (25 fps item, sweep of an unused item kept for another Job, the agent refused a keyed media Segment).
  - Frontend: `matteTime.test.ts`.

**For 12 (Behind on a mixed Pick, the stage):** nothing here touches the Behind switch or `stagePictures`. A `MattePiece` now needs `fps` and `piece_secs` in any test fixture.
**For 13 (CoreML MLProgram):** `matte_rate` is the one fallback, and the matter only sees frames. A version bump changes the piece URLs through `MatteRunner.version` as before, and no frontend change is needed. The fixed-shape copy per Matte size can take its size from `Mattes.size()`. A Source smaller than 1280 px keeps its own size, so expect more than one size.
