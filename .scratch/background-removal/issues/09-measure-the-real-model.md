# 09: Measure the real model

**Parent spec:** `../spec.md` ("Testing Decisions", "Further Notes"); ADR 0015.

**What to build:** an opt-in test (`MATTE_MODEL=1`, as `RENDER_COST`) that runs the real RVM on a short clip with a person and checks that the Matte keeps a plausible area. It prints, for the ADR:
- the Matte's throughput (frames per second at a 1280 px long edge, CoreML and CPU);
- the extra time a render with Background removal takes against a plain one.

The figures are recorded in ADR 0015's Consequences with the machine, the ffmpeg version and the date.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The test is skipped unless `MATTE_MODEL=1` and the model is present.
- [ ] ADR 0015 records the measured figures.
