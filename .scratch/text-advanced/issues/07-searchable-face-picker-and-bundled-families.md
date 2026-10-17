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

**Status:** ready-for-agent

- [ ] Typing part of a family's name filters the list. Each family appears once.
- [ ] A family with Regular, Bold and Black offers exactly those weights. Picking Bold sets the Bold Face's id and the preview changes.
- [ ] The picker is used in the Text, Caption, Hook and Watermark Style fields.
- [ ] After `make setup`, the new families are listed as bundled, and THIRD_PARTY_NOTICES names each with its licence.
- [ ] A Clip using a new bundled family renders in it.
