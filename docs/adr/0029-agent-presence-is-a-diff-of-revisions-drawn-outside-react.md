# 0029: Agent Presence is a diff of Revisions, drawn outside React

Status: accepted
Date: 2026-10-24

## Context

While an Agent works, Segments and layers change in place on the Timeline with no hint of what was touched. The `agent-mode` feature (`.scratch/agent-mode/spec.md`) wants Agent Presence: a cursor on the Timeline, a pulse on what a running tool call touches, a flash on what a new Revision changed, outlines on the preview, and Follow agent.

Today:
- **The Advanced Edit page re-renders on every change of its state**, and its Timeline and preview are heavy. An animation driven through React state would re-render them at every event.
- **Tool calls name items in many shapes.** `edit_candidate` sends whole lists, `merge_candidate_items` sends some items by id, and a Template or a Narration adds items the call never names.
- **Every save is a Revision**, pushed live with the whole Candidate (ADR 0003).

## Decision

- **What changed is computed from the diff of consecutive Revisions, not from tool arguments.** `touchedItems(before, after)` compares two Advanced Edits by item id, per kind. The items it returns are the ones that flash, are outlined on the preview (Text Layers, Shapes and Overlays), and that the cursor and Follow agent go to. While a tool call runs, the pulse falls on the items the last diff touched.
- **It is kept in a store outside React state.** A small presence store, read with `useSyncExternalStore`, holds the status, the cursor's target and the pulsing and flashing ids. Only the components that draw presence subscribe to it; the editor page doesn't re-render for an animation.
- **It is shown by CSS on wrapper elements.** Timeline items and preview pictures get a mark on a wrapper, and CSS keyframes do the pulse, the flash (about 700 ms) and the cursor's glide (180 ms, ease-out). With `prefers-reduced-motion`, the pulse and flash are a still outline and the cursor jumps.
- **Presence is never saved and never undone.** Follow agent is a switch remembered by the browser; scrolling or zooming the Timeline by hand turns it off for the rest of the turn.

## Considered options

- **Touched items from tool arguments.** Known before the save, so the pulse could come sooner; but every tool's arguments would need their own reading, and what a Template or a Narration adds would be missed. The diff is right for every tool, and for any later one.
- **The diff on the server, sent with each event.** The editor already holds both Revisions, and the server would have to know the editor's item kinds.
- **Presence in the Advanced Edit's React state.** The simplest, but each flash would re-render the Timeline and preview.
- **Animating in JavaScript (`requestAnimationFrame` or a motion library).** It needs a loop per item, or a dependency the codebase doesn't have; CSS keyframes run off the main thread and stop by themselves.

## Consequences

- **Presence follows saves, not intentions.** A tool call that changes nothing shows nothing, and a dry run never flashes.
- **A new item kind needs its place in `touchedItems`** to show presence.
- **Not now:** presence across machines, and presence for an outside agent reaching the full MCP server.
