# 10: Measure the render cost of effects and Blend Modes

**Parent spec:** `../spec.md` ("Render cost", "Testing Decisions"); ADR 0014.

**What to build:** a measured table of what each Video Effect and each Blend Mode costs to render, recorded in ADR 0014.

- **The test clip:** a generated 1080×1920 clip of a few seconds, rendered through the real render path.
- **What is rendered:** the clip with each effect at its defaults:
  - once on a Segment;
  - once on an Overlay, where the effect allows it;
  - Screen as a Blend Mode;
  - Glow, Bloom pulse and Film grain on an Adjustment Layer.
- **The table:** wall time against a plain render, as a factor, with the ffmpeg version.
- **Follow-up:** if an effect is far slower than its neighbours, propose a cheaper chain in the ticket's Comments rather than changing it here.

This is a measurement, not an assertion. No test fails on the timings.

**Blocked by:** 04, 05, 06, 07.

**Status:** done

- [x] A script or opt-in test that renders the cases above and prints the table.
- [x] ADR 0014 has the table under its Consequences, with the date and the ffmpeg version.
- [x] Any outliers are noted in this ticket's Comments.

## Comments

Measured; the table is in ADR 0014's Consequences.
- **The test:** `backend/tests/test_render_cost.py`, skipped unless `RENDER_COST` is set. `RENDER_COST=1` measures every case (about 13 minutes), `RENDER_COST=glow,bloom-pulse,screen` only those (and the plain renders). Run with `-s` to see the table. It renders a 6.45 s Candidate of a generated 1080×1920 Source through the API (`POST …/render`, timed to the Job's return to review), the fastest of two renders per case, after a warm-up. Overlays are a full-frame video Overlay of the same Source; an image Overlay's stack is drawn once and held, unless timed.
- **Noise:** ticket 09's tests ran on the machine at the same time. One run of Bloom pulse on a Segment took 98 s (64×); measured again alone, 30 s (20×), in line with its Overlay and layer.
- **Outliers** (far slower than their neighbours), with cheaper chains to try (not done here):
  - **Bloom pulse, about 20× (+4.4 to 5.4 s per Clip second).** The `geq` evaluates the luma, the knee and `pow` three times per pixel (once per plane), with `sin` of the time. Cheaper: the knee weight as a static table (`lut` on a grey copy of the quarter-size picture), multiplied onto the light with `blend=all_mode=multiply`, and only the strength left to the time, as a per-frame `colorchannelmixer` gain (driven by `sendcmd`) or a trivial `blend` expression. That keeps the look and drops the per-pixel `pow`.
  - **Motion blur, about 9× (+1.8 to 2.5 s).** `dblur` at full size. At its default angle (0°) or ±90°, `gblur=sigma=L:sigmaV=0` (or the reverse) is a one-axis Gaussian at Gaussian blur's cost (about 4×). For other angles, `dblur` on a half-size copy scaled back (with half the radius) would roughly quarter the cost; check the streak's look.
  - **Glow on an Overlay or a layer, 9 to 11× (+2.3 to 2.6 s), against 5× on a Segment.** The cost is the full-size `gbrap` split, scale back and `blend`, which on an Overlay also pays its alpha. Cheaper: scale the blurred light back straight into the `blend` at the base's format, or screen in YUV for the luma only (not exact on colour).
- **Middling:** Fisheye about 5.7× (two `lenscorrection` passes; one `remap` from a generated map would be one pass), Gaussian blur about 4×, Chroma key 4.1×, Luma key 3.6×, a Screen Blend Mode 2.9×. Pixelate and Film grain cost next to nothing.
- No effect's chain was changed.
