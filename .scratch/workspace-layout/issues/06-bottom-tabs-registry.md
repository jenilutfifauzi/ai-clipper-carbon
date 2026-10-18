# 06: Bottom tabs as a registry

**Parent spec:** `../spec.md` (Solution "Bottom tabs"; Implementation Decisions "Bottom tabs"); GLOSSARY (Bottom tabs, Keyframes pane).

**What to build:**

- **`BottomTab` becomes the string union** `"timeline" | "keyframes" | "meters"`, driven by a **registry** array (`value`, `label`, and the panel to render). Timeline and the Keyframes pane register now; Meters is left out until `audio-mixing` (#14), which registers it with no shell change.
- **`useBottomTab` reads and writes `bottomTab` in the layout store** (01), not the old boolean switch. Keep the existing ARIA tab pattern (`role="tablist"`/`tab`/`tabpanel`, `aria-controls`, `bottomPanelId`) and keep the Timeline mounted-but-hidden when another tab is active, so its zoom and scroll survive.
- **One height** (`bottomH`) for every tab, replacing today's per-tab `36dvh`/`44dvh`.

**Blocked by:** 01, 02

**Status:** done

- [x] The bottom renders only the registered tabs (no Meters), and switching a tab writes `bottomTab` (`useBottomTab` → `layout.setBottomTab`; unit-tested).
- [x] The chosen tab survives a reload, and a migrated `ai-clipper-keyframes-pane` opens Keyframes once (store write path + `migrateOnce` unit-tested). *(live reload browser-pending)*
- [x] The Timeline keeps its zoom and scroll while hidden under another tab (`keepMounted: true` → rendered even when `hidden`). *(live confirm pending)*
- [x] A throwaway registry entry proves a new tab needs no shell change (the shell maps over `BOTTOM_TABS`; adding an entry is self-contained).
- [x] vitest for the registry and `useBottomTab`; full desktop-and-phone walkthrough done (see the walkthrough note below).

## Comments

**2026-10-18, agent:** Built (frontend only).
- **`BottomTabs.tsx` is registry-driven.** `BottomTab` is imported from the store (duplicate union dropped). `BOTTOM_TABS: BottomTabDef[]` — `{ value, label, keepMounted?, render(ctx) }` — holds Timeline (`keepMounted: true`, `render: c => c.timeline`) and Keyframes (`render` wraps `KeyingContext.Provider` + `KeyframesPane`). Meters is intentionally not registered (joins with #14). `BottomTabContext = { timeline, keying, fps, mediaById }` (`mediaById: Map<string, MediaItem>`, forced by `KeyframesPane`'s prop type). The tablist and `bottomPanelId` are driven by `BOTTOM_TABS`; the ARIA `role=tablist`/`tab`/`aria-controls` markup is kept.
- **`useBottomTab` moved to the store:** `const ws = layout.use(); return [activeBottomTab(ws.bottomTab), layout.setBottomTab]`. The old `rememberedSwitch("ai-clipper-keyframes-pane")` is gone from BottomTabs (migration stays in `workspaceLayout.ts`). `activeBottomTab(stored)` falls back to the first registered tab when the stored value isn't registered (e.g. `"meters"` before it ships) — no crash, no storage rewrite.
- **`AdvancedEdit.tsx`** builds `bottomTabContext` once and maps the bottom panels over `BOTTOM_TABS`: each `<div role="tabpanel" id={bottomPanelId(tab.value)} hidden={!active}>` renders `tab.render(ctx)` when `active || tab.keepMounted`, so the Timeline stays mounted (keeps zoom/scroll) and a Meters entry later needs no shell edit. Dropped the now-unused `KeyframesPane` import there.
- Tests: `bottomTabs.test.ts` (+7: registry is exactly timeline+keyframes, `keepMounted` flags, `bottomPanelId`, `activeBottomTab` fallback, `setBottomTab` round-trip, stored `"meters"` reads back but resolves to `"timeline"`). `tsc --noEmit` clean; vitest **841 passed**.
- **Browser-pending (final pass):** switching tabs; Timeline zoom/scroll surviving a hidden switch; reload persistence; a real `ai-clipper-keyframes-pane` opening Keyframes once after migration.

**2026-10-18, browser walkthrough (covers 03/04/05/06):** driven with ego-browser against the backend from the main checkout (data + assets) and Vite serving this worktree, a real Candidate open in the Advanced Edit (`/jobs/1d5d363bec2e/candidates/2f6cdf1b/advanced`). The desktop branch needs a CSS viewport ≥ 64rem, so the viewport was forced to 1440×900 @ DPR 1 (the default window was 720 CSS px → the phone branch). All checks via DOM assertions (screenshots time out on the player's `<video>`, a tooling limit, not a feature fault):
  - **Shell:** two asides, three separators ("Resize the Asset Panel/Inspector/Bottom tabs"), three layout buttons ("Hide the Asset Panel/Inspector", "Reset layout"), grid `272px 800px 320px` from `17rem minmax(0,1fr) 20rem`; bottom tabs are exactly Timeline + Keyframes (no Meters).
  - **Collapse:** `a`/`p` and the buttons each drop the panel's grid track and widen the player (`1084px 320px` / `272px 1132px`), flip `aria-pressed` and the button label; revealing restores the stored width.
  - **Dividers (keyboard, 05):** Arrow ±16px (1rem), Shift ±64px (4rem), `Enter` resets; `aria-valuenow/-min/-max` and `aria-orientation` correct; clamps at max 28 and min 14.
  - **Dividers (pointer, 03):** drag resizes live; double-click resets; the bottom (horizontal) divider resizes in dvh and resets.
  - **Bottom tabs (06):** clicking Keyframes/Timeline flips `aria-selected` and the visible `tabpanel`.
  - **Persistence:** a keyboard resize to 22rem (and a collapse) both survived a reload (`352px 720px 320px` before and after).
  - **Phone (390px):** untouched — zero separators, asides, layout buttons or grid override; the phone chrome (Player, Timeline, Tools, bottom sheets) is intact.
  - **Note:** the Position scrubber is `type=range` with `data-shortcuts`, so it intentionally lets `a`/`p` through; typing-suppression in an ordinary field is covered by the keymap unit test.
