# 09: Starred effects

**Parent spec:** `../spec.md` ("Favourites"); ADR 0014.

**What to build:** the owner stars the effects they use often and filters the library to them.
- **Where the stars are:** on every effect tile of the Effects tab and of the "Add effect" popovers, for both Video Effects and Audio Effects.
- **The filter:** a Starred chip in each library shows only the starred ones.
- **Storage:** the stars are one global list of catalogue ids kept on the server, for every Job. The desktop and the phone see the same list.
- **An id the catalogue no longer has** stays in the list but is not shown.

**The backend:** a small global store with a read endpoint and a write endpoint (set or toggle). It is not part of any Candidate and not in MCP.

**Blocked by:** 08.

**Status:** done

- [x] Starring and unstarring a tile in the Effects tab and in both "Add effect" popovers is saved on the server and survives a reload.
- [x] The Starred chip filters each library to its starred effects.
- [x] The endpoint refuses a malformed id list. An unknown id is kept but not shown.
- [x] Backend test: stars written through the endpoint are read back, and the store survives a restart of the app's data.

## Comments

Built end to end; not in MCP and not part of any Candidate.
- **Backend:** `app/starred_effects.py`: `StarredStore` (`load`, `save`) on `DATA_DIR/starred_effects.json` (`STARRED_FILE`), as the Channel Profile's store; `app.state.starred`. `Starred` validates the list: kebab-case catalogue ids (at most 64 characters), each at most once, at most 200. Unknown ids are kept.
  - `GET /api/starred-effects` lists the ids; `PUT /api/starred-effects` replaces the whole list (422 for a malformed one). Video and Audio Effect ids share the list (they don't collide).
  - `tests/test_starred_effects.py`: read back, a restart of the app on the same data, and the malformed lists.
- **Frontend:**
  - `src/starredEffects.ts`: `useStarredEffects()` (the server's list, loaded once for the page), `toggleStar(id)` (shown at once, saved with a PUT of the whole list; toggles run one after the other; a failed save lists the server's again, silently), and `starredOnly(kinds, stars, only)`.
  - `listStore` gained `set(items)`.
  - `advanced/Stars.tsx`: `StarButton` (`data-star`, `aria-pressed`; `onPicture` for a card's corner) and `StarredChip`, with `NO_STARRED` for an empty starred library.
  - The stars and the chip are on `EffectCards` (the star sits beside the card's button, over its picture's corner; `starred` prop overrides the server's list for tests), on `AddVideoEffect` and on `AddEffect` (Audio, the phone's sheet included). The chip's state is per library and not remembered.
  - The phone sees the same list, but it has no Video Effects library (desktop only, 08); its Audio Effects popover has the stars.
- **Not verified in a browser:** the star's look over the card and in the popovers. vitest (`src/starredEffects.test.tsx`) covers the toggles, the filter and the cards' markup.

Review fix: when the list can't be loaded, `toggleStar` does nothing. It never PUTs a list built from `[]`, which would replace the server's. The next toggle loads the list again.
