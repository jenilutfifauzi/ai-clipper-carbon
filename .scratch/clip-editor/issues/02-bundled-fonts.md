# 02: Bundled fonts

**Parent spec:** `spec.md` in this feature folder (user story 8; "Fonts").

**What to build:**
- **Fonts.** Five more SIL OFL fonts in `backend/assets/fonts/`: Anton, Bebas Neue, Poppins Black, Inter ExtraBold and Bangers, each with its licence.
- `app/fonts.py`: a font registry mapping each id to its file, its libass family name and its label.
- `font_metrics(font_id)` replaces `font_metrics()`.
- **Font choice.** Caption and hook styles choose a font by id. Unknown ids are refused when a style is validated.
- **API.** `GET /api/fonts` lists the fonts and `GET /api/fonts/{id}` serves the file. The frontend registers them with `FontFace`.

**Blocked by:** 01.

**Status:** done

- [x] Each registered family name is the name libass matches: a test reads it from the file's `name` table. A render with each font succeeds (one Seam A test with a non-default font).
- [x] Caption shrinking and hook fitting use the chosen font's metrics.
- [x] `/api/fonts/{id}` serves only registered files (404 otherwise), with a long cache lifetime.

## Comments

**2026-10-14: done.** `make test`: 278 passed. `npm run typecheck` passes.

**Change from the plan:** Inter ExtraBold was swapped for **Archivo Black**. Google Fonts only ships Inter as a variable font, and libass would set its default (Regular) instance.

Built:
- **Fonts** (`app/fonts.py`): Montserrat ExtraBold, Anton, Bebas Neue, Poppins Black, Archivo Black and Bangers.
  - `scripts/download_assets.py` fetches the five new ones and their `OFL-<family>.txt` from google/fonts at commit `66928797`.
  - `THIRD_PARTY_NOTICES.md` lists them.
- **Built-in Presets:** Yellow pop is set in Anton (size 130, 18 characters a line). Minimal is set in Poppins Black.
- **Metrics:** `FontMetrics.em` (units per em) was added. The browser sets a font by its em, libass by its Windows ascent plus descent, so the preview converts sizes with `cssFontSize`.
- **API:**
  - `GET /api/fonts`: id, label, family, units, em, ascent, cap height and descent.
  - `GET /api/fonts/{id}`: `font/ttf`, cached for 7 days, 404 for an unknown id.
- **Frontend:**
  - `api.ts` gains types for styles, Presets, overrides and fonts, plus Preset and font calls.
  - `fonts.ts`: `loadFonts()` registers each font as `FontFace("clip-<id>")`, alongside `cssFontSize`.

**Tests:**
- libass's own `fontselect` debug line is checked for every registered family, so a family it doesn't match (which would fall back to Helvetica) fails the test.
- Font list and serving.
- Caption shrink and hook fit with Anton and Bebas Neue metrics.
- The Seam A preset test now renders in Anton.
