# 02: The desktop shell reads the layout store

**Parent spec:** `../spec.md` (Implementation Decisions "The shell"); GLOSSARY (Workspace, Asset Panel, Inspector, Bottom tabs).

**What to build:** a prefactor that changes nothing at the defaults. Today the `≥64rem` grid in `AdvancedEdit.tsx` is fixed (`17rem | minmax(0,1fr) | 20rem`, with per-tab bottom heights `36dvh`/`44dvh`). Make it read the store from 01:

- the two sidebar columns take `assetW`/`inspectorW`, or `0` (the column removed) when the matching `*Hidden` flag is set;
- the middle column stays `minmax(0,1fr)`;
- the bottom row takes `bottomH` — one height for every tab, replacing the `36dvh`/`44dvh` pair.

Leave the `<64rem` branch and `Chrome.tsx` untouched. The player keeps its existing `ResizeObserver` refit (`ClipPreview.tsx`); add nothing to the stage scaling.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] At the default store values the desktop looks and behaves as before (17/20 rem sidebars; one bottom height).
- [ ] Changing a stored width or height moves the grid, and the player refits to its new box.
- [ ] A `*Hidden` flag removes that column, and the player and bottom take the freed width.
- [ ] The `<64rem` phone branch and `Chrome.tsx` render exactly as before.
- [ ] A test asserts the grid reflects stored widths and height, and that a hidden panel is absent.
- [ ] Existing tests pass.

## Comments
