# 07: A searchable Face picker everywhere, and more bundled families

**Parent spec:** `spec.md` (Solution "Imported Faces"; Implementation Decisions "Faces", "Preview and editor": Face picker).

**What to build:** with dozens of Faces, picking a font stays quick.

- **The Face picker:**
  - It can be searched by family name (substring, ignoring case) and lists each family once, drawn in its own face.
  - Weight and italic controls beside it offer only the family's Faces, and switching them changes the Face id.
  - Imported families show an "imported" mark and their licence info. A Restricted one shows its warning.
  - It has an Import button.
  - It replaces every font select: Text Style, Caption, Hook and Watermark Styles, in the clip editor and the Advanced Edit, on desktop and phone.
- **Bundled families:** `make setup` downloads ~10–15 more OFL families, with the weights (and italics where useful) the built-in Presets will use. Each is registered as a bundled Face and recorded in THIRD_PARTY_NOTICES with its licence. The existing 6 keep their ids.

**Blocked by:** 06.

**Status:** done

- [x] Typing part of a family's name filters the list. Each family appears once.
- [x] A family with Regular, Bold and Black offers exactly those weights. Picking Bold sets the Bold Face's id and the preview changes.
- [x] The picker is used in the Text, Caption, Hook and Watermark Style fields.
- [x] After `make setup`, the new families are listed as bundled, and THIRD_PARTY_NOTICES names each with its licence.
- [x] A Clip using a new bundled family renders in it.

## Comments

**2026-10-17 (agent):** Built.
- **Bundled families** (`backend/app/fonts.py` `_BUNDLED`, `backend/scripts/download_assets.py`): 52 bundled Faces in 19 families. New: Barlow Condensed (7), Kanit (6), Oswald (4), Passion One (Regular, Bold, Black), DM Serif Display (Regular, Italic), Abril Fatface, Lobster, Pacifico, Titan One, Caveat Brush, Staatliches, Permanent Marker and Luckiest Guy (Apache-2.0); and Montserrat and Poppins now have 9 Faces each (Regular to Black, with italics). The 6 old ids are kept. Ids are `family-style` (`kanit-black-italic`); a family's only Face has the family's id (`lobster`). All from google/fonts at the pinned commit, except Montserrat (JulietaUla v9.000). Google Fonts has Oswald only as a variable font, so `make setup` writes its Regular, Medium, SemiBold and Bold instances out as static files with `app.fonts.statics` (made public for it), as an import of a variable font is split. Every family is in THIRD_PARTY_NOTICES with its copyright line and licence.
- **What libass matches for a bundled Face:** its family (name ID 1) when its subfamily is "Regular", as the first 6 always were; otherwise its full name (ID 4). Montserrat Bold's name ID 1 is "Montserrat", like its Regular, so ID 1 alone would set the Regular. Seam A: captions in `kanit-bold` beside a Watermark in `kanit-regular` (both in one fontsdir) are bolder than in `kanit-regular`; the test fails with ID 1.
- **Labels:** a bundled Face's label is its full name less " Regular" ("Anton", "Kanit Black Italic").
- **A bundled file not yet downloaded** (an install that pulled without running `make setup` again) no longer breaks the font list: the Face isn't listed, styles naming it still validate, and a render fails with "…is missing: run make setup".
- **Face picker** (`frontend/src/pages/job/editor/FacePicker.tsx`, logic in `faces.ts`): a button showing the family in its face opens a popover (top layer, placed under the button or over it, as InfoTip is) with a search field (combobox, arrow keys and Enter), the families (imported first, then bundled, each by name; an imported family named as a bundled one is listed apart, marked "Imported"), each drawn in the Face it would pick, and Import font (which picks the imported Face). Beside it: Weight (only the family's weights) and an Italic toggle (shown when the family has an italic, enabled where the weight has both slants). Picking another family keeps the nearest weight (the heavier of two as near) and italic where it can. An imported Face shows "Imported font" with its copyright, licence and URL in an InfoTip, and the Restricted warning. It replaces the font Select in Text Layer fields (one and several), and the Caption, Hook and Watermark Style panels; `fontChoices` is gone. Checked in the browser, desktop and 390 px wide.
- **Not done / for later:** the store still loads every Face file before listing them (ticket 06's `loadFonts`), now ~9 MB for 52 Faces. Fine on this Mac; a phone on the LAN waits longer for the first list. An id clash between a new bundled id and a Face imported before this change (e.g. an imported `kanit-regular`) resolves to the bundled one; imports began today, so none should exist.
