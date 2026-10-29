# 01: Restyle the Agent tab like open-pencil's chat panel

**Parent spec:** `spec.md` (Solution 1).

**Status:** ready-for-agent

**Blocked by:** None

**What to build** (frontend only, in `frontend/src/pages/job/advanced/agent/`). The reference is `<main>/docs/referensi/open-pencil-master/src/components/chat/` (`ChatMessage.vue`, `ChatComposer.vue`, `ChatInput.vue`, `ChatHistory.vue`, `ChatTranscript.vue`, `ReasoningBlock.vue`) together with `src/theme/chat/*.ts` and `src/theme/input/group.ts`. Translate the layout to ai-clipper's tokens.

**Button**
- Add a `size="sm"` to `frontend/src/components/Button.tsx`: `size-7 rounded-md`, for icon buttons.

**`TurnView.tsx`**
- User bubble: wrapper `flex justify-end`, bubble `max-w-[85%] rounded-xl rounded-br-md bg-linear-to-b from-accent to-accent-end px-3 py-2 text-sm text-on-accent whitespace-pre-wrap break-words`.
- Agent text: `group/response relative rounded-xl rounded-tl-md bg-fill px-3 py-2 text-sm`, with a Copy button (lucide `Copy`, which becomes `Check` for 1.5s after a copy) at `absolute right-1 bottom-1 opacity-0 group-hover/response:opacity-100 focus-visible:opacity-100`.
- Thoughts: a new `ReasoningBlock.tsx`, a collapsible with a Brain icon.
  - It reads "Thinking…" with a spinner while the thought is the last part of a running turn, and "Thought" otherwise.
  - It is open while it streams and closed after.
- Typing indicator: three `size-1.5 rounded-full bg-muted` dots, `motion-safe:animate-bounce`, with delays of 0, 150 and 300ms.
  - Show it while the turn runs and its last part is a finished tool, or when it has no parts yet.

**New file `Composer.tsx`** (moved out of AgentTab)
- Outer: `shrink-0 border-t border-border p-2.5`.
- Frame: `rounded-xl border border-border bg-fill transition-colors focus-within:border-accent-text focus-within:ring-1 focus-within:ring-accent/30`.
- Textarea:
  - borderless, `bg-transparent px-3 pt-2.5 pb-1 text-sm`, `rows=2`;
  - autosizes up to 160px;
  - placeholder "Describe a change…";
  - the same Enter, Shift+Enter and IME rules as now.
- Toolbar: `flex h-7 items-center gap-1 px-1.5 pb-1.5`, left to right:
  - The model pill: Bot icon, the provider label (plus the model when one is set) and a ChevronDown, `rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fill`. It opens a small popover above the composer holding the Provider and Model `Select`s that are in the header today. Use the app's existing popover pattern; if there is none, a `glass` box positioned absolutely that closes on outside click and Escape.
  - `ml-auto` Settings2 icon button, which toggles ProviderSetup as the header's gear does now.
  - Send (`variant=primary size=sm`, ArrowUp) or Stop (`size=sm`, Square).

**New file `ChatHeader.tsx`**
- `flex min-w-0 items-center gap-1 border-b border-border px-2 py-1.5`.
- Title trigger: `flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-fill`, reading "Agent" with a ChevronDown. It is inert for now; ticket 04 brings it to life.
- Then:
  - the Follow toggle (LocateFixed, `aria-pressed`, the accent colour when on): the existing one, moved here;
  - a `⋯` menu (Ellipsis) holding "Copy transcript", which copies `You: … / Agent: …` text.
- Leave a slot for a `+` button; ticket 04 adds it.

**`AgentTab.tsx`**
- The panel becomes header, then transcript (`flex-1 overflow-y-auto px-3 py-3`, `gap-3`), then composer.
- When the user has scrolled up, a "Jump to latest" button appears at `absolute right-3 bottom-3`, reusing the 24px threshold.
- The empty state's intro and example buttons are restyled to match.

**Acceptance**
- [ ] It looks like the reference screenshot (open-pencil chat) in ai-clipper's colours, in both dark and light.
- [ ] The existing `agentTab.test.tsx` passes unchanged, except where it asserts on the old header layout. Hooks and aria labels are kept.
- [ ] `npm run typecheck` and `npx vitest run src/pages/job/advanced/agent` pass.
