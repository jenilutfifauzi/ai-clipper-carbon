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

**Status:** ready-for-agent

- [ ] Adjustment Layers accept `video_effects`. Stored Candidates are unchanged.
- [ ] Seam B: an Adjustment Layer's enabled stack reaches its plan.
- [ ] Seam A: a blur on an Adjustment Layer blurs the Main Track and an Overlay only within the layer's span, and not the captions or a Text Layer.
- [ ] Seam A: the layer's strength at 0 leaves the frame unchanged, and a fade blends in the blur.
- [ ] Seam A: an Overlay with Keyframes and Gaussian blur renders like the same Overlay unkeyed at the frame where they are equal.
- [ ] The preview shows an Adjustment Layer's blur over its span, mixed by strength and fades.
- [ ] MCP and `dry_run` cover Adjustment Layer stacks.
