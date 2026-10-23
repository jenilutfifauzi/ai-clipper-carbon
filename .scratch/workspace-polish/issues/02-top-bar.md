# 02: Top bar

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `TopBar` (`advanced/Chrome.tsx`) as three columns: Back left; title + SaveStatus centred; actions right.
- Actions grouped with thin dividers: layout toggles | Downloads, Save Frame, Revision History, Save as Template | Export.
- Undo and Redo leave the top bar (they move to the timeline toolbar, 06). The phone keeps undo/redo reachable (in its Toolbar or the timeline toolbar).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
