# 04: The Agent tab in the Inspector

**Parent spec:** `spec.md` (Solution, first paragraph; "Agent Turns").

**What to build:** in the Advanced Edit the owner opens an Agent tab in the Inspector, sets up a provider, sends a message, and sees the turn stream in.

- **Folder `frontend/src/pages/job/advanced/agent/`.** Follow `vercel-react-best-practices`:
  - The tab is a `React.lazy` import, so the chat code loads only when the tab is opened.
  - No barrel files.
  - Derived state is computed during render.
  - Event handlers live in the handlers, not in effects.
  - The composer's text is local state, so typing doesn't re-render the editor.
- **`agentStream.ts`** is a pure reducer `(state, AgentEvent) => state`. It folds events into turns and their parts (text runs, thought runs, tool rows keyed by `call`). It also has `loadTranscript(turns)`. Tested with vitest without DOM, like the `*Flow.ts` modules.
- **`useAgentStream(jobId, candidateId)`** wraps an `EventSource` on `…/agent/events` in the reducer, loads the transcript first, and closes on unmount. Follow `useCandidateEvents.ts`.
- **The tab id.** Each editor tab has a stable id. Reuse the `X-Edit-Tab` id the editor already sends.
- **`AgentTab.tsx`.**
  - Provider and model picker. The last choice is remembered per browser in localStorage, read in a try/catch, and the key is versioned.
  - Transcript, with auto-scroll that stops when the owner scrolls up.
  - Composer: Enter sends, Shift+Enter adds a line, and the Stop button replaces Send while a turn runs.
  - An empty state with three example prompts.
- **`ProviderSetup.tsx`.**
  - Shown when the chosen provider isn't ready.
  - **API provider:** a key field (password type), a base URL for OpenAI-compatible, and a model field.
  - **ACP provider:** the install hint with a copy button, a Login button (wired in 05), and the warning text when present.
- **`TurnView.tsx`, `ToolRow.tsx`.**
  - The owner's prompt.
  - Streamed text, rendered as plain text with line breaks; no Markdown library.
  - Thoughts in a `<details>`.
  - Tool rows: spinner, check or warning icon (lucide), the tool's name with any `mcp__…__` prefix removed and underscores turned into spaces, and its summary. An error shows its message.
- **`Inspector.tsx`.** Adds the Agent tab beside its existing tabs, using the same hand-built tab pattern (ADR 0024/0025: flat panels).
- **Copy and look** follow the existing Inspector panels (Tailwind tokens already used there); no new colours.

**Blocked by:** 03

**Status:** done

- [x] Reducer: a scripted event sequence gives one turn with text, a thought, and a tool row that goes from running to done with its revision.
- [x] Reducer: `tool_finished` with an error marks the row failed with the message; `turn_finished` with `cancelled` marks the turn stopped.
- [x] `ToolRow` strips `mcp__ai-clipper__` and shows `edit candidate` (renderToStaticMarkup).
- [x] `AgentTab` with no ready provider renders `ProviderSetup`; with one, it renders the composer (renderToStaticMarkup).
- [x] Typecheck passes; only the new test files are run.
