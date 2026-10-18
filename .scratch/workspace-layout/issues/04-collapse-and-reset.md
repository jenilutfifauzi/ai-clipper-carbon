# 04: Collapse the sidebars, and Reset layout

**Parent spec:** `../spec.md` (Solution "Collapse", "Reset layout"; Implementation Decisions "Collapse and reset"); GLOSSARY (Workspace).

**What to build:**

- **Two toggle buttons** in the Advanced Edit's top controls, each lit while its panel is collapsed, that hide and show the Asset Panel and the Inspector (set the `*Hidden` flags). A revealed panel returns at its stored width.
- **Shortcuts** `a` (Asset Panel) and `p` (Inspector) in the `view` group of `keymap.ts`, ignored while typing in a field as the other letter shortcuts are. (`[` and `]` are taken by keyframe navigation.)
- **A "Reset layout" button** beside the toggles that calls `resetLayout()` (sizes and both collapses to their defaults; `bottomTab` left alone). No shortcut.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A toggle, and its shortcut, hides and reveals its panel; the player and Timeline take the freed width.
- [ ] A revealed panel comes back at the width it had.
- [ ] `a` and `p` do nothing while a field is focused.
- [ ] "Reset layout" restores the sizes and both collapses, and leaves the open Bottom tab.
- [ ] The collapsed state survives a reload.
- [ ] vitest for the toggles and the shortcuts; a browser walkthrough for the buttons.

## Comments
