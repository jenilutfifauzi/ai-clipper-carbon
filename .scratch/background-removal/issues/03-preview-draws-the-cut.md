# 03: The preview draws the cut

**Parent spec:** `../spec.md` ("Preview"); ADR 0015, 0006 (two decks), 0009 (the per-Segment mapping).

**What to build:** in the Advanced Edit's preview, a cut-out Source Segment plays with only the speaker over its Background, in step with the picture, while playing, paused and scrubbing. Until a piece of its Matte is ready, that stretch shows the picture whole. The Grade and Video Effects look as they did on the whole picture.

**The mapping:** a pure TypeScript function takes the deck's time and gives the Matte piece and the frame within it, following the per-Segment mapping. It is pinned by a fixture shared with the Python side.

**The compositor:**
- A cut-out picture's video element is replaced by a canvas. The Matte pieces play on hidden videos following the picture's deck.
- On each `requestVideoFrameCallback`, the canvas draws the picture, turns the Matte's luminance into alpha, blurs it by the planned feather, and masks the picture with it.
- The Grade's and effects' SVG filters stay on the element. The Background (the picture blurred) is drawn under it.

**Blocked by:** 02

**Status:** done

- [x] vitest: the deck time → piece and frame mapping matches the shared fixture.
- [x] Across a join, a Transition and a seek, the Matte stays on the picture's frame (walkthrough, desktop and phone).
- [x] A piece that isn't ready shows the picture whole, and the cut appears when it lands.
- [x] A Segment far from the playhead holds no Matte videos.
- [x] `npm run typecheck && npm run build` pass.

## Comments

**Built:**
- Mapping: `matte_frame(source, fps) -> (piece, frame)` in backend/app/matte.py and its copy `matteFrame`/`matteAt`/`segmentMatte`/`matteSeek` in frontend/src/pages/job/editor/matteTime.ts. The Source's frame is `floor(source·fps + 0.5)`, its piece the one whose first frame `round(piece·fps)` is at or before it (as `Mattes.frames` counts). `segmentMatte` composes it with segmentTime's `sourceAt`, so Speed/Reverse/hold already map (07 uses it). Shared fixture `backend/tests/fixtures/matte_frames.json`, read by `backend/tests/test_matte_frames.py` (also checks the frame is one its piece holds) and `matteTime.test.ts`.
- Exposing the pieces (ADR 0001): `PreviewPlan.mattes: [{start, url}]` (editor.py `preview_mattes`, `/media/<job>/mattes/<subject>-<version>-<start>.mp4`), filled by the preview-plan endpoint from `MatteRunner.version` (`preview_plan(..., matte_version=)`, `_draft_plan(..., matte_version=)`). Listed whether made or not: the preview finds out by loading. Save frame / Compare render plans don't carry it. Frontend: `PreviewPlan.mattes?`, `MattePiece`, `RenderPlan.source_fps?`.
- Compositor `frontend/src/pages/job/editor/MatteCut.tsx`:
  - `DeckMatte` per deck (and one per Transition ghost): hidden videos only for the piece holding its master's frame and the next one within 2 s (so at most two per deck; nothing without cut-out Segments). Paused: the Matte video sits on the master's exact frame (`matteSeek`, mid-frame); playing: plays at the master's rate, moved back past `MAX_DRIFT_SECS`. A piece that 404s/fails is retried every 2 s with `?try=N`, and drawn whole meanwhile; when it lands the cut appears.
  - `cutSlot`: each picture slot (`PanelView`/`SlotVideo` with `cut`) gets a canvas styled exactly as its video (so Track/Split/Blur/Manual crop, scale, keyed placing and flips follow for free; the canvas holds the whole Source frame at the Matte's size). On each `requestVideoFrameCallback` of the picture or the Matte: picture drawn (`copy`), Matte luminance → alpha via getImageData on a mask canvas, `destination-in` with `ctx.filter = blur(feather in canvas px)` (feather × canvas width ÷ its width in output px). Pairs: exact frame while paused, within 3 frames while playing (redrawn when the right Matte frame arrives); "waiting" keeps the last cut instead of flashing the picture whole.
  - `CutGroup` sets `data-cut` when the shown Segment is cut out and its deck's pictures are cut; Tailwind `group-data-[cut]/cut:` swaps video→canvas, hides fills (Blur's blurred panel, a Manual Scene's Background slot), drops `DecksGraded`'s black (`className`), and shows `CutBackdrop`.
  - `CutBackdrop` (outside the Segment's Grade, inside the Candidate's): `backdropView` = a Manual Scene's Framing Background, else the Segment's `background` (colour) or the planner's `filled` crop, drawn from the shown deck's master at 1/8 size and CSS-blurred like Blur's fill.
  - Wired in ClipPreview (both decks) and PreviewTransitions' ghost (`mattes` prop).
- Tests: `test_background_removal.py::test_the_preview_plan_says_where_the_pieces_its_cut_out_segments_read_are_served`, `test_matte_frames.py`, `matteTime.test.ts`.

**Walkthrough** (ego-browser, desktop and Chrome phone emulation 390×844, a scratch copy of a real Job, backend from this worktree on :8010; fake Matte pieces made by ffmpeg thresholding the Source's luminance, so misalignment would show): a cut-out Segment (Split and Track Scenes) draws the cut over its blurred picture, paused and playing; the Matte video sits on the picture's frame after seeks; across a join into an uncut Segment with a Fade, the flag drops and the ghost crossfades the cut-out side; a Segment whose pieces aren't served shows whole and gets the cut within ~2 s of the files appearing; during play the flag no longer flickers. Not checked on a real iPhone/Safari (whose `ctx.filter` support decides whether the feather shows there).

**Deviations / notes:**
- The Background is drawn from the deck's video (no third video); a colour Background already works (`backdropView`), the image kind is 04's.
- `matte_pieces` is time-based while the frame rule rounds: a Freeze frame within half a frame before a 10 s boundary maps to a piece its `matte` list lacks (the preview then shows it whole; the render's `_matte_read` would read past its piece). For 07.
- Cost: one getImageData + loop per picture slot per frame at ≤1280 px (Split: two).

**For 04:** add `image` to `backdropView` / `CutBackdrop` (an `<img>` cover-filled in the box, under the canvas), the plan's `SegmentPlan.background` already reaches it.
**For 05:** Behind Overlays go between `CutBackdrop` and the `DecksGraded` inside `CutGroup` (ClipPreview and the ghost), visible with the cut (`group-data-[cut]/cut:visible`) or also where a non-cut picture doesn't cover the frame.
**For 06:** `MediaSegment`/Overlays need their own `DeckMatte` following their `<video>` (`attachMaster(video)`) and `cutSlot` on it; the pieces' listing would need per-item URLs (extend `PreviewPlan.mattes` with the item).
**For 07:** `CopiedSourceSegment` (Reverse, extreme Speed) isn't cut yet: its master plays a Retimed copy, so `DeckMatte.follow` must map copy time → Source time (`segmentMatte` / `sourceAt`) or follow a reversed Matte copy; decks at a browser-playable Speed already work (the Matte follows the master's Source time and rate). A held Source frame on a deck works (paused path).
