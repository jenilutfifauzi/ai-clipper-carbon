# 05: Built-in Looks and the Filters tab

**Parent spec:** `../spec.md` ("Looks", "The fold", "Advanced Edit UI", "MCP"); ADR 0013.

**What to build:** about 20 built-in Looks, in Cinematic, Film, Retro, Portrait, Black & White and Vibe.
- Each is a data file of id, name, category, order and Adjust values, written for this app and tuned against sample footage.
- A shipped Look never changes; a revised one gets a new id.
- A Grade's `look` and `intensity` (0–100, default 100) now apply. The fold mixes the Grade with its Look over the Grade without it, by intensity. The shared fixture covers a Look at 0, 50 and 100%.

**The Filters tab** in the Asset Panel shows a card per Look, by category:
- **The picture:** each card is the frame at the playhead (the picked item's picture, or the Clip's) under that Look's SVG filter.
- **Hover:** tries the Look on the preview without applying it.
- **Click:** gives the Look to the Pick's Grades, or to the Candidate's with nothing picked, as one undo step.

**The Inspector's Color section** gains a Look picker, an intensity slider, and a way to remove the Look while keeping the Adjust. The clip editor's Color section gains the same.

**The agent:**
- `list_assets` kind `looks` lists every Look with id, name, category and Adjust values.
- An unknown Look id in a Grade is refused.

**Blocked by:** 01, 04.

**Status:** done

- [x] **Built-in Looks:** they load, their ids are unique, and every Adjust value is in range.
- [x] **Fixture:** the shared fold fixture covers Looks at 0, 50 and 100%.
- [x] **Render:** a Look at intensity 0 matches the Grade without it, and at 100 it differs.
- [x] **API/MCP:**
  - `list_assets looks` lists the catalogue.
  - An unknown Look id is refused.
  - The dry run shows `look` and `intensity`.
- [x] **Editor (vitest):**
  - A card click on a mixed Pick sets their Looks in one undo step.
  - With nothing picked, a card click sets the Candidate's Look.
  - Hovering changes nothing saved.

**Notes (done):** 24 built-in Looks in `backend/assets/looks/` (four per category), loaded by
`app/looks.py` (`builtin_looks`, `all_looks`, `get_look`), listed by `GET /api/looks`. A Look's
Adjust is laid over the Grade's own (`with_look` / `withLook`): each dial moved by as much as the
Look's is from neutral, held in range; that Adjust is folded as any other, and intensity mixes it
over the fold without the Look entry by entry (missing table or matrix = identity). The fixture's
Look cases carry the Look's values inline (`look`), so they don't depend on the catalogue; its
generator is `backend/tests/fixtures/write_grade_folds.py`. An unknown Look id is refused (422) on
save and on a draft (`_check_looks_of`); the render draws a Look missing from the catalogue as none.
The frontend loads the catalogue once (`src/looks.ts`, which registers each Look's values with the
fold via `knowLooks`); `ClipPreview` re-renders when it arrives. The Filters tab (`LookPanel.tsx`)
draws each card on the Filmstrip frame nearest the playhead (to the second) of the first picked
Segment or Overlay (an image Overlay's thumbnail), else the Clip's; hover sets an audition the
Advanced Edit draws through `relook` + `draftGrades` without touching the edits; click is
`relook` as one history step. The Color section (Inspector and clip editor) has the Look picker,
intensity and Remove look; Reset still makes the whole Grade neutral, Look included. The phone's
toolbar gains the Filters tab too (no hover there). Look values were tuned by their folded effect
on grey, black, white and a skin tone, not yet with Compare render (ticket 08).
