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

**Status:** done

- [x] Each effect's chain runs at its default, minimum and maximum over a 1 s 1080×1920 clip, keeping its size and length.
- [x] Seam A: Pixelate makes blocks of one colour of about the planned size.
- [x] Seam A: Posterize leaves at most `levels` values per channel.
- [x] Seam A: Motion blur at angle 0 smears a vertical edge horizontally but not a horizontal one.
- [x] Seam A: Chromatic aberration separates red and blue at the edges more than at the centre.
- [x] Seam A: Fisheye moves a grid's points near the middle outward and leaves the corners fixed.
- [x] The preview shows each effect, and the library lists them in their categories.
- [x] Vitest: every catalogue effect has a frontend imitation (the catalogue and the frontend table stay in step).

## Comments

Built: five effects in the catalogue (`app/video_effects.py`), each with its builder and its SVG imitation (`IMITATIONS` in `editor/videoEffects.ts`). They draw on Segments, Overlays, Adjustment Layers and keyed pictures alike.
- **Builders:**
  - Motion blur: `dblur`, radius = length. Its sigma is about the length, as Concat's streak is. The angle is negated, because dblur turns the other way.
  - Pixelate: `pixelize` with mode avg, blocks counted from the top left.
  - Chromatic aberration: the planes are taken apart (`extractplanes`). Red is scaled up and cropped; blue is scaled down, padded and `fillborders` smeared. They are put back together with `mergeplanes`. A `geq` version was about 8× slower.
  - Fisheye: Concat's `(1 - s) + s r²` with the corners kept, done twice. Each pass is a `lenscorrection`, then the kept part zoomed back. lenscorrection's k1 stops at 1, so each pass is limited to s ≤ 0.3. Two passes swell the middle about as much as Concat's s ≤ 0.6.
  - Posterize: `lutrgb` in `gbrap`, then back to `EFFECTS_FORMAT`.
- **Labels:** `video_effect_chain(..., label=)` prefixes a builder's own link labels with `label` and the entry's place. The renderer passes `g{i}fx`, `layer{number}fx` and `adjust{index}fx`; the frame process uses the default `vfx`. Builders may now use `split`/`;` freely. The parts that hold labels, or crop/scale (CA, Fisheye, Posterize), run on every frame of an Adjustment Layer.
- **Shared fixture:** `backend/tests/fixtures/video_effects.json` is the catalogue. The backend asserts it, and vitest checks every entry has an imitation at its default, min and max. Regenerate the fixture when adding effects.
- **Preview:**
  - `Primitive` has `children` now; `Primitives` in GradeFilters renders them.
  - `effectsFilterId` is built from the effects' ids, their params and the box. It no longer uses the primitives, because a map's data URL is too long.
  - `displacementMap` makes a 64×64 BMP data URL; `fisheyeOffset` is the render's mapping.
  - In Chrome, a bbox-units displacement scale counts in the box's width on both axes. `displaced` corrects for that. Not checked in other browsers.
- **Near:**
  - Pixelate's preview samples each block's middle; the render takes the mean.
  - Motion blur at a slant uses nine taps.
  - Chromatic aberration's preview takes the picture's own blue past its edges.
- **Checked in headless Chrome** on a static page of the filters, not in the app.

Review fix: `effectPrimitives` is memoised per stack and box (`built`, emptied past 256). `effectsFilterId` tells an empty stack from its enabled entries that have an imitation, so it no longer builds primitives (Fisheye's BMP among them) on every playback tick.
