# 02: Sharpen and vignette

**Parent spec:** `../spec.md` ("The fold", "Renderer", "Preview"); ADR 0013.

**What to build:** the Color section's Effects group gains Sharpen and Vignette (0–100, neutral 0).

**Render:**
- Sharpen uses `unsharp`.
- Vignette uses `vignette`.
- Both come after the tables and matrix, in the Grade's fixed order.

**Preview:** these two are near, not exact.
- Sharpen is an SVG `feConvolveMatrix`.
- Vignette is a radial gradient layer over the graded picture.

The fold outputs both amounts, and the shared fixture covers them.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] **Render:** vignette darkens a corner more than the centre, and sharpen raises edge contrast on a test edge.
- [ ] **Fixture:** it covers sharpen and vignette alone and mixed, in pytest and vitest.
- [ ] **Neutral:** neutral sharpen and vignette add no filter.
- [ ] **Preview:** it shows both, and they reset like the other dials.
