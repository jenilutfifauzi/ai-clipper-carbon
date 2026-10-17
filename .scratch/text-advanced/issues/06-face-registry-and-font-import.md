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

**Status:** done

- [x] Importing a TTF, an OTF and a TTC yields the right Faces with the right family, weight and italic.
- [x] Importing a variable font with named instances yields one static Face per instance, and a render in its Bold instance differs from its Regular.
- [x] A Restricted font imports with a warning, and its licence text is listed.
- [x] A duplicate import adds nothing. A text file is refused.
- [x] A Caption Style naming an imported Face validates and renders in it. An unknown Face id is refused.
- [x] Deleting a Face used by a Candidate's Revision, a Style Preset or a Text Layer is refused, naming where. Deleting an unused one succeeds.
- [x] The MCP font import and the Face listing work end to end.

## Comments

**2026-10-17 (agent):** Built.
- `backend/app/fonts.py` is the registry (`Faces`): the 6 bundled Faces (ids kept) plus imported ones in DATA_DIR/fonts (`fonts.json` index, `<id>.ttf|.otf` files). It is one per process: `fonts.use(data_dir/fonts)` runs in `create_app` and the CLI. `FontId` (app/styles.py) validates against it. The index is read again when its mtime or size changes, so CLI-side changes are seen. `font_metrics` (planner) is cleared through `fonts.on_change`.
- Import: TTF/OTF give one Face. A TTC gives one per member. A variable font gives one static Face per named instance (fontTools instancer), with names 1/2/4/6/16/17 and the style bits rewritten per instance, or its default when it names none. Every Face file is written by fontTools, so the same font has the same bytes whether it came alone or inside a TTC. Duplicates are found by that hash and by the upload's hash, and a bundled font's own file counts as a duplicate. A Restricted fsType adds a warning.
- API: `GET /api/fonts` (family, typographic_family, weight, italic, bundled, copyright/licence/licence_url, restricted, `url` with `?v=<hash>`, metrics), `POST /api/fonts` (upload → `{faces, existing, warnings}`), `GET /api/fonts/{id}` (immutable cache at its `?v=`, no-cache without), `DELETE /api/fonts/{id}`. The DELETE answers 409 for a bundled Face, and 409 with `{message, uses}` while a Candidate (current or any Revision History state) or an owner's Style Preset names the Face. `Candidate.faces()` lists the Faces a Candidate names.
- Render: `Renderer.render` gathers the Faces the ASS script uses (`_faces`) into a per-render `fontsdir` (symlinks). A missing file raises `MissingFace` ("The font file of X (id) is missing: import it again"), and the Clip shows that error.
- Broadcast: the candidate events stream sends a `fonts` event (`{ids}`) whenever Faces are imported or deleted. The frontend's `useCandidateEvents` then calls `reloadFonts()`.
- MCP: `add_asset kind:"font"`, `list_assets kind:"fonts"` (family, weight, italic, licence), `delete_asset kind:"font"` (same refusal). The INSTRUCTIONS mention Faces.
- Frontend: `src/fonts.ts` is now a store (`useFonts`, `reloadFonts`, `importFont`) that re-registers a FontFace when its URL changes. The Text tab has an Import font button (`ImportFont.tsx`). The existing font selects list imported Faces.

Decisions:
- **What libass matches.** An imported Face's `family` (what libass matches) is its full name (ID 4), or its PostScript name when it has CFF outlines. libass 0.17 matches a full name for TrueType and a PostScript name only for CFF, and either one picks exactly that Face, never another weight of its family. Bundled Faces keep name ID 1, as before. The typographic family (16/1) for the picker is a new field, `typographic_family`, so `family` keeps its meaning for the renderer.
- **Listing a Face with a missing file.** `GET /api/fonts` leaves out a Face whose file is gone from disk. It still validates and can be deleted.
- **Text Presets in the in-use check.** Ticket 08 doesn't exist yet, so the check covers no Text Presets. Ticket 08 should add its Presets to `face_uses` in api.py, with `kind: "text_preset"`.
- **TextLayer shape.** After merging main (tickets 01 and 13), `Candidate.faces()` and `renderer._faces` read `layer.style.font`. Ticket 02's rasteriser should build its fonts dir with `registry().gather(face_ids, folder)`, which raises `MissingFace` for a file that is gone.
- **One Face, one file.** Each Face file is written with `head.modified` set to `head.created`, so a font's bytes, and so its duplicate check, don't depend on when a collection holding it was saved.
