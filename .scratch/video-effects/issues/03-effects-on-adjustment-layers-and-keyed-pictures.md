# 03: Video Effects on Adjustment Layers and on keyed pictures

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview"); ADR 0014, ADR 0008.

**What to build:** two remaining routes a stack has to take.

**Adjustment Layers:**
- An Adjustment Layer gets a stack of Video Effects. It applies after the layer's Grade, over the Main Track and the Overlays under its span, and under the Watermark, captions, Shapes, Text Layers and hook.
- The effects are mixed back together with the Grade by the layer's strength times its fades.
- A layer may have a neutral Grade and only effects.
- Overlapping layers still apply one after another.

**Keyed pictures:**
- A media Segment, an Overlay or a Manual Scene with Keyframes is drawn by the frame process (ADR 0008).
- Its stack runs in the decoder after its Grade, at scale 1, before the animated scale. A keyed picture therefore shows the same effects as an unkeyed one at the same scale.

**The preview:**
- An Adjustment Layer's effects are chained after its Grade on the layer's wrapper.
- A keyed picture's effects are on the same element as its Grade.

**The editor and the agent:**
- The Inspector's Effects section shows for an Adjustment Layer.
- `edit_candidate`, `merge_candidate_items` and `dry_run` cover `adjustment_layers[].video_effects`.

**Blocked by:** 01.

**Status:** done

- [x] Adjustment Layers accept `video_effects`. Stored Candidates are unchanged.
- [x] Seam B: an Adjustment Layer's enabled stack reaches its plan.
- [x] Seam A: a blur on an Adjustment Layer blurs the Main Track and an Overlay only within the layer's span, and not the captions or a Text Layer.
- [x] Seam A: the layer's strength at 0 leaves the frame unchanged, and a fade blends in the blur.
- [x] Seam A: an Overlay with Keyframes and Gaussian blur renders like the same Overlay unkeyed at the frame where they are equal.
- [x] The preview shows an Adjustment Layer's blur over its span, mixed by strength and fades.
- [x] MCP and `dry_run` cover Adjustment Layer stacks.

## Comments

Built for Adjustment Layers and for keyed (or animated) Overlays; keyed media Segments and Manual Scenes already had their effects from 02, through their Segment's whole-frame chain.
- **Backend:**
  - `AdjustmentLayer.video_effects` (checked as an Overlay's), `AdjustmentEvent.video_effects` (enabled, scale 1). `scaled_plan` scales them with the frame.
  - `_adjustment` (renderer) takes the frame size and chains the stack after `grade_filters` on the split branch, before the strength and fades. A neutral Grade with effects is no longer skipped.
  - `video_effect_chain(stack, size, enable=None)`: with `enable`, each lone filter gets `enable='…'`, so a layer's blur costs nothing outside its span. A part with labels (`[`, `;` or `,`) is left without it: correct, only slower. Later builders that use `split`/`blend` fall into that case.
  - `EFFECTS_FORMAT = "yuva444p"`: a non-empty chain now starts with `format=yuva444p`.
    - Without it, `gblur` on 4:2:0 spread colour twice as far as brightness, so the still chain and the frame process (RGBA) differed.
    - RGB (`gbrap`) was tried and broke a Transition's xfade (range), so the format is YUV with full-resolution planes.
    - This changes how 01 and 02 blur, slightly, for the better.
  - Frame process (`frames.py`):
    - `VideoDecode(..., graded, effects)` runs the stack after the Grade at its decode size.
    - `graded_image(..., effects)` runs it on the item's own pixels.
    - `_effects_at` scales the planned sizes by (pixels worked on / planned drawn width), so the sampled scale shrinks them as an unkeyed picture's would.
  - MCP: the dry run lists `video_effects` under `adjustment_layers`, and the instructions have a short paragraph on them. The tools budget went to 86_700.
- **Frontend:**
  - `PictureRef` includes `"adjustment"`, as do `picturedItems`, `pictureOf` and `repictured`.
  - `AdjustmentLayerFields` takes `pictureEffects`.
  - `draftVideoEffects(plan, segments, overlays, kinds, layers = [])`.
  - `AdjustmentFilter` has `effects`, and `grade` may be null: in the original view only the effects are drawn, as a Segment's stay.
  - `GradeFilter` takes `effects` and `box`. It switches to `primitiveUnits="objectBoundingBox"` when it has any, and draws them after the Grade and before the mix composite.
- **Deferred to 05:** a still image whose effect changes with time (grain, pulse) taking the looping route in the frame process. No such effect exists yet.
- **Near:**
  - The Seam A test checks a Text Layer only; the captions are burned later in the same chain.
  - The preview's layer blur fades at the frame's edges, as 01 noted for Overlays.
- **Not verified in a browser:** the preview's blur on the wrapper. vitest and tsc cover the code paths only.

Review fixes:
- **A layer's effects run on its span alone.** `_adjustment` takes `fps`, and `_spanned` keeps the effected branch to the span: `trim` ends it just past the span, and `select` keeps the frames `enable` picked. `tpad` stands in transparent frames from the Clip's start, and a `setpts` sets them back before the span; without them, the overlay held back every frame before the span. The frames are the same as the chain's on every frame (a Seam A test checks this with Chromatic aberration), and the render is about 2 to 3× faster for a 1 s layer. A layer with a Grade alone gives the same command as before. This replaces 04's note that a part with labels runs on every frame of a layer.
- **Keyed stretched pictures.** `_effects_at` now scales by the pixels per drawn pixel along the picture's more stretched axis, which is the axis `overlay_scale` takes its size from. Before, it used the width alone. Along that axis the effect is as wide as an unkeyed picture's; along the other it is narrower, stretched with the picture. Unkeyed, it is the same on both axes.
