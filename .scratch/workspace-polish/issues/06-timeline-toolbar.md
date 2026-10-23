# 06: Timeline toolbar

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `AdvancedTimeline`'s toolbar row in groups split by thin dividers: Undo/Redo | Split, Freeze, Duplicate, Copy, Paste, Delete | Magnet, Skim | Add Text, Add Audio | Zoom −, +, fit (right).
- Add Text opens the Text tab, Add Audio opens Media on Audio; both reveal the Asset Panel if it is collapsed (on a phone, open the matching sheet).
- Track headers keep lock/eye/mute; tidy spacing only.

**Blocked by:** 02, 03

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- `AdvancedTimeline` takes `history`, `tools`, `modes` and `adds` and renders them as groups split by `ToolDivider`: Undo/Redo | Split, Freeze, Duplicate, Copy, Paste, Delete (`ItemTools`, unchanged) | Magnet + Skim/Skim sound (Skim moved from its own right-hand group) | Add Text, Add Audio; Zoom −, +, fit stay on the right. On a phone the groups scroll sideways as before (no Skim there).
- New `AddTools` (Chrome.tsx: Type icon "Add text", speaker icon "Add audio"). `openAsset(tab, category)` in AdvancedEdit sets the tab (and Media's Audio category); on a desktop it re-shows a collapsed Asset Panel (`layout.setAssetHidden(false)`), on a phone it opens the matching sheet.
- Track headers: only spacing (gap between name and buttons, small gap between lock/eye/mute buttons) in `Tracks.tsx`.
- New `timelineToolbar.test.tsx` (group order, three dividers, phone without Skim, Undo/Redo titles and disabled state, Add buttons). Ran with exportButton, divider, bottomTabs, trackState; `tsc --noEmit` clean.
