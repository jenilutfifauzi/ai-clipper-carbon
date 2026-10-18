# 03: Dividers that drag to resize

**Parent spec:** `../spec.md` (Solution "Resize"; Implementation Decisions "Dividers"); GLOSSARY (Divider).

**What to build:** a `Divider` component and the three Dividers that size the Workspace.

- **Drawn** as the codebase draws hairlines (a `border-border` line with an ~`8px` grab zone), tinted on hover and focus, with the right resize cursor (`col-resize`/`row-resize`).
- **Pointer drag in the house pattern** (`setPointerCapture`, a button-0 check, state in a `ref`, as in `TextBoxGrips.tsx`): each move writes the store's width/height, clamped (the panel's min/max and the player's floor), live, frame by frame.
- **Three:** beside the Asset Panel, beside the Inspector, above the Bottom tabs.
- **Double-click** resets that Divider to its default.
- **No undo** for a layout change — it is browser state, not a Candidate edit.
- A **collapsed sidebar renders no Divider** (collapse itself is 04; here guard on the `*Hidden` flag).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Dragging each Divider resizes its panel live, and the player refits as it goes.
- [ ] A Divider stops at the panel's min and before the player drops under its floor.
- [ ] A double-click returns that Divider to its default.
- [ ] A reload keeps the dragged sizes.
- [ ] vitest: a simulated drag writes the clamped store value. Browser walkthrough: drag all three, hit the floor, double-click to reset.

## Comments
