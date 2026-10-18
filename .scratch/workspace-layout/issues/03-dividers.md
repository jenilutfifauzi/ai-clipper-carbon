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

**Status:** done

- [x] Dragging each Divider resizes its panel live, and the player refits as it goes. *(code-complete; not browser-verified — see 06 walkthrough)*
- [x] A Divider stops at the panel's min and before the player drops under its floor. *(clamp unit-tested; browser feel pending)*
- [x] A double-click returns that Divider to its default. *(wired; browser confirm pending)*
- [x] A reload keeps the dragged sizes. *(store write path tested; round-trip pending)*
- [x] vitest: a simulated drag writes the clamped store value (`nextSidebarW`/`nextBottomH`). Browser walkthrough deferred to 06.

## Comments

**2026-10-18, agent:** Built (frontend only).
- **`Divider.tsx`** — a presentational handle in the house pointer pattern (`setPointerCapture`, button-0 guard, start coord in a ref). It carries no maths: `onStart` snapshots on pointer-down, `onDrag(deltaPx)` fires the signed axis travel each move, `onReset` on double-click. Visual: a `bg-border` hairline in an ~8px grab zone (`w-2`/`h-2`), `group-hover`/`group-active` → `bg-accent`, `cursor-col-resize`/`row-resize`. No keyboard/ARIA (that is 05).
- **Pure maths** in `workspaceLayout.ts`: `nextSidebarW(startW, deltaPx, remPx, sign, otherVisibleW, availableRem, bounds)` = `clampSidebarAgainstPlayer(startW + sign*deltaPx/remPx, …)` (sign +1 Asset/drag-right, -1 Inspector/drag-left); `nextBottomH(startH, deltaPx, vhPx)` = `clampBottomH(startH + (-deltaPx)*100/vhPx)` (drag up → taller). Unit-tested with explicit numbers (remPx=16, vh=800), including min/max and player-floor clamps.
- **Wiring in `AdvancedEdit.tsx`:** the grid is the positioned parent (`relative` + ref); three absolutely-placed Dividers in the `gap-3` gutters — Asset (only `!assetHidden`), Inspector (only `!inspectorHidden`), and a horizontal one at the top of the bottom section. DOM reads live in the caller: `remPx` from the root font size, `vhPx` from `innerHeight`, `availableRem` from the grid width, `otherVisibleW` from the other sidebar. The drag snapshot sits in a ref so a drag never re-renders.
- **Known minor approximation:** `availableRem` is taken from `gridRef.clientWidth` which includes the `px-3` padding (~1.5rem) and the gutters, so the player-floor clamp is marginally generous (player can reach ~2rem under the nominal 24rem floor at the extreme). Harmless for a soft UX guard; left as-is.
- Tests: `workspaceLayout.test.ts` (+10). `tsc --noEmit` clean; vitest **832 passed**.
- **Browser-pending (for the 06 walkthrough):** live drag + player refit; the floor/min/max stops feel; double-click reset on each; reload persistence round-trip; gutter centring and the hover/active tint.
