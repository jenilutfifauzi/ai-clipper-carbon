# 07: Safe Areas per aspect, and Styles in the Reference Space

**Parent spec:** `../spec.md` (Implementation Decisions "Two coordinate spaces", "Planner": hook and Watermark, "Frontend": dragging captions, "API and MCP": documentation); GLOSSARY (Reference Space, Safe Area).

**What to build:** captions, the hook and the Watermark sit right on every aspect, from one Style Preset.
- **Safe Areas:** 4:5, 1:1 and 16:9 use their own Safe Area from the Canvas module.
  - Captions' Top, Bottom and Custom places, the hook's places and the Watermark's nine places are clamped to the Safe Area or resolved against it.
  - The stage's guides show it.
- **The Reference Space:** Caption, Hook and Watermark Styles' `x`, `y` and Custom places, in Presets and Style Overrides, stay in 1080×1920.
  - The planner maps them onto the Canvas in proportion.
  - Sizes are not mapped.
  - Existing Presets are untouched.
- **Widths:** caption and hook widths come from the Safe Area, capped at their 9:16 widths.
- **Dragging on the stage:** dragging a caption, the hook or the Watermark converts the stage's Canvas pixels into the Reference Space before writing the Style Override. The drop shows exactly where it was dropped.
- **MCP documentation:** rewrite the tools' text that says "0..1080, 0..1920" and "1080x1920 frame". Candidate positions are in the Canvas's pixels, and Style positions are in the Reference Space.

**Blocked by:** 03.

**Status:** done

- [x] Seam B tests: a Custom caption y and a Watermark x mapped on 16:9; the hook's Top inside the 16:9 Safe Area; the nine Watermark places inside each Safe Area; caption and hook widths capped on 16:9; 9:16 unchanged.
- [x] Seam A: on a 16:9 render, a caption lands at its mapped place inside the Safe Area (sampled pixels).
- [x] vitest: the caption and hook drag conversion to the Reference Space round-trips on 16:9 and 4:5.
- [x] MCP test: the tool documentation mentions the Canvas and the Reference Space, not 1080x1920.

## Comments

**2026-10-21 (implementation):**
- **Safe Areas.** Captions' Top, Middle and Bottom, the hook's places and the Watermark's nine places already resolve against `canvas.safe_area` since 01. This ticket pins them down on every aspect. The stage guides come from the plan's Safe Area (02).
- **Widths.** `Canvas.caption_width` is the Safe Area's width either side of the frame's middle, capped at `CAPTION_WIDEST` (9:16's 820). `caption_x` centres it. It is 820 on all four aspects (x 550–1370 on 16:9), so `hook_width` and `kicker_widest` follow at 748 and 820. A hook fits the same lines at the same size on every aspect, so `review.fit_hook`'s warning on the default Canvas still holds.
- **Reference Space.** `Canvas.x_from_reference`/`y_from_reference` round x·W/1080 and y·H/1920 to the pixel (on 9:16 they return the value itself). The planner maps the Caption Style's Custom y and its x, the Hook Style's Custom y and its x, and the Watermark's Custom x and y. Cue Edits' x and y are the Candidate's own and stay in Canvas pixels. Sizes aren't mapped.
- **Fractions in Style places.** `styles.Width`/`Height` are now `int | float`, with the same Reference Space limits, and an int stays an int. A whole Reference place can't land on every Canvas pixel: 1920 px across on 16:9 have only 1080 Reference values. So a drag keeps its Reference place to a hundredth of a pixel, and the planner maps it back onto the exact pixel it was dropped on. Existing Presets and Overrides are unchanged. The style panels' sliders round the value they show.
- **Stage drags.** `canvas.ts` has `toReference` and `fromReference`. `placing.ts`'s `placedFields`/`placedOverrides` take the Canvas and write the Reference place. The new `watermarkPlaced` does the same for the Watermark's drag in CandidateEditor. AdvancedEdit (the hook), `cuePlace.placedCaptions` (the captions) and CandidateEditor pass the plan's Canvas. The stage's `Place` stays in Canvas pixels, which a Cue's own move (its Cue Edit) keeps.
- **MCP.** The instructions' Canvas section now explains the Reference Space: Style places of Presets and style_overrides, the x·W/1080 and y·H/1920 mapping with an example, sizes not mapped, anchors in the Safe Area, and captions and hook 820 px at most. A Segment's effects frame is "the Canvas at scale 1". The `candidates.py` comments on Video Effects' frame now say Canvas. The tool budget is unchanged (the instructions don't count toward it).
- **Glow and Bloom (leftover from 03).** `video_effects._FRAME` is gone. Builders take the `frame` the picture is drawn on (the Canvas at its own size, short side 1080, from `canvas.unscaled` of the drawn plan's size), and `_screened` measures the spread against it. The renderer passes it for a Segment's, an Overlay's and an Adjustment Layer's stack, `graded_image` and `VideoDecode` for keyed Overlays. The default is the Reference Space, so 9:16 is unchanged. In the frontend, `lightBlur` takes the Canvas too. `effectPrimitives`, `effectsFilterId` and `effectsFilter` take it as a last argument (9:16 by default) and include it in the filter's id. EffectFilters, GradeFilter, PicturePanel, EffectCard and adjustmentFilters pass the plan's Canvas.
- **9:16 regression.** I compared the same 329 whole 9:16 plans as in 06 before and after (Custom caption, hook and Watermark places included). They are identical.
- **Tests.**
  - `tests/test_canvas.py`: a Custom caption place mapped on 16:9 with its size kept, and itself on 9:16; a Cue Edit's place left in Canvas pixels; a Custom Watermark mapped with its size kept; a Custom hook mapped; the hook's Top inside each Safe Area; the nine Watermark places inside each Safe Area; caption and hook widths capped on 16:9 with the same lines and size.
  - `tests/test_aspects.py`: a real 16:9 render whose orange caption lands at (480, 720), the mapped (270, 1280), inside the Safe Area; and the MCP documentation test.
  - `tests/test_light_and_time_effects.py`: Glow's and Bloom's sigma is the same for a full frame on 9:16, 16:9 and 1:1, and twice as large at 4K.
  - vitest `editor/canvas.test.ts`: `toReference` on 16:9, 4:5 and 9:16; the round trip back to the same pixel over a grid on 16:9 and 4:5; and `placedFields`/`watermarkPlaced` writing Reference places.
  - `advanced/videoEffects.test.ts`: the light spread on 16:9 equals 9:16's, and the filter id carries the Canvas.
  - Backend files run: test_canvas, test_aspects, test_planner, test_watermark, test_styles, test_video_effects, test_adjustment_video_effects, test_segment_video_effects, test_light_and_time_effects, test_render_sizes, test_mcp, test_cutout_effects, test_blur_distort_stylize_effects, test_effected_copies. All pass. `npm run typecheck` and `npm run build` (1543 tests) pass.

Not done or deferred:
- **Browser walkthrough** wasn't run, because no dev server was up.
- **Slider ranges.** The Caption and Hook Style panels' sliders still use 9:16's Safe Area as their Reference Space limits. On another Canvas the planner then holds the mapped place inside that Canvas's own Safe Area, so a slider's ends can sit a little past where the place stops.
- **The Watermark's own size and the Logo's** are pixels, as the spec says, so they are the same on every aspect.
