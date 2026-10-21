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

**Status:** ready-for-agent

- [ ] Both effects' chains run at their default, minimum and maximum over a 1 s clip, and keep an alpha.
- [ ] Validation refuses a bad colour, and a Cutout effect on a Segment or an Adjustment Layer.
- [ ] Seam A: a green Overlay with Chroma key lets the frame beneath show where it was green.
- [ ] Seam A: Luma key does the same for black, and with invert for white.
- [ ] Seam A: a keyed Overlay with rounded corners and a shadow keeps both the key's alpha and the corners.
- [ ] The preview shows the key, and the eyedropper sets the colour from a paused frame.
- [ ] Vitest: "Add effect" on a mixed Pick of Segments and Overlays adds a key to the Overlays only.
