# 05: Dividers on the keyboard

**Parent spec:** `../spec.md` (Solution "Keyboard"; Implementation Decisions "Dividers", keyboard); GLOSSARY (Divider).

**What to build:** make each Divider a `separator` the keyboard can reach and size — a pattern the codebase doesn't have yet.

- **Roles:** `role="separator"`, `tabindex=0`, `aria-orientation` (`vertical` for the sidebar Dividers, `horizontal` for the bottom one), and `aria-valuenow`/`-valuemin`/`-valuemax` tracking the size.
- **Keys:** the arrows resize by `16px`, Shift by `64px`, clamped as a drag is; `Enter` resets the Divider (as a double-click).
- **Focus order:** Asset Panel → its Divider → player → Inspector's Divider → Inspector → Bottom tabs → the bottom Divider.
- A **collapsed sidebar renders no separator**.

**Blocked by:** 03, 04

**Status:** done

- [x] Tab reaches each Divider in the stated order (DOM source order: Asset → its Divider → player → Inspector's Divider → Inspector → Bottom tabs → bottom Divider).
- [x] The arrow keys resize by the step (16px) and Shift by the larger step (64px), both clamped; `Enter` resets (via `dividerKeyStep`, reusing the drag path). *(live feel browser-pending)*
- [x] `aria-valuenow` follows the size and `aria-orientation` is right per Divider (asserted via `renderToStaticMarkup`).
- [x] A collapsed sidebar exposes no focusable separator (its Divider isn't rendered — same `!ws.*Hidden` guard).
- [x] vitest for the key handling and the ARIA; browser/screen-reader spot-check deferred to the final pass.

## Comments

**2026-10-18, agent:** Built (frontend only).
- **`dividerKeyStep(key, shift, orientation)`** (pure, exported from `Divider.tsx`): vertical → `ArrowRight`/`ArrowLeft` = ±step; horizontal → `ArrowDown`/`ArrowUp` = ±step; `step` 16, 64 with Shift; `Enter` → `"reset"`; else `null`. Right/down positive, so the caller's existing sign+clamp in `onDrag` applies unchanged.
- **`Divider.tsx`** now `role="separator"`, `tabIndex=0`, `aria-label` (label made required — a separator must be named), `aria-orientation`, and rounded `aria-valuenow`/`-valuemin`/`-valuemax`. `onKeyDown` runs `dividerKeyStep`; `"reset"` → `preventDefault()+onReset()`, `{deltaPx}` → `preventDefault(); onStart(); onDrag(deltaPx)` (one-shot reuse of the drag path — each press is a tiny drag from the current value), `null` → passes through (so Tab still moves focus). Focus ring via `focus-visible:outline-*` and the hairline tints on `group-focus-visible`.
- **`AdvancedEdit.tsx`:** each Divider now gets `value`/`min`/`max` (Asset `ws.assetW`/ASSET, Inspector `ws.inspectorW`/INSPECTOR, Bottom `ws.bottomH`/BOTTOM) and a `label`. The grid children were reordered to the stated focus order (the Dividers are absolutely positioned, so flow order is free). The callers' `onStart` already read only the DOM/closure (no PointerEvent), so keyboard reuse needed no refactor.
- Tests: `divider.test.tsx` (+10: `dividerKeyStep` every branch both orientations, Shift step, `Enter` reset, `null` fall-through; ARIA via `renderToStaticMarkup` — `role="separator"`, tabindex, label, orientation, rounded values, `role="presentation"` gone). `tsc --noEmit` clean; vitest **851 passed**.
- **Browser/AT-pending (final pass):** Tab order + visible focus ring; arrow/Shift resize feel and clamps; `Enter` reset; a screen reader announcing the named separator + orientation + value; collapsed sidebar not tabbable.
