# 06: Bottom tabs as a registry

**Parent spec:** `../spec.md` (Solution "Bottom tabs"; Implementation Decisions "Bottom tabs"); GLOSSARY (Bottom tabs, Keyframes pane).

**What to build:**

- **`BottomTab` becomes the string union** `"timeline" | "keyframes" | "meters"`, driven by a **registry** array (`value`, `label`, and the panel to render). Timeline and the Keyframes pane register now; Meters is left out until `audio-mixing` (#14), which registers it with no shell change.
- **`useBottomTab` reads and writes `bottomTab` in the layout store** (01), not the old boolean switch. Keep the existing ARIA tab pattern (`role="tablist"`/`tab`/`tabpanel`, `aria-controls`, `bottomPanelId`) and keep the Timeline mounted-but-hidden when another tab is active, so its zoom and scroll survive.
- **One height** (`bottomH`) for every tab, replacing today's per-tab `36dvh`/`44dvh`.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] The bottom renders only the registered tabs (no Meters), and switching a tab writes `bottomTab`.
- [ ] The chosen tab survives a reload, and a migrated `ai-clipper-keyframes-pane` opens Keyframes once.
- [ ] The Timeline keeps its zoom and scroll while hidden under another tab.
- [ ] A throwaway registry entry proves a new tab needs no shell change.
- [ ] vitest for the registry and `useBottomTab`; a full desktop-and-phone walkthrough (drag, collapse, reset, reload, keyboard; the phone unchanged).

## Comments
