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

**Status:** ready-for-agent

- [ ] **Built-in Looks:** they load, their ids are unique, and every Adjust value is in range.
- [ ] **Fixture:** the shared fold fixture covers Looks at 0, 50 and 100%.
- [ ] **Render:** a Look at intensity 0 matches the Grade without it, and at 100 it differs.
- [ ] **API/MCP:**
  - `list_assets looks` lists the catalogue.
  - An unknown Look id is refused.
  - The dry run shows `look` and `intensity`.
- [ ] **Editor (vitest):**
  - A card click on a mixed Pick sets their Looks in one undo step.
  - With nothing picked, a card click sets the Candidate's Look.
  - Hovering changes nothing saved.
