# 06: Imported Looks from .cube files

**Parent spec:** `../spec.md` ("Looks", "The fold", "Renderer", "Preview", "MCP"); ADR 0013.

**What to build:** the owner imports `.cube` files with an Import button in the Filters tab. Each becomes an Imported Look in the Imported category, kept for every Job in a global store beside the Faces and Logos, and is used like any Look, intensity included.

**Import:**
- **Accepted:** only 3D tables of size 2–65. `DOMAIN_MIN`/`DOMAIN_MAX` and Resolve's input range are rescaled.
- **Refused:** 1D tables, larger sizes and malformed files, with an error naming the line.
- **Naming:** a Look is named from the file's TITLE or its file name. A clashing name gets "Name (2)". Every import is a new Look, never a replacement.
- **Preview approximation:** at import, the backend fits per-channel tables and a 3×3 matrix to the table and lists them with the Look. The preview uses them, so it is near, not exact.

**Render:** the table is applied with `lut3d`, after the tables and matrix and before sharpen and vignette, mixed by intensity.

**Deleting:** an Imported card has a delete action. It is refused, with the reason, while any Candidate's Grade names the Look.

**The agent:** `add_asset` kind `look` imports a path on this Mac, and `delete_asset` removes an unused one.

**Blocked by:** 05.

**Status:** done

- [x] **Import:** a valid file imports. A 1D table, a size over 65 and a malformed line are each refused with the line named.
- [x] **Naming:** a clashing name gets "(2)" and a new id.
- [x] **Deleting:** deleting a Look in use is refused, and an unused one is deleted.
- [x] **Fit:** the fitted approximation of an identity table is the identity.
- [x] **Render:**
  - An identity `.cube` leaves pixels unchanged (within rounding).
  - A channel-swap `.cube` swaps channels.
  - At intensity 0, it changes nothing.
- [x] **MCP:** `add_asset look`, `list_assets looks` and `delete_asset` work.

**Notes (done):** `app/looks.py` reads a `.cube` (`parse_cube`: 3D only, 2–65 a side; DOMAIN_MIN/MAX
and LUT_3D_INPUT_RANGE treated as the input domain and resampled trilinearly to 0..1, outputs clamped
to 0..1; other tools' keywords skipped; errors "Line N: …") and keeps Imported Looks in
DATA_DIR/looks (`ImportedLooks`, opened by `looks.use` in the app and the CLI): `<id>.cube` (the
table as kept), `looks.json` (name, size, fit). Each import gets a uuid id; a clashing name (built-in
or imported) gets " (2)", " (3)"… The fit (`fit_table`) is per-channel 256 tables then a 3×3 matrix by
alternating least squares, starting from identity tables (so an identity, a channel swap or a pure
matrix fit exactly). `GET /api/looks` lists Imported Looks after the built-in ones (category
"Imported", `has_table`, `fit`; built-ins `false`/`null`); `POST /api/looks` imports (422 naming the
line), `DELETE /api/looks/{id}` (409 for a built-in, and while any current Candidate's grade, a
Segment's or an Overlay's names it, listing them, as Media in-use does; `Candidate.looks()`).

The fold carries an Imported Look as `Folded.lut` (Look id, intensity, fit) after the tables and
matrix. Render: `lut3d` (tetrahedral) from a table mixed over the identity at the intensity
(`<id>@<intensity>.cube`, made once): trilinear/tetrahedral interpolation keeps that mix, so it is
exactly mix(before, lut(before), t) with no split/blend, and an Overlay's alpha passes through lut3d
on rgba. Preview: the fit's feComponentTransfer + feColorMatrix after the Grade's, then an
feComposite (arithmetic k2 = t, k3 = 1 − t) over the picture before it, so the mix is exact in the
preview too. The shared fixture gains `fits` (inline, fitted to a warm table made by the generator)
and three Imported cases expecting `lut`. Filters tab: Import look (.cube) and a delete button on
Imported cards (the 409's message shown). MCP: `add_asset` kind `look`, `delete_asset` kind `look`,
`list_assets looks` without the fits; instructions mention Imported Looks. The tools budget held
without raising.
