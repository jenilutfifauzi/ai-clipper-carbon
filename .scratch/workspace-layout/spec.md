# Workspace layout: resizable, collapsible panels remembered by the browser

Status: ready-for-agent
Created: 2026-10-18

## Problem Statement

The Advanced Edit's desktop is a fixed CSS grid (`AdvancedEdit.tsx`, at `≥64rem`: a `17rem` Asset Panel, the player, a `20rem` Inspector, and the Timeline below). Nothing moves.

**The sizes are frozen.** A long Inspector (Transform, the coming Adjust, effects) or a dense Timeline has no more room, and the player can't be given the width when the sidebars aren't in use. The one choice today is the bottom's tab (Timeline or Keyframes), kept as a boolean in `localStorage` (`BottomTabs.tsx`).

**The coming features need the room.** `keyframes`, `audio-mixing` (Meters) and `color-adjust` each add a panel or lengthen the Inspector (roadmap #22, note on order). They should slot into a shell that already bends, not force the grid to be rebuilt each time.

**Concat bends fully.** Its workspace is a dock tree (`src/crates/concat/src/dock.rs`, `ui/workspace/*.slint`): Monitor, Timeline, Library, Inspector, Keyframes, Meters and Config panels that split, add, remove, swap a kind and float, with a compact dock under 860 px. The roadmap keeps the heavy half out (`.scratch/advanced-edit-v2/roadmap.md`, section A: "docking penuh dengan drag-to-dock" is replaced by this lighter feature) and wants only resize, collapse, a tabbed bottom and a remembered layout.

## Solution

A **Workspace**: the Advanced Edit's desktop laid out so the owner can size and hide its panels, remembered by the browser. The phone's layout is unchanged.

**Hand-built, a fixed shell.** The three regions stay put — the **Asset Panel** on the left, the player in the middle, the **Inspector** on the right, with the **Bottom tabs** under them. Only its **Dividers** and its two collapses move. No drag-to-dock, no splitting, no floating, no swapping a panel's kind. Built in the codebase's own style (pointer handlers like `TextBoxGrips.tsx`, state like `remembered.ts`), with no panel library (ADR 0024).

**Resize.** Three Dividers:
- one beside the Asset Panel (its width);
- one beside the Inspector (its width);
- one above the Bottom tabs (their height).

Dragging a Divider sizes the panel on its side live, frame by frame. Each clamps at the panel's least size, and the two sidebars together never take so much that the player drops under its floor (so the player is never dragged to nothing). A **double-click** on a Divider resets that Divider to its default.

**Collapse.** The Asset Panel and the Inspector can be collapsed away — hidden, not shrunk to a rail — so the player and the Timeline take the whole width. Each has a toggle in the top controls (lit while it is collapsed) and a shortcut (`a` for the Asset Panel, `p` for the Inspector). A collapsed panel comes back at the width it had.

**Reset layout.** A control in the top controls returns the sidebars' widths, the bottom's height and both collapses to their defaults. It leaves the open Bottom tab alone (a view, not the layout).

**The player sizes itself.** It is the filler: it takes what the sidebars and the bottom leave, and its existing `ResizeObserver` (`ClipPreview.tsx`) refits the 1080×1920 stage into the new box. No new scaling maths.

**Bottom tabs.** The bottom stays tabbed (not side by side). The tab becomes one of a small **registry** — Timeline and the Keyframes pane now, Meters once `audio-mixing` lands — so a later view joins by registering a tab, without reshaping the shell. One height serves every tab.

**Remembered per browser.** The whole layout is one `localStorage` blob, wrapped in try/catch and synced across tabs, like the theme and the Magnetic timeline switch. Nothing goes to the backend. No model, MCP or renderer change: a Clip renders the same whatever the layout.

**Keyboard.** Each Divider is a `separator` the keyboard can reach and size; the collapse toggles have shortcuts; the focus order runs left to right, top to bottom.

## User Stories

1. As the owner, I want to drag the edge of the Asset Panel or the Inspector to make it wider or narrower, so that a panel has the room its contents need.
2. As the owner, I want to drag the top of the Bottom tabs to make the Timeline taller or shorter, so that I can see more tracks or more of the player.
3. As the owner, I want a Divider to stop before the player gets too small, so that I can't hide the thing I'm editing by accident.
4. As the owner, I want to double-click a Divider to put it back to its default width or height, so that one slip is easy to undo.
5. As the owner, I want to collapse the Asset Panel or the Inspector away, so that the player and Timeline fill the screen while I watch or arrange.
6. As the owner, I want a lit toggle (and a shortcut) to bring a collapsed panel back at the width it had, so that hiding a panel is not a trap.
7. As the owner, I want one "Reset layout" control, so that I can get back to the stock arrangement without fiddling with each Divider.
8. As the owner, I want the player to refit itself the instant a panel resizes, so that the preview is always the right shape and what I place is what I publish.
9. As the owner, I want the bottom to stay a set of tabs (Timeline, Keyframes, and Meters later), so that each view has the full height and nothing is cramped.
10. As the owner, I want my layout to be there when I come back, so that I set it up once.
11. As a keyboard user, I want to Tab to a Divider and size it with the arrows, and toggle a panel with a key, so that the Workspace is not mouse-only.
12. As the owner on a phone, I want nothing to change, so that the touch layout I know still works.

## Implementation Decisions

### What is adjustable

- **Three Dividers, two collapses, one tab height.** Resizable: the Asset Panel's width, the Inspector's width, the Bottom tabs' height. Collapsible (hidden): the Asset Panel and the Inspector. The player is never sized or collapsed directly; it is the filler.
- **Bounds (CSS units, matching today's `rem`/`dvh`):**
  - Asset Panel: default `17rem`, min `14rem`, max `28rem`.
  - Inspector: default `20rem`, min `16rem`, max `34rem`.
  - Player floor: min `24rem` of content width.
  - Bottom tabs: default `40dvh`, min `22dvh`, max `70dvh`.
- **The floor beats the max.** A sidebar's effective widest is the smaller of its own max and what leaves the player its floor, so on a narrow desktop both sidebars can't be at their max at once. The defaults plus the floor fit at the `64rem` breakpoint.

### State and persistence

- **One store,** a small module (e.g. `workspaceLayout.ts`) over `localStorage`, read through React like `remembered.ts`.
- **One key, one blob:** `ai-clipper-advanced-layout` → `{ assetW, inspectorW, bottomH, assetHidden, inspectorHidden, bottomTab }`. `assetW`/`inspectorW` in `rem`, `bottomH` in `dvh`, the two `*Hidden` booleans, `bottomTab` a string.
- **A new helper `rememberedValue<T>(key, initial)` in `remembered.ts`,** a twin of `rememberedSwitch`: JSON in and out, a try/catch that falls back to the initial value, cross-tab via the `storage` event, and a `use()` on `useSyncExternalStore`. `rememberedSwitch` stays for the booleans elsewhere.
- **Reads are clamped on the way out,** so a hand-edited or stale value can't place a panel past its bounds or under the player's floor.
- **Migration:** the old `ai-clipper-keyframes-pane` boolean is read once; if set, it seeds `bottomTab` (`"keyframes"` or `"timeline"`) in the new blob, after which the blob is the source. No other stored state changes.

### The shell (`AdvancedEdit.tsx`)

- **The `≥64rem` grid becomes driven by the store:** the two sidebar columns take `assetW`/`inspectorW` (or `0`, removed, when hidden), the middle stays `minmax(0,1fr)`, and the bottom row takes `bottomH`.
- **The `<64rem` branch and `Chrome.tsx` are untouched:** no Dividers, no toggles, the bottom sheets and fixed heights stay.
- **The player keeps its `ResizeObserver` refit;** nothing new drives the stage scale.
- **Fullscreen is unchanged:** it already hides the chrome; leaving it restores the stored layout.

### Dividers

- **A `Divider` component** drawn as the codebase draws hairlines (a `border-border` line with an ~`8px` grab zone), tinted on hover and focus, with the right resize cursor.
- **Pointer drag in the house pattern** (`setPointerCapture`, button-0 check, state in a `ref`, like `TextBoxGrips.tsx`): the drag sets the store's width/height each move, clamped. One drag is immediate; there is no undo for layout (it is browser state, not a Candidate edit).
- **A collapsed sidebar has no Divider;** its toggle brings it back.
- **Keyboard:** `role="separator"`, `tabindex=0`, `aria-orientation` (`vertical` for the sidebar Dividers, `horizontal` for the bottom one), and `aria-valuenow`/`-valuemin`/`-valuemax`. The arrows resize by `16px` (1rem-ish), Shift by `64px`; `Enter` or a double-click resets. Focus order: Asset Panel → its Divider → player → Inspector's Divider → Inspector → Bottom tabs → the bottom Divider.

### Collapse and reset

- **Two toggle buttons** in the Advanced Edit's top controls, each lit while its panel is collapsed, with the shortcuts `a` (Asset Panel) and `p` (Inspector) in the `view` group of `keymap.ts`, ignored while typing in a field as the other letter shortcuts are. (`[` and `]` are taken by keyframe navigation.)
- **A "Reset layout" button** beside them resets `assetW`, `inspectorW`, `bottomH`, `assetHidden` and `inspectorHidden` to their defaults; `bottomTab` is left as is. There is no shortcut for it.

### Bottom tabs (`BottomTabs.tsx`)

- **`BottomTab` becomes a string union** `"timeline" | "keyframes" | "meters"`, driven by a registry array `[{ value, label, render }]` (or a `render` the shell supplies), so a later tab is one entry. Timeline and Keyframes ship; Meters is not registered until `audio-mixing`.
- **`useBottomTab` is rewritten** to read/write `bottomTab` in the layout store instead of the boolean switch, keeping the existing ARIA tab pattern (`role="tablist"`/`tab`/`tabpanel`, `aria-controls`, `bottomPanelId`). The Timeline stays mounted and hidden when another tab is active, as today, to keep its zoom and scroll.
- **One height** (`bottomH`) for every tab, replacing today's per-tab `36dvh`/`44dvh`.

### Not touched

- **No backend, MCP or renderer change.** The Workspace is browser-only UI state; it never reaches the Candidate, the Render Plan or the filter graph. The shared-context rule that new model fields be reachable through the MCP tools does not apply.

## Testing Decisions

Good tests here check stored state and what the shell renders, not pixels. Frontend only (vitest + a browser walkthrough); the backend suite is unaffected and stays green.

- **`rememberedValue` (vitest):** round-trips a value through `localStorage`; falls back to the initial value when `getItem`/`JSON.parse` throws; updates on a cross-tab `storage` event.
- **The layout store (vitest):**
  - clamps a width to its min/max and shortens it so the player keeps its floor;
  - collapse hides a panel and its Divider; the toggle restores the prior width;
  - "Reset layout" restores the sizes and both collapses but leaves `bottomTab`;
  - the old `ai-clipper-keyframes-pane` boolean migrates into `bottomTab` once, and is not read again after the blob exists.
- **Dividers (vitest, jsdom):** a `separator`'s arrow key changes the stored size by the step and Shift by the larger step, both clamped; `Enter` and double-click reset; a collapsed sidebar renders no `separator`.
- **Bottom tabs (vitest):** the registry renders its registered tabs and no more (Meters absent); switching tabs writes `bottomTab`; the Timeline stays mounted while hidden.
- **Shortcuts (vitest):** `a` and `p` toggle the panels and are ignored while a field is focused.
- **Phone (vitest):** below `64rem` no Dividers, toggles or reset render, and `Chrome.tsx` is as before.
- **Browser walkthrough (skill `run`/`ego-browser`, desktop and phone):** drag each Divider and watch the player refit; hit the player floor; double-click to reset; collapse and reveal with buttons and with `a`/`p`; "Reset layout"; reload and see the layout kept; Tab to a Divider and size it with the arrows; confirm the phone is unchanged.

## Out of Scope

- **Drag-to-dock, splitting, floating, and swapping a panel's kind** — the heavy half of Concat's dock. The fixed shell covers the asks.
- **A side-by-side bottom** (Timeline and Keyframes at once). Tabs keep each view full-height under a tall preview.
- **A per-tab bottom height.** One height serves all tabs.
- **A Meters tab now.** It registers with `audio-mixing` (#14); the shell is built so it needs no rewrite.
- **Backend or per-user persistence / syncing the layout across devices.** It is `localStorage`, per browser.
- **Any phone-layout change.** The touch shell and bottom sheets are untouched.
- **Resizing or collapsing the player itself.** It is always the filler.
- **Undo/redo for layout changes.** The layout is browser state, not a Candidate edit.

## Further Notes

- Decided in a grilling session on 2026-10-18. See ADR 0024 (the Workspace is hand-built and browser-remembered) and GLOSSARY (Workspace, Divider, Bottom tabs, Asset Panel, Inspector).
- Order: this comes before `keyframes`, `audio-mixing` (Meters) and `color-adjust`, which add panels or lengthen the Inspector (roadmap #22 note).
- Reference for behaviour only (never code, licence): `docs/referensi/concat/src/crates/concat/src/dock.rs` and `docs/referensi/concat/ui/workspace/*.slint` (panel inventory, hover-lit splitters, min sizes, the compact threshold).
