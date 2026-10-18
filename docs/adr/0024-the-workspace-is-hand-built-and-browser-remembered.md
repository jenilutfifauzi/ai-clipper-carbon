# 0024: The Workspace is hand-built and remembered by the browser

Status: accepted
Date: 2026-10-18

## Context

The `workspace-layout` feature (roadmap #22, `.scratch/advanced-edit-v2/roadmap.md`) is a lighter take on Concat's dockable workspace (`src/crates/concat/src/dock.rs`, `ui/workspace/*.slint`: a tree of Monitor, Timeline, Library, Inspector, Keyframes, Meters and Config panels that split, add, remove, swap and float, with a compact dock under 860 px). The roadmap keeps full drag-to-dock out (`.scratch/advanced-edit-v2/roadmap.md`, section A) and wants only the useful parts.

Today the Advanced Edit is a fixed CSS grid on a desktop (`AdvancedEdit.tsx`: `17rem | minmax(0,1fr) | 20rem` for the Asset Panel, the player and the Inspector, with the Timeline below) and a fixed stack with bottom sheets on a phone (`Chrome.tsx`). The player already fits itself to its box (`ClipPreview.tsx`, a `ResizeObserver` scaling the 1080×1920 stage). The bottom area is already tabbed (`BottomTabs.tsx`, a boolean Timeline/Keyframes switch kept in `localStorage`). The codebase carries no runtime UI dependency (React, Tailwind and `lucide-react` only), remembers browser preferences through `remembered.ts` (`rememberedSwitch`, try/catch, cross-tab), and has no per-user settings store on the backend.

What is wanted: drag the two sidebars and the bottom height to size, collapse the Asset Panel and the Inspector away, a tabbed bottom that later features (Meters) can join, and a layout that survives a reload.

## Decision

- **The Workspace is hand-built, not a library.** Pointer handlers in the codebase's own style (`TextBoxGrips.tsx`) size the Dividers; a small `rememberedValue<T>` beside `rememberedSwitch` keeps the layout. No `react-resizable-panels` or other panel library.
- **It is a fixed shell, not a dock tree.** The three regions stay put — Asset Panel, player, Inspector, with the Bottom tabs under them. Only three Dividers and two collapses move. There is no drag-to-dock, no splitting, no floating, no swapping a panel's kind.
- **The player is the filler and sizes itself.** It is never dragged directly; it takes what the sidebars and the bottom leave, and its existing `ResizeObserver` refits the stage. The Dividers clamp so it keeps a floor (24rem), so it never collapses to nothing.
- **The Bottom tabs are a registry.** `bottomTab` becomes a string (`timeline | keyframes | meters`) driven by a config array, so Meters (feature #14) and any later view slot in by registering a tab, without reshaping the shell. One height serves every tab.
- **The layout is remembered in one browser blob.** A single `localStorage` key holds `{ assetW, inspectorW, bottomH, assetHidden, inspectorHidden, bottomTab }`, wrapped in try/catch like the rest of `remembered.ts`. Nothing goes to the backend. The old `ai-clipper-keyframes-pane` key is migrated into this blob's `bottomTab` once. The phone layout is untouched.

## Considered options

- **A panel library (`react-resizable-panels`, `re-resizable`).** Keyboard accessibility and persistence come for free, but it would be the first runtime UI dependency in a codebase that has none, for a shell that is three Dividers and two toggles — small enough to own in the house style.
- **A real dock tree like Concat** (split, add, remove, float, swap a panel's kind, a separate compact tree). The most flexible, but heavy to build and maintain, and a browser podcast-clip editor doesn't need the user to rebuild their workspace; the fixed shell covers every ask in the roadmap.
- **A side-by-side bottom** (Timeline and Keyframes at once, with a Divider between). Stronger, but the bottom is already tabbed, and under a 1080×1920 preview the vertical room is tight; tabs keep each view full-height and the shell simple.
- **Per-user settings on the backend** (extend the Channel Profile, or a new `UiSettings`). It would follow the user to another device, but the backend has no per-user store today and a layout preference doesn't earn one; `localStorage` matches how the theme and the Magnetic timeline switch are already kept.

## Consequences

- **A new accessible pattern.** The Dividers are `role="separator"`, focusable, sized by the arrow keys — something the codebase didn't have; it is reusable for any later splitter.
- **`bottomTab` stops being a boolean.** `useBottomTab` is rewritten around the registry, and the old keyframes-pane key is read once and folded into the blob.
- **No model or MCP change.** The Workspace never reaches the Render Plan; a Clip renders the same whatever the layout, so the shared-context rule that every new field be reachable through the MCP tools does not apply here.
- **Reversible at the edges, not the centre.** Moving to a library or to backend sync later means swapping the helper and the shell, not rewriting the features built on it: a later panel only registers a tab or renders inside a sidebar.
- **Not now:** drag-to-dock, floating or split panels, swapping a panel's kind, a per-tab bottom height, and syncing the layout across devices.
