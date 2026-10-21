# 05: Glow, Bloom pulse and Film grain

**Parent spec:** `../spec.md` ("Catalogue", "Time", "Renderer", "Preview"); ADR 0014.

**What to build:** the Light effects and the two effects that change over time.

| Effect | Category | Settings | Render | Preview |
|---|---|---|---|---|
| Glow | Light | amount 10–100% (45) | blur a quarter-size copy, scale it back, screen it on, mix by amount | blur, then a screen blend, then mixed |
| Bloom pulse | Light | amount 0–100% (50), speed 0.5–5 (2) | highlights only, blurred at quarter size, screened on; strength `amount·(0.6+0.4·sin(time·speed))` | the same; its strength is set on Playback's frame |
| Film grain | Stylize | amount 2–40 (12) | noise with a new pattern every frame | turbulence noise, reseeded on Playback's frame |

**Time:** counted from the item's start on the Timeline, as a Keyframe's `at` is. Moving the item takes its pulse with it.

**Still images:** an image Overlay with Bloom pulse or Film grain is read as a looping stream over its span, so the grain moves. This applies in both the plain chain and the keyed frame process. Without such an effect, an image is still drawn once.

**Blocked by:** 01, 03.

**Status:** done

- [x] Each effect's chain runs at its default, minimum and maximum over a 1 s 1080×1920 clip, keeping its size and length.
- [x] Seam A: Film grain makes two consecutive frames of a still image Overlay differ.
- [x] Seam A: Bloom pulse makes a bright area's brightness vary with its period, and moving the Overlay later in the Timeline moves the phase with it.
- [x] Seam A: Glow brightens the area around a bright shape.
- [x] Seam A: a keyed image Overlay with Film grain also changes from frame to frame.
- [x] The preview's grain moves and its pulse throbs while playing, and both are still when paused.

## Comments

Built: Glow and Bloom pulse (Light) and Film grain (Stylize) in `app/video_effects.py`, with their SVG imitations in `editor/videoEffects.ts`. They draw on Segments, Overlays, Adjustment Layers and keyed pictures.
- **Time:**
  - A builder now takes a third argument, a `Clock(start, rate)`. `clock.of("t")` (or `"T"` for geq) is the item's own time.
  - `video_effect_chain(..., clock=)` passes it on. The renderer gives a video Overlay `Clock(rate=1/speed)`, because its effects run before its frames are moved onto the Timeline. An Adjustment Layer gets `Clock(event.start)`, and the frame process `Clock(self.start)`. A Segment's frames start at 0.
  - `Effect.timed` and `changes_with_time(stack)` mark the two time-dependent effects.
- **Builders:**
  - Glow and Bloom pulse use `_screened`: a planar-RGB copy is scaled to a quarter, blurred, scaled back and screened on with `blend`, keeping the alpha.
  - The spread is 16 / 12 px at the fitted size (`GLOW_SIGMA`, `BLOOM_SIGMA`). It grows with the drawn size (max of w/1080, h/1920).
  - Glow's amount is the blend's opacity, which is the same as screening the light times the amount.
  - Bloom pulse weights its highlights and sets its strength over time in one `geq` at the quarter size (its `T`).
  - Film grain is `noise` on the luma only, uniform ±amount/255, with a new pattern each frame. The pattern counts frames from the first one the filter draws, and a layer's frames outside its span don't advance it.
- **Still images:**
  - `_looped(event)` (renderer) reads an image Overlay with a timed effect as `-loop 1 -framerate <fps> -t <span>`, moved to its start.
  - When keyed, `_keyed_items` hands its file to `VideoDecode(..., looped=True)` in place of `graded_image`.
- **Preview:**
  - `Primitive.timed(time)` gives the attributes that change: seed for the grain, k2/k3 for the pulse's mix.
  - `EffectsClock` in GradeFilters.tsx, around ClipPreview's stage, gives the playback. `TimedPrimitive` writes those attributes on every `playback.subscribe` call, from the time shown less the item's start.
  - Filter ids of a timed stack include the item's start (`effectsFilterId(effects, box, start)`). `start` is threaded through `useFrameFilter`, `DecksGraded`, `PicturePanel`, `EffectFilters`, `GradeFilter` and `AdjustmentFilter`.
  - The Effects tab cards (08) can render without an `EffectsClock`: they draw as at time 0.
- **Near:**
  - The grain's look and size are only near the render's. `feTurbulence`'s baseFrequency is per CSS pixel in Chrome, whatever the primitive units.
  - Bloom's highlights come from a luma table and a multiply.
- **Not verified in the app:** the per-frame repaint. vitest checks the markup at the times shown, and headless Chrome checked a static page of the three filters.
- **Cost (for 10):** Glow takes about 1.4 s and Bloom pulse about 2.5 s per second of 1080×1920, mostly the format change to gbrap, the blend and the geq.
