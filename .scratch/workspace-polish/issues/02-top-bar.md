# 02: Top bar

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `TopBar` (`advanced/Chrome.tsx`) as three columns: Back left; title + SaveStatus centred; actions right.
- Actions grouped with thin dividers: layout toggles | Downloads, Save Frame, Revision History, Save as Template | Export.
- Undo and Redo leave the top bar (they move to the timeline toolbar, 06). The phone keeps undo/redo reachable (in its Toolbar or the timeline toolbar).

**Blocked by:** 01

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- `TopBar` (`advanced/Chrome.tsx`) is a 3-column grid (on a phone: Back | title, left-aligned | actions). New props `layout` (Workspace toggles + the shortcuts button) and `actions`, split from Export by a new exported `ToolDivider`; the `history` prop is gone.
- Undo/Redo moved to a new `HistoryTools` (Chrome.tsx, titles with ⌘Z / ⇧⌘Z or Ctrl+Z / Ctrl+Y), passed to `AdvancedTimeline`'s new `history` slot, so both desktop and phone keep them (ticket 06 finishes the grouping).
- `exportButton.test.tsx` updated: order and dividers of the groups, no Undo/Redo in the top bar.
