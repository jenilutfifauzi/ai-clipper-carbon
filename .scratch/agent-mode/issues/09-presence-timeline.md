# 09: Agent Presence on the Timeline: cursor, pulse, flash

**Parent spec:** `spec.md` (Solution "Agent Presence"); ADR 0029.

**What to build:** while a turn runs, a labelled cursor glides along the Timeline to what the agent is changing, items pulse while a tool runs, and every item a Revision changed flashes once.

- **`touched.ts`.** `touchedItems(before: AdvancedEdits, after: AdvancedEdits): Touched` returns ids added, changed or removed per kind: `segments`, `text_layers`, `shapes`, `music`, `overlays`, `adjustment_layers`, `transitions`.
  - Items are compared by `id`, with a stable shallow-deep compare.
  - Changes with no id (grade, captions style, hook, layout, cue and word edits) come back as named flags (`captions`, `hook`, `grade`, ...).
  - Use `Map` lookups (js-index-maps).
- **`presence.ts`.** A tiny external store (`subscribe` / `getSnapshot`) per editor. It holds:
  - `status`: `idle | thinking | editing`
  - `label`: the provider's name
  - `target`: Timeline time and track row of the first touched item
  - `pulsing`: ids
  - `flashing`: ids, with an expiry
  - Driven by agent events: `turn_started` → thinking; `tool_started` → editing, pulsing the last touched ids; `tool_finished` → thinking; `turn_finished` → idle after 1.5 s.
  - Driven by adopted or outside agent Revisions through `touchedItems`: flashing for 700 ms, and target set.
  - Timers live in the store, not in React effects.
- **`AgentCursor.tsx`.** Absolutely positioned over the Timeline's track area. It reads the store with `useSyncExternalStore` and moves with `transform: translate3d` and a 180 ms ease-out transition on a wrapper div. It shows an arrow plus a pill (`label · thinking…` when thinking). It is hidden when idle.
- **Timeline items.**
  - `Tracks.tsx` and `MainTrack.tsx` read whether their id is pulsing or flashing through a selector hook. The hook subscribes to a derived boolean per item (rerender-derived-state), so one flash re-renders only its items.
  - Each such item gets `data-agent="pulse|flash"`. CSS keyframes in the existing stylesheet:
    - pulse: a 1.4 s outline/opacity breathe
    - flash: a 700 ms ring that fades
  - The colour is the app's existing accent token.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `touchedItems`: an added Text Layer, a trimmed Segment, a removed Music Clip and a changed grade come back as such; equal edits give nothing.
- [ ] Presence store: the event sequence gives thinking → editing → thinking → idle, flashing expires after 700 ms (fake timers), and `target` follows the first touched item.
- [ ] `AgentCursor` renders nothing when idle and the label when thinking (renderToStaticMarkup with a seeded store).
- [ ] Only the new test files and touched timeline tests are run.
