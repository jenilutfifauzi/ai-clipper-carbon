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

**Status:** ready-for-agent

- [ ] Each effect's chain runs at its default, minimum and maximum over a 1 s 1080×1920 clip, keeping its size and length.
- [ ] Seam A: Film grain makes two consecutive frames of a still image Overlay differ.
- [ ] Seam A: Bloom pulse makes a bright area's brightness vary with its period, and moving the Overlay later in the Timeline moves the phase with it.
- [ ] Seam A: Glow brightens the area around a bright shape.
- [ ] Seam A: a keyed image Overlay with Film grain also changes from frame to frame.
- [ ] The preview's grain moves and its pulse throbs while playing, and both are still when paused.
