# 06: The Face registry and font import

**Parent spec:** `spec.md` (Implementation Decisions "Faces", "MCP"); GLOSSARY (Face).

**What to build:** the owner imports their own fonts, for every Job, and every style can name them.

- **The registry:** the static font list becomes the bundled Faces plus the imported ones, kept for every Job in the data directory. A Face has:
  - an id (existing ids kept; imported ones from the PostScript name, with a suffix on collision);
  - its family (name IDs 16/1) and the family libass matches;
  - weight (usWeightClass) and italic;
  - its file, whether it is bundled or imported;
  - copyright and licence text (name IDs 0, 13, 14), and a Restricted flag from OS/2 fsType.
- **Validation:** every style's Face id is checked against the registry (Text Style, Caption, Hook and Watermark Styles). Metrics are cached per Face and cleared when the registry changes.
- **Import:**
  - TTF or OTF gives one Face. A TTC gives one Face per member, each written out as its own file.
  - A variable font gives one static Face per named instance (fontTools' instancer), or its default when it has none.
  - The same bytes aren't imported twice. A file fontTools can't read is refused.
  - A Restricted font is imported with a warning.
- **Delete:** an imported Face is refused while any Candidate (and its Revision History), Text Preset or Style Preset names it, listing where. Bundled Faces can't be deleted.
- **Rendering:** each render (and each picture) gets one fonts directory holding the bundled and imported Faces it needs. A missing Face file fails the render clearly.
- **API:**
  - list Faces with their family, weight, italic, bundled or imported, licence info and metrics;
  - serve a Face's file, cached by id and content;
  - import from an upload;
  - delete.
  - Changes are broadcast on the existing events.
- **MCP:** `add_asset` with `kind: "font"` from a path on this Mac; `list_assets` with `kind: "fonts"` lists Faces; `delete_asset` deletes one, with the same refusal.
- **Minimal UI:** the existing font selects list imported Faces too, and the Text tab has an Import font button. The searchable picker is ticket 07.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Importing a TTF, an OTF and a TTC yields the right Faces with the right family, weight and italic.
- [ ] Importing a variable font with named instances yields one static Face per instance, and a render in its Bold instance differs from its Regular.
- [ ] A Restricted font imports with a warning, and its licence text is listed.
- [ ] A duplicate import adds nothing. A text file is refused.
- [ ] A Caption Style naming an imported Face validates and renders in it. An unknown Face id is refused.
- [ ] Deleting a Face used by a Candidate's Revision, a Style Preset or a Text Layer is refused, naming where. Deleting an unused one succeeds.
- [ ] The MCP font import and the Face listing work end to end.
