# 06: Chroma key and Luma key on Overlays

**Parent spec:** `../spec.md` ("Model", "Catalogue", "Preview", "Inspector UI"); ADR 0014.

**What to build:** the Cutout category. An Overlay shot on green, or a logo on black or white, drops its background, and what lies under it shows through.

**Chroma key:**
- Its settings are a colour (default #00B140), similarity 1–60% (30), softness 0–50% (10) and spill 0–100% (50).
- The render removes the key colour and then the spill.

**Luma key:**
- Its settings are threshold 0–100% (10), softness 0–50% (10) and invert (0 or 1).
- It removes the darker pixels, or the lighter ones when inverted.

**The catalogue gains a colour setting** (`#RRGGBB`). It is validated, and listed with its default.

**Cutout effects are for Overlays only.** One on a Segment or an Adjustment Layer is refused on save, by the API and by MCP. The editor's library doesn't offer them there.

**The render:** the alpha a key makes is kept through the Overlay's corners, border, rotation, shadow and opacity.

**The preview:**
- Chroma key's alpha comes from the colour's distance to the key, by a colour matrix and a table (near).
- Luma key's alpha comes from the luminance, then a table.

**The Inspector:** the key colour is a swatch, a hex field and an eyedropper.
- The eyedropper takes a click on the paused preview over the Overlay. It reads the Overlay's media frame at that point and passes it through the Overlay's Grade fold, so the colour matches what the render keys after the Grade.

**Blocked by:** 02, 03.

**Status:** done

- [x] Both effects' chains run at their default, minimum and maximum over a 1 s clip, and keep an alpha.
- [x] Validation refuses a bad colour, and a Cutout effect on a Segment or an Adjustment Layer.
- [x] Seam A: a green Overlay with Chroma key lets the frame beneath show where it was green.
- [x] Seam A: Luma key does the same for black, and with invert for white.
- [x] Seam A: a keyed Overlay with rounded corners and a shadow keeps both the key's alpha and the corners.
- [x] The preview shows the key, and the eyedropper sets the colour from a paused frame.
- [x] Vitest: "Add effect" on a mixed Pick of Segments and Overlays adds a key to the Overlays only.

## Comments

Built: Chroma key and Luma key (Cutout) in `app/video_effects.py`, with their SVG imitations in `editor/videoEffects.ts`, on Overlays only.
- **Colour setting:** the shared `Setting` (`app/audio_effects.py`) has `type` (`NUMBER`, `COLOUR`) and `colour_setting(key, label, default)`; `Setting.listed()` is what both catalogues list (a number's as before, so Audio Effects are unchanged; a colour's key, label, type, default, intensity). `VideoEffect.params` values are `float | str`. Frontend: `ColourSetting`, `VideoEffectSetting`, `isColourSetting` in `api.ts`.
- **Validation:** `checked_video_effects(stack, item, keyed=False)`; only `Overlay` passes `keyed=True`. A colour must be `#RRGGBB` and is kept in capitals. `Effect.keys` marks a Cutout effect.
- **Builders:** not ffmpeg's `chromakey`/`lumakey`/`despill` (ADR 0014 amended in place): the frame goes to gbrap, and a copy to BT.709 full-range YUV, so the keys measure display RGB, as Concat's and the eyedropper do. Chroma key is `lut2` tables of Cb and Cr (the alpha, and the spill amount), then red, green and blue each less that amount of the key's hue, and the alpha times the picture's own. Luma key is one `lut2` of luma and alpha, then `alphamerge`. About 1.4 s per second of 1080×1920 for Chroma key (for 10).
- **Render:** the corners, border, rotation, shadow and opacity already kept an alpha. A Seam A test checks rounded corners and a shadow cast only by what the key kept.
- **Editor:**
  - `addVideoEffect` skips a Segment or an Adjustment Layer for a key. `isKey` and `keysPicked` are in `actions.ts`, and so is `setVideoEffectColour(scene, index, key, colour)`.
  - `videoLibraryOf(kinds, query, keys)` drops Cutout when no Overlay is picked.
  - `EffectRow` takes `colourField`, shown in "More". `ColorField` takes `after`, for the eyedropper button.
  - `VideoEffectControls` has `onColour` and `overlays`.
- **Eyedropper:** `editor/eyedropper.ts` holds the `eyedropper` store (arm/cancel), `mediaPointOf` (frame point to item pixels, through turn, flips and crop) and `pickedColour`. `gradedColour` (`grading.ts`) applies the fold's tables and matrix to the colour. `EyedropperLayer` (in ClipPreview's stage) pauses playback and takes the next click. It reads the Overlay's `<img>`/`<video>` (`data-overlay-media`) through a 1×1 canvas. Escape cancels.
- **Near:**
  - The preview squares the chroma differences with 65-point tables.
  - Its spill is computed on an opaque copy.
  - The eyedropper leaves out sharpen, vignette and an Imported Look's 3D table.
- **Verified:** headless Chrome on a static page of the two imitations (green, black and inverted white screens drop out; the red band stays).
- **Not verified in the app:** the eyedropper click. vitest covers its geometry and the Grade.
