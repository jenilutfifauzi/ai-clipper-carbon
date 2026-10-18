# 02: The desktop shell reads the layout store

**Parent spec:** `../spec.md` (Implementation Decisions "The shell"); GLOSSARY (Workspace, Asset Panel, Inspector, Bottom tabs).

**What to build:** a prefactor that changes nothing at the defaults. Today the `≥64rem` grid in `AdvancedEdit.tsx` is fixed (`17rem | minmax(0,1fr) | 20rem`, with per-tab bottom heights `36dvh`/`44dvh`). Make it read the store from 01:

- the two sidebar columns take `assetW`/`inspectorW`, or `0` (the column removed) when the matching `*Hidden` flag is set;
- the middle column stays `minmax(0,1fr)`;
- the bottom row takes `bottomH` — one height for every tab, replacing the `36dvh`/`44dvh` pair.

Leave the `<64rem` branch and `Chrome.tsx` untouched. The player keeps its existing `ResizeObserver` refit (`ClipPreview.tsx`); add nothing to the stage scaling.

**Blocked by:** 01

**Status:** done

- [x] At the default store values the desktop looks and behaves as before (17/20 rem sidebars; one bottom height).
- [x] Changing a stored width or height moves the grid, and the player refits to its new box.
- [x] A `*Hidden` flag removes that column, and the player and bottom take the freed width.
- [x] The `<64rem` phone branch and `Chrome.tsx` render exactly as before.
- [x] A test asserts the grid reflects stored widths and height, and that a hidden panel is absent.
- [x] Existing tests pass.

## Comments

**2026-10-18, agent:** Built (frontend only, a prefactor).
- **Pure helpers** in `workspaceLayout.ts`: `gridTemplateColumns(l)` builds the track list from only the columns that render (asset | player | inspector; player always `minmax(0,1fr)`; a hidden sidebar drops its track), and `bottomHeightCss(l)` → `` `${bottomH}dvh` ``. At `DEFAULT_LAYOUT` the columns are exactly `"17rem minmax(0,1fr) 20rem"`, so the shell is unchanged.
- **`AdvancedEdit.tsx` (desktop branch only):** `const ws = layout.use()`; the grid dropped its static `grid-cols-[17rem_minmax(0,1fr)_20rem]` for `style={{ gridTemplateColumns: gridTemplateColumns(ws) }}`; the Assets and Inspector `<aside>`s render only when `!ws.assetHidden` / `!ws.inspectorHidden` (player stays between them in source order); the bottom section's per-tab `h-[36/44dvh]` became one `style={{ height: bottomHeightCss(ws) }}`. No dividers/toggles yet (03/04). Phone branch, `Chrome.tsx`, `ClipPreview.tsx`, `BottomTabs.tsx` untouched; the player refits via its existing `ResizeObserver`.
- **The hidden/grid rule is unit-tested** via `gridTemplateColumns` (each hidden combination) — the house style, since the repo has no jsdom for component renders.
- Tests: `workspaceLayout.test.ts` (+10). `tsc --noEmit` clean; vitest **823 passed**. Not yet in a browser (no interactive UI to drive until 03/04).
