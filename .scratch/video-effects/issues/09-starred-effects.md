# 09: Starred effects

**Parent spec:** `../spec.md` ("Favourites"); ADR 0014.

**What to build:** the owner stars the effects they use often and filters the library to them.
- **Where the stars are:** on every effect tile of the Effects tab and of the "Add effect" popovers, for both Video Effects and Audio Effects.
- **The filter:** a Starred chip in each library shows only the starred ones.
- **Storage:** the stars are one global list of catalogue ids kept on the server, for every Job. The desktop and the phone see the same list.
- **An id the catalogue no longer has** stays in the list but is not shown.

**The backend:** a small global store with a read endpoint and a write endpoint (set or toggle). It is not part of any Candidate and not in MCP.

**Blocked by:** 08.

**Status:** ready-for-agent

- [ ] Starring and unstarring a tile in the Effects tab and in both "Add effect" popovers is saved on the server and survives a reload.
- [ ] The Starred chip filters each library to its starred effects.
- [ ] The endpoint refuses a malformed id list. An unknown id is kept but not shown.
- [ ] Backend test: stars written through the endpoint are read back, and the store survives a restart of the app's data.
