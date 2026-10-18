# 04: Collapse the sidebars, and Reset layout

**Parent spec:** `../spec.md` (Solution "Collapse", "Reset layout"; Implementation Decisions "Collapse and reset"); GLOSSARY (Workspace).

**What to build:**

- **Two toggle buttons** in the Advanced Edit's top controls, each lit while its panel is collapsed, that hide and show the Asset Panel and the Inspector (set the `*Hidden` flags). A revealed panel returns at its stored width.
- **Shortcuts** `a` (Asset Panel) and `p` (Inspector) in the `view` group of `keymap.ts`, ignored while typing in a field as the other letter shortcuts are. (`[` and `]` are taken by keyframe navigation.)
- **A "Reset layout" button** beside the toggles that calls `resetLayout()` (sizes and both collapses to their defaults; `bottomTab` left alone). No shortcut.

**Blocked by:** 02

**Status:** done

- [x] A toggle, and its shortcut, hides and reveals its panel; the player and Timeline take the freed width. *(code-complete; browser confirm in 06)*
- [x] A revealed panel comes back at the width it had (the store keeps the width; only `*Hidden` flips).
- [x] `a` and `p` do nothing while a field is focused (declared without `typing: true`; unit-tested).
- [x] "Reset layout" restores the sizes and both collapses, and leaves the open Bottom tab (`resetLayout` keeps `bottomTab`; unit-tested in 01).
- [x] The collapsed state survives a reload (store write path). *(round-trip browser-pending)*
- [x] vitest for the toggles and the shortcuts; browser walkthrough deferred to 06.

## Comments

**2026-10-18, agent:** Built (frontend only).
- **`keymap.ts`:** two `view`-group shortcuts, desktop-only, no `typing: true` so they are suppressed in fields — `toggle-assets` (`a`) and `toggle-inspector` (`p`); both ids added to the `ShortcutId` union. (`[`/`]` stay with keyframe nav.)
- **`commands.ts`:** `Commands` is an exhaustive `Record<ShortcutId, …>`, so the two ids had to be wired here too — `more.toggleAssets`/`toggleInspector` typed and mapped. (`commands.test.ts` fixture updated to compile.)
- **`AdvancedEdit.tsx`:** the command handlers read fresh — `() => layout.setAssetHidden(!layout.read().assetHidden)` (no stale snapshot). A `wide`-guarded `layoutControls` (`PanelLeft`/`PanelRight`/`RotateCcw` ghost icon-buttons, lit via `aria-pressed` + `aria-pressed:text-accent-text`) is passed into `TopBar`'s `actions`. `bar` is shared with the phone branch, so the `wide` guard keeps the buttons desktop-only; the phone branch and `Chrome.tsx` are untouched. Reset calls `layout.resetLayout()`, no shortcut.
- A collapsed panel already stops rendering (02) and loses its Divider (03); revealing restores its stored width. Nothing added there.
- Tests: `keymap.test.ts` (`a`→toggle-assets, `p`→toggle-inspector; `Cmd+A` still pick-all, `Cmd+P` null; suppressed when typing and when phone/not-desktop); `workspaceLayout.test.ts` (the toggle command path round-trips the flag). `tsc --noEmit` clean; vitest **834 passed**.
- **Browser-pending (06 walkthrough):** the toggles + `a`/`p` hide/reveal and the player/Timeline reflow; the lit state reads right; `a`/`p` inert in a field; Reset layout; reload persistence.
