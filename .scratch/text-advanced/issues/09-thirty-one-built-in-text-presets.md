# 09: 31 built-in Text Presets

**Parent spec:** `spec.md` (Solution "Text Presets"; Implementation Decisions "Text Presets (new library)"; Further Notes on Concat).

**What to build:** a full set of starting looks, designed for this app's short vertical Clips.

- 31 built-in Presets as data files, including the 4 from ticket 08 under their ids. They are grouped into a handful of categories (for example titles, labels, subtitles, stickers, quotes, callouts), each with an order and a sample text.
- They use the bundled Faces (ticket 07) and the whole Text Style: stroke, shadow, Block and Strips plates, radius and padding, line height, tracking, and wrap width where a look is a card.
- Concat's kinds of preset are inspiration only. None of its data or fonts are copied.
- Each Preset is checked by eye in a rendered frame. A contact sheet of all 31 is kept in this ticket's comments.

**Blocked by:** 03, 07, 08.

**Status:** done

- [x] 31 built-ins are listed, each with a unique stable id, a category and a sample, and each validates as a Text Style.
- [x] Every built-in renders without error in a short Clip, and its picture matches its tile in the Text tab.
- [x] Every Face a built-in names is bundled.
- [x] A contact sheet of the 31 rendered looks is attached in Comments.

## Comments

**2026-10-17 (agent):** Built.
- **27 new data files** in `backend/assets/text-presets/`, beside the 4 of ticket 08 (unchanged). 31 built-ins on 7 shelves:
  - Basic (10–30): Text, Soft Glow (a halo, no stroke), Drop Shadow (a hard shadow).
  - Titles (100–160): Title, Headline (Bebas Neue, tracked), Impact (Luckiest Guy, thick stroke), Comic (Bangers, red offset shadow), Editorial (DM Serif Display Italic), Neon (Kanit, pink glow), Stack (Anton, wrapped to two tight lines).
  - Labels (200–250): Label, Viral (red tag), Pill (radius at its cap), Lower Third (left aligned, Barlow Condensed), Highlight (Permanent Marker on yellow Strips), Part (Staatliches, tracked, square).
  - Subtitles (300–340): Subtitle, Bold Caption, Strips, Clean, Classic (yellow, thin stroke).
  - Stickers (400–430): Sticker (pink on a white plate), Bubble (Titan One, pink stroke, extruded shadow), Brush (Caveat Brush), Script (Pacifico).
  - Quotes (500–520): Quote Card (white card, serif italic, wrap width), Quote Dark (dark card), Big Quote (Abril Fatface).
  - Callouts (600–620): Question (blue), Warning (yellow), Tip (mint card).
  - Samples are short Indonesian lines ("WAJIB TONTON", "Kenapa begitu?"). 18 of the 19 bundled families are used (Lobster isn't). Nothing is copied from Concat.
- **Contact sheet:** [text-presets-contact-sheet.png](../assets/text-presets-contact-sheet.png). Each look's picture is shown as `rasterised` draws it (scale 1, a 1080 px wide cell) over a light-to-dark gradient, so light and dark video are both covered. I looked at it and fixed what read badly: Strips, Highlight and Tip were narrowed so their samples wrap, Stack's line height was tightened, Bold Caption's and Classic's strokes were thinned (letters ran together), Soft Glow's halo was strengthened, and Clean and Script were made larger.
- **Tests** (`backend/tests/test_text_presets.py`):
  - The 31 built-ins have unique samples, sit on 5–8 shelves, and name only bundled Faces. Each style saves through the API unchanged.
  - Seam A: one short Clip has all 31 as Text Layers. Each sets every character of its sample, and its picture has solid ink in its colour. The Clip renders.
- **Tiles** (`TextPresets.tsx` `sampleStyle`), so that they match the pictures more closely:
  - They now show tracking, and the plate's radius and padding, all scaled.
  - A sample wraps to at most two lines inside its plate, instead of being cut to one line, so a card's tile looks like a card.
  - The tile's sample is set at 16 px, down from 18, so that a heavy word fits the narrow panel.
  - I checked them in the built app on a copy of a real Job. Drop Shadow's sample became "Lihat ini", since "Bayangan" broke mid-word in a tile.
- **Merged with main** (docs only). Backend 781 passed. The quota-timing test in `test_resilience.py` failed once in the full run, as ticket 08 saw; it passed on the rerun. Frontend 710 passed.
- **Left:** nothing.
