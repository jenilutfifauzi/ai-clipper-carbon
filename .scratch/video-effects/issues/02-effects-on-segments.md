# 02: Video Effects on Segments

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview", "Inspector UI", "API and MCP"); ADR 0014.

**What to build:** a Segment, of the Source or a media item, gets a stack of Video Effects, as an Overlay did in 01.
- **Where it applies:** to the Segment's whole frame (panels, picture and Background) after its Grade and before the joins. A Transition therefore crossfades pictures that already carry their effects.
- **Sizes:** the frame is 1080×1920 at scale 1, so its sizes are not scaled.

**The model:** Segments gain `video_effects`, with the same entry shape and validation as Overlays.

**The render:**
- A Segment with a non-empty, enabled stack is not "plain". Both the concat fast path and the collapse of a single plain Segment back into a range must count it.
- A Freeze frame takes effects like any other Segment.

**The preview:** the effects' SVG filters are chained after the Segment's Grade on the decks (and on media Segments), as the Grade's filter is applied there.

**The editor and the agent:**
- The Inspector's Effects section shows for a Segment. A mixed Pick of Segments and Overlays applies an action to all of them where their stacks are equal.
- `edit_candidate`, `merge_candidate_items` and `dry_run` cover Segments.
- Split copies the stack to both halves.

**Blocked by:** 01.

**Status:** done

- [x] Segments accept `video_effects`, and stored Candidates render the same command as before.
- [x] Seam B: the stack reaches the Segment's plan with its enabled entries only.
- [x] Seam A: Gaussian blur on a Source Segment and on a media Segment blurs the frame, and a blurred Segment between plain ones keeps its timing at a join and under a Transition.
- [x] A Segment with effects is not collapsed back into a range or put on the concat fast path.
- [x] The preview blurs the Segment on the decks and stops at its edges.
- [x] MCP and `dry_run` show Segment stacks, and the instructions mention Segments.
- [x] Vitest: split keeps the stack on both halves, and a mixed Pick of Segments and Overlays applies an action to both.

## Comments

Built for Segments of the Source and of a media item, Freeze frames included.
- **Backend:**
  - `Segment.video_effects`, checked by `checked_video_effects` as an Overlay's.
  - `SegmentInput.video_effects` carries it (`rendering.py`), and `SegmentPlan.video_effects` gets the enabled entries at scale 1.
  - `scaled_plan` scales Segment sizes too, for 720p and 4K.
  - `_segmented` (renderer) chains the stack after `grade_filters(segment.grade)`, at `(plan.width, plan.height)`, before fps/format and the joins.
  - A Segment with effects is not plain on the audio concat fast path (`_source_inputs`). It is not collapsed into a range either (`review.py`); a stack of disabled entries still counts, as with Audio Effects.
  - MCP: the dry run lists `video_effects` under `segments`, and the instructions have a paragraph on Segment stacks. The MCP budget test passes without a bump.
- **Frontend:**
  - `PictureRef` is now `"segment" | "overlay"`. `picturedItems` lists the picked Segments first, and `pictureOf` finds an item by ref. `repictured` returns an unchanged list as the same array.
  - `draftVideoEffects(plan, segments, overlays, kinds)`: Segment stacks are drawn at scale 1.
  - `frameEffectsFilter` in `editor/videoEffects.ts` and `useFrameFilter(grade, effects)` in `GradeFilters.tsx`.
  - `DecksGraded` takes `effects`, and the decks, the Transition ghost, `MediaSegment` and `CopiedSourceSegment` use it.
  - `EffectFilters` defines Segment filters with box `FRAME`.
  - `SegmentFields` has a `pictureEffects` slot after Color.
- **For 03:** add `"adjustment"` to `PictureRef` and to `picturedItems`, `pictureOf` and `repictured`.
- **Not verified in a browser:** the preview's blur on the decks. vitest and tsc cover the code paths only.

Review fixes: a Freeze frame now takes its Segment's `video_effects` with its Grade (`freezeFrame`). The Transition ghost's `DecksGraded` gets the Segment's `start`, so a timed stack's filter id matches the one `EffectFilters` defines. There is no test for the ghost's markup: it needs a DOM, which vitest here doesn't have.
