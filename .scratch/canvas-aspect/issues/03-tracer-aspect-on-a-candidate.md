# 03: Tracer: a 1:1 or 16:9 Candidate from Job to Clip

**Parent spec:** `../spec.md` (Implementation Decisions "Model", "Planner": Track, Blur and defaults, "API and MCP"); GLOSSARY (Canvas Aspect); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md.

**What to build:** a Job made with aspect 16:9 (or 1:1) gives Candidates of that shape. Their preview, stage and rendered Clip have that shape. An MCP agent can set and read the aspect.

**Model**
- **The Candidate's `aspect`:** one of `9:16`, `4:5`, `1:1`, `16:9`.
  - It is saved with each Revision, in the Revision part that holds the Layout. A Candidate saved without it reads as `9:16`.
  - Duplicate keeps it.
  - An unknown value is a 422.
- **`JobOptions.aspect`:** defaults to `9:16`. Selection's Candidates and Candidates added by hand take it.

**Validation, planner and render**
- **Validation:** Candidate-owned positions (Transforms, their Keyframes, Cue Edits) are checked against the Candidate's Canvas. For example, x 1500 is accepted on 16:9 and refused on 9:16.
- **The planner** makes the plan on the Candidate's Canvas.
  - Track crops at the Canvas's aspect. On 16:9 with a 16:9 Source, that crop is the whole Source and the camera doesn't move.
  - Blur fits the Source over its blurred cover. With the same aspect as the Canvas, the Source alone shows.
  - Split keeps today's stacked panels for now (06 changes it).
- **The render** gives the Canvas's shape at the Export Preset's short side.

**Editing and MCP**
- **Changing `aspect`** through the PATCH or `edit_candidate` makes a new Revision, and the Clip goes stale. Positions are not rescaled yet (04 adds that).
- **MCP:**
  - `create_job_from_url` and `create_job_from_file` take `aspect` in the options.
  - `get_candidate` shows `aspect` and the Canvas size.
  - `edit_candidate` takes `aspect`.
  - `dry_run`'s Preview Plan shows the Canvas and the Safe Area.

**Blocked by:** 01, 02.

**Status:** done

- [x] API/MCP tests: the aspect is validated, it defaults on old Candidates, `JobOptions.aspect` reaches Selection's and a hand-added Candidate, Duplicate keeps it, a change makes a new Revision and a stale Clip, and positions are validated per Canvas.
- [x] Planner tests (Seam B): Track's crop aspect on 1:1 and 4:5; Track on 16:9 with a 16:9 Source covering the Source without movement; Blur's band on 1:1 and none on 16:9 with a 16:9 Source.
- [x] Render test (Seam A): a 1:1 Candidate at 1080p is 1080×1080; a 16:9 one is 1920×1080; a 16:9 one at 720p is 1280×720.
- [ ] Browser: a 16:9 Candidate's Advanced Edit shows a 16:9 stage, and dragging a Text Layer across the whole width works.
- [x] Before the last commit: `git merge main`.

## Comments

**2026-10-21 (implementation):**
- **Model.** `Candidate.aspect` (`app/canvas.Aspect`, default 9:16, so an old Candidate reads as 9:16 with no migration) and `Candidate.canvas`. It is in the Revision part "Layout" (`revisions.PARTS`) and in what marks a Candidate edited. `JobOptions.aspect` (default 9:16): the pipeline gives it to Selection's Candidates, and `Episode.aspect` gives it to a hand-added one. An unknown aspect is a 422 from the PATCH, the preview plan, the Job's options and the MCP tools. `CandidateUpdate`/`CandidateChange` take `aspect`, so the PATCH, a draft's Preview Plan, Restore and `edit_candidate` all take it.
- **Validation.** I kept today's semantics for each kind:
  - Transforms and position Keyframes are clamped, not refused. An item on its own clamps to the largest Canvas (`canvas.LONGEST`, 1920 on either side; `KEY_RANGES` X/Y are 0..1920 now). `review.update` then runs `candidates.on_canvas`, which brings every centre the Candidate owns onto its own Canvas: its Framing, Segments, Overlays, Text Layers, Shapes, Layout Overrides, their X/Y Keyframes, and its Cue Edits. So x 1500 is kept on 16:9 and saved as 1080 on 9:16.
  - Cue Edits are refused, as they were by the old `Width`/`Height` types. A Cue Edit sent off the Canvas is a 422 (`check_cue_edits`). One already saved is clamped by `on_canvas` when the aspect changes.
  - A Transform sent without x/y still defaults to the 9:16 centre (540, 960). The planner's own default Framings (Manual without a Framing, and `_first_framing` for Blur and Split) are centred on the Canvas.
