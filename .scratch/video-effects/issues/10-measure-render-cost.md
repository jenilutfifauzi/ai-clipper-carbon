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

**Status:** ready-for-agent

- [ ] A script or opt-in test that renders the cases above and prints the table.
- [ ] ADR 0014 has the table under its Consequences, with the date and the ffmpeg version.
- [ ] Any outliers are noted in this ticket's Comments.
