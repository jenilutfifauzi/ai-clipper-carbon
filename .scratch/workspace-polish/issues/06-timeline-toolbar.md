# 06: Timeline toolbar

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `AdvancedTimeline`'s toolbar row in groups split by thin dividers: Undo/Redo | Split, Freeze, Duplicate, Copy, Paste, Delete | Magnet, Skim | Add Text, Add Audio | Zoom −, +, fit (right).
- Add Text opens the Text tab, Add Audio opens Media on Audio; both reveal the Asset Panel if it is collapsed (on a phone, open the matching sheet).
- Track headers keep lock/eye/mute; tidy spacing only.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