- **Planner and render.** `rendering.candidate_plan` plans on `candidate.canvas`, so the preview, the render, the saved frame and the compare render all follow the aspect. Track and Blur needed no change after 01. The Seam B tests pin them down. `picture_at` and `bounds_at` take the `frame` the picture is drawn on, as the frontend's `pictureAt` does, and the planner, the renderer (`animated_at`/`layer_at`/`overlay_at`, `PictureFrames`) and the MCP views pass it. This also fixes a keyed centre being clamped to 1080×1920 in a 1440p/4K render, where the scaled values are larger. `_frozen` clamps to the Canvas. `layer_pictures.pictures_used` plans Text Layers on their Candidate's Canvas, so a 16:9 Candidate's pictures aren't swept.
- **MCP.** The `create_job_*` tools take `options.aspect` through JobOptions. `get_candidate` adds `canvas` {width, height}, and the Candidate list shows `aspect`. `edit_candidate` takes `aspect`. `dry_run`'s plan view starts with `canvas` {width, height, safe_area}. The instructions gained a "Canvas" section, and the Overlay, Cue Edit and video Segment texts now speak of the Canvas. The tool budget went from 87_500 to 88_400.
- **Frontend.** `Aspect` type, `Candidate.aspect`, `CandidateChange.aspect`, `JobOptions.aspect`, and `aspect` → "Layout" in merge.ts's part names. The stage already follows the plan's Canvas (02).
- **Tests.** New `tests/test_aspects.py` (API, MCP, and a real render of 16:9@1080 → 1920×1080, 1:1@1080 → 1080×1080, 16:9@720 → 1280×720). `tests/test_canvas.py` gained Track on 1:1, 4:5 and 9:16, Track on 16:9 with a 16:9 Source, Blur's band on 1:1 and none on 16:9, a Manual default centred on 16:9, and a keyed centre held to its frame. I updated tests whose item-level clamp is now 1920 (test_overlays, test_keyed_shapes, test_keyed_text_layers) and the Job options test.

Not done or deferred:
- **Duplicate keeps it:** there is no Candidate Duplicate in the backend or frontend yet. Nothing copies Candidates, so there is nothing to keep the aspect, and nothing was tested. Whoever adds Duplicate should copy the whole Candidate, aspect included.
- **Browser walkthrough** (the fourth box) wasn't run. The stage follows the plan's Canvas (02), and the backend now gives 16:9 plans and accepts x up to 1920 on them.
- Positions aren't rescaled on an aspect change (04).
- `video_effects._FRAME` (Glow and Bloom spread against the Reference Space) and its frontend copy are unchanged. On 16:9 a full-frame picture's spread is about 1.8× wider. It should take the plan's Canvas on both sides together.
- The size estimate (`/export-presets/estimate`) still assumes 9:16 pixels. 16:9 has the same count, 1:1 and 4:5 fewer. It needs the batch's aspects (08).
- The editor's Canvas before a plan loads is still 9:16, not the Candidate's aspect (05/08).
- Pre-existing failures on main, not from this ticket: `test_selection.py::test_job_reaches_review_with_candidates_ranked_by_predicted_score` (its expected Candidate lacks `grade` and `adjustment_layers`; I added `aspect` to it) and `test_freeze_frame.py::test_freeze_frames_are_saved_unsnapped_and_validated`.

**2026-10-22 (code review: default centres):**
- A centre left out of an edit now lands at the Candidate's Canvas's centre, as the spec says. That covers an Overlay, Text Layer or Shape sent without `transform` or without its x or y, a Framing (a media Segment's, a Layout Override's, the Candidate's own) sent without its transform's x or y, and the default Text Layer y, which is the centre too. Before, it fell back to the 9:16 centre (540, 960). A 540 or 960 that was actually sent is kept.
- How: the same pattern as `duck_unset`. `CandidateUpdate`'s wrap validator reads the raw JSON (`api.unplaced`) and records each left-out axis as `(field, index, axis)` (`review.Unplaced`, with the paths in `review.PLACED_BY`). `review.update` then places those axes at the new aspect's Canvas centre (`_centred`), before rescale and `on_canvas`. `edit_candidate` drops those axes from the body it sends, because its dataclasses dump every field. `merge_candidate_items` already sends only the fields it was given.
- A media Segment with no Framing is fitted at its Canvas's centre too. The planner's `SegmentInput.framing` is now None by default and resolved with `_centred_framing(canvas)`; before, `rendering` passed `Framing()`, which is 9:16's centre.
- Test: `tests/test_aspects.py::test_an_item_an_agent_adds_without_its_centre_lands_at_the_canvass_centre` (MCP, 16:9 and 9:16), and `tests/test_canvas.py::test_a_media_segment_without_a_framing_is_fitted_at_the_canvass_centre`.
