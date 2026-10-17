# 11: Colour emoji in Text Layers

**Parent spec:** `spec.md` (Solution "Emoji and CJK"; Implementation Decisions "Planner (layout)", "Rasteriser", "Faces": emoji images); docs/adr/0010-text-layers-are-rasterised-pictures.md.

**What to build:** emoji in a Text Layer render in colour, identically in the preview and the Clip on any host.

- `make setup` downloads the Noto Color Emoji images (Apache-2.0), recorded in THIRD_PARTY_NOTICES.
- **The planner:**
  - It makes emoji runs instead of stripping them. A sequence (ZWJ joins, variation selectors, keycaps, flags, skin tones) is kept whole.
  - Each emoji has an advance of 1.0 em at the style's size, and is placed on its line.
  - A sequence with no image falls back to its first codepoint's image, or is left out.
- **The rasteriser** composites each emoji's image at its planned place and size onto the picture, over the shadow and the plate. The emoji keeps its own colours: no stroke, tint or shadow of the text on it.
- **The hook, Kicker, Watermark and captions** keep leaving emoji out. Captions now filter them too.
- **The Face picker's samples** may show emoji through a small endpoint serving images by codepoint sequence. Nothing else uses it.

**Blocked by:** 10.

**Status:** ready-for-agent

- [ ] A Text Layer "🔥 WAJIB TONTON" renders with a multi-hued emoji where the plan places it, followed by the text.
- [ ] A ZWJ family, a flag and a skin-toned emoji each render as one image.
- [ ] The preview's picture and the rendered frame show the same emoji.
- [ ] A caption Word containing an emoji renders without it, and leaves no empty box.
- [ ] A Text Layer made only of emoji renders them; one with only unknown characters shows nothing and doesn't fail.
