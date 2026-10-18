# 01: The layout store, and rememberedValue

**Parent spec:** `../spec.md` (Implementation Decisions "State and persistence"); docs/adr/0024-the-workspace-is-hand-built-and-browser-remembered.md; GLOSSARY (Workspace).

**What to build:** the browser-side state the whole feature stands on, with no UI yet. Seam B, pure logic — TDD.

- **`rememberedValue<T>(key, initial)` in `frontend/src/remembered.ts`,** a twin of `rememberedSwitch`: JSON in and out, a try/catch that falls back to `initial` when storage or `JSON.parse` throws, cross-tab via the `storage` event, and a `use()` over `useSyncExternalStore`. `rememberedSwitch` stays for the booleans elsewhere.
- **A layout store** (e.g. `pages/job/advanced/workspaceLayout.ts`) over one key, `ai-clipper-advanced-layout`, holding `{ assetW, inspectorW, bottomH, assetHidden, inspectorHidden, bottomTab }` (`assetW`/`inspectorW` in `rem`, `bottomH` in `dvh`, two booleans, `bottomTab` a string).
  - **Defaults and bounds:** Asset `17`/`14`/`28` rem, Inspector `20`/`16`/`34` rem, player floor `24` rem, bottom `40`/`22`/`70` dvh. Keep them as named constants the UI tickets import.
  - **A clamp used on read and on every set:** a width to its own min/max, then shortened so the player keeps its floor given the other sidebar's width; `bottomH` to its range. A hand-edited or stale blob can never place a panel out of bounds.
  - **`resetLayout()`** sets the sizes and both collapses to their defaults and leaves `bottomTab` alone.
  - **Migration:** read the old `ai-clipper-keyframes-pane` boolean once; if set, seed `bottomTab` (`"keyframes"` or `"timeline"`); after the blob exists it is the only source.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] `rememberedValue` round-trips a value, falls back to the initial when `getItem`/`JSON.parse` throws, and updates on a cross-tab `storage` event.
- [x] A width read or set past its min/max is clamped; one that would starve the player is shortened to the floor; `bottomH` is clamped to its range.
- [x] The player-floor rule is proven: at the `64rem` width both sidebars cannot be at their max at once.
- [x] `resetLayout()` restores the sizes and both collapses to defaults and leaves `bottomTab` unchanged.
- [x] The old `ai-clipper-keyframes-pane` value seeds `bottomTab` once and is not consulted after the blob exists.
- [x] Every existing backend and frontend test still passes.

## Comments

**2026-10-18, agent:** Built (frontend only, no UI yet).
- **`rememberedValue<T>`** (`frontend/src/remembered.ts`): the JSON twin of `rememberedSwitch` — try/catch fallback to `initial`, cross-tab `storage` event, `useSyncExternalStore`. It caches the parse per raw string so `read()` hands back a stable reference.
- **`workspaceLayout.ts`** (`pages/job/advanced/`): the constants (`ASSET`, `INSPECTOR`, `PLAYER_FLOOR`, `BOTTOM`), `WorkspaceLayout` + `DEFAULT_LAYOUT`, the pure helpers (`clampWidth`, `clampBottomH`, `fitSidebars`, `clampSidebarAgainstPlayer`), the `layout` store (`read`, the setters, `resetLayout`, `use`), and `migrateOnce`.
- **The player floor is a UI-time rule.** The store clamps a width only to its own min/max; the floor needs the live container width, so the shell and the divider drag call `fitSidebars` / `clampSidebarAgainstPlayer` (03). Their tests prove "floor beats max" at the 64rem width.
- **Review fix (was a latent infinite-loop bug).** `rememberedValue.read()` first reparsed JSON on every call, returning a fresh object each time; once a component read it through `useSyncExternalStore` that would re-render forever. Now the parse is cached per raw string, and `layout.use()` is `useSyncExternalStore(stored.subscribe, current)` with a cached, normalised snapshot. Added a stability regression test.
- **Migration:** `migrateOnce()` seeds `bottomTab` from the old `ai-clipper-keyframes-pane` switch once; after the new blob exists the old key is never read again (presence check).
- Tests: `remembered.test.ts`, `pages/job/advanced/workspaceLayout.test.ts`. `tsc --noEmit` clean; vitest **816 passed**. Not run in a browser (no UI yet).
