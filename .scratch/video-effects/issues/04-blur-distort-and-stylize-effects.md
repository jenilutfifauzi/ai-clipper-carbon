# 04: Motion blur, Pixelate, Chromatic aberration, Fisheye and Posterize

**Parent spec:** `../spec.md` ("Catalogue", "Preview"); ADR 0014.

**What to build:** five more effects in the catalogue. Each one gets its render chain, its SVG imitation and its card in the library. The settings are matched to Concat for behaviour, not copied.

| Effect | Category | Settings | Render | Preview |
|---|---|---|---|---|
| Motion blur | Blur | length 2–60 px (18), angle −90–90° (0) | directional blur | near |
| Pixelate | Distort | size 2–64 px (16) | pixelize | near |
| Chromatic aberration | Distort | shift 1–24 px (4) | red scaled up, blue scaled down, about the centre | channels split and scaled, near |
| Fisheye | Distort | strength 5–100% (50) | lens correction | displacement map |
| Posterize | Stylize | levels 2–8 (4) | per-channel table | discrete transfer, exact |

px settings scale with the picture, as Gaussian blur's do.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Each effect's chain runs at its default, minimum and maximum over a 1 s 1080×1920 clip, keeping its size and length.
- [ ] Seam A: Pixelate makes blocks of one colour of about the planned size.
- [ ] Seam A: Posterize leaves at most `levels` values per channel.
- [ ] Seam A: Motion blur at angle 0 smears a vertical edge horizontally but not a horizontal one.
- [ ] Seam A: Chromatic aberration separates red and blue at the edges more than at the centre.
- [ ] Seam A: Fisheye moves a grid's points near the middle outward and leaves the corners fixed.
- [ ] The preview shows each effect, and the library lists them in their categories.
- [ ] Vitest: every catalogue effect has a frontend imitation (the catalogue and the frontend table stay in step).
