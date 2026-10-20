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

**Status:** ready-for-agent

- [ ] **Import:** a valid file imports. A 1D table, a size over 65 and a malformed line are each refused with the line named.
- [ ] **Naming:** a clashing name gets "(2)" and a new id.
- [ ] **Deleting:** deleting a Look in use is refused, and an unused one is deleted.
- [ ] **Fit:** the fitted approximation of an identity table is the identity.
- [ ] **Render:**
  - An identity `.cube` leaves pixels unchanged (within rounding).
  - A channel-swap `.cube` swaps channels.
  - At intensity 0, it changes nothing.
- [ ] **MCP:** `add_asset look`, `list_assets looks` and `delete_asset` work.
