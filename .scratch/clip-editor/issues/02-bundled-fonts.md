# 02: Bundled fonts

**Parent spec:** `spec.md` in this feature folder (user story 8; "Fonts").

**What to build:**
- **Fonts.** Five more SIL OFL fonts in `backend/assets/fonts/`: Anton, Bebas Neue, Poppins Black, Inter ExtraBold and Bangers, each with its licence.
- `app/fonts.py`: a font registry mapping each id to its file, its libass family name and its label.
- `font_metrics(font_id)` replaces `font_metrics()`.
- **Font choice.** Caption and hook styles choose a font by id. Unknown ids are refused when a style is validated.
- **API.** `GET /api/fonts` lists the fonts and `GET /api/fonts/{id}` serves the file. The frontend registers them with `FontFace`.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Each registered family name is the name libass matches: a test reads it from the file's `name` table. A render with each font succeeds (one Seam A test with a non-default font).
- [ ] Caption shrinking and hook fitting use the chosen font's metrics.
- [ ] `/api/fonts/{id}` serves only registered files (404 otherwise), with a long cache lifetime.

## Comments
