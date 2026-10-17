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

**Status:** done

- [x] A Text Layer "🔥 WAJIB TONTON" renders with a multi-hued emoji where the plan places it, followed by the text.
- [x] A ZWJ family, a flag and a skin-toned emoji each render as one image.
- [x] The preview's picture and the rendered frame show the same emoji.
- [x] A caption Word containing an emoji renders without it, and leaves no empty box.
- [x] A Text Layer made only of emoji renders them; one with only unknown characters shows nothing and doesn't fail.

## Comments

**2026-10-17 (agent):** Built.
- **The images:** Noto Color Emoji's `2D/png/512` set (3750 PNGs, about 95 MB) at release v2026-09-24-unicode18_0, downloaded by `make setup` (`backend/scripts/download_assets.py`, 16 at a time, retried on a network error, files present skipped) into `backend/assets/emoji/` (gitignored). The file list comes from GitHub's tree API, by the pinned tree hashes. Noto's PNG sets have no flags (its font draws them from region-flags), so the 262 flags it draws (its `waved-svg` listing) are downloaded from `third_party/region-flags/png` and saved under their emoji names (🇮🇩 → `emoji_u1f1ee_1f1e9.png`, 🏴󠁧󠁢󠁥󠁮󠁧󠁿 → `..._e007f.png`): flat, not waved. Recorded in THIRD_PARTY_NOTICES.
  - **Why 512:** an emoji is 1 em square in a picture rasterised at the largest scale its layer reaches (up to 4096 px). A 120 px title at scale 2–3 draws its emoji 200–300 px across: the 128 set (21 MB) would be blown up and soft there, the 72 set worse. 95 MB is a small part of what `make setup` already fetches (the Whisper model is 1.6 GB).
  - **Licence:** the README gives the images under Apache-2.0, but the repository's `LICENSE` at this release holds the OFL 1.1 text. Both allow the use; NOTICES says so, and the file is kept as `assets/emoji/LICENSE`. Flags: public domain (`LICENSE-region-flags`).
- **`app/emoji.py`** (new): the Extended_Pictographic table (moved from the planner; `without_emoji` still lives there), `clusters(text)` (emoji sequences kept whole: ZWJ joins, variation selectors, skin tones, tag sequences, regional-indicator pairs, keycaps), `image_of(sequence)` (its own image, else its first codepoint's, else None; FE0E/FE0F left out of names as Noto does), `image_pixels` (any PNG as straight-alpha RGBA; region-flags' are 1-bit palette) and `images_dir`, which tests point at stand-ins. A missing set logs a warning once and leaves emoji out.
- **Planner:** `TextRun.image` (None for text). `text_runs` cuts the line into clusters first; an emoji sequence with an image is a run of its own in the style's Face (the line it stands on), a space after it goes with it, as with any run. `runs_width`/`placed_runs` measure through `_run_width`/`_characters`: an emoji is 1 em (`emoji_size`) and counts as one character for tracking. `emoji_square(run, baseline, size)` is its square: its x and width, centred down on the middle of the Face's capitals. `TextLayout.name` adds `emoji.IMAGE_SET` when the layout has emoji, so a new set gives new pictures. `text_event` no longer calls `without_emoji`.
- **Rasteriser** (`app/text_pictures.py`): emoji runs are skipped in the ASS; `with_emoji` pastes each image after the matting, fitted to its square keeping its shape (a 3:2 flag fills it across), premultiplied before resizing (INTER_AREA down), laid over with straight-alpha "over". So it is over the plate and ticket 04's shadow (whose events skip emoji runs too), with no stroke, colour or shadow of the text.
- **Captions** filter emoji (`_caption_text` uses `without_emoji`): a Word that was only an emoji is dropped, leaving no empty highlighted Word. Hook, Kicker and Watermark unchanged.
- **Endpoint:** `GET /api/emoji/{codepoints}` (hex joined by `-`, e.g. `1f468-200d-1f469`) serves the image with the same fallback, 404 otherwise. Nothing uses it yet: it is for ticket 07's picker samples.
- **MCP:** no new fields; the instructions now say emoji in Text Layers are drawn and left out elsewhere. The dry run's lines and runs show them (`image` per run).
- **Tests** (`tests/test_emoji_text.py`, 13): runs and measures, sequences as one image (family, flag, skin tone, ❤️, keycap), fallback and leaving out, emoji-only and unknown-only layers, the picture's colours over a plate with a stroke, a picture made 3× larger, captions, a Seam A render vs the served preview picture, and the endpoint. They use `tests/emojifiles.py`'s generated stand-ins (four-coloured discs, a 3-channel flag), set by an autouse session fixture in conftest, so no test needs the download. `test_text_layers` now expects 🔥 kept.

Decisions:
- **"1 em"** is the Face's em at libass's size: `size × unitsPerEm / (winAscent + winDescent)` (about 0.82 of the size for Montserrat), as a browser's emoji at that font size; the full `size` made emoji nearly twice the capitals.
- **No emoji-to-text presentation (FE0E):** a sequence is an emoji whatever its selector, drawn from its image.
- **Merged with tickets 03, 04 and 05.** Wrapping (`text_lines`) keeps emoji and measures them as 1 em. `app/line_breaks.py` gives a break opportunity before and after an emoji sequence, as between ideographs (UAX #14 ID/EB), and none inside one: not before a skin tone or tag (EM, CM; joiners, variation selectors and the keycap already joined), nor inside a regional-indicator pair; a word broken between its characters keeps sequences whole (`clusters`). An emoji counts as one character for tracking (`_characters`). Ticket 04's shadow skips emoji runs as the text events do. Ticket 05: nothing; the square is in layout pixels and scales with the raster.
