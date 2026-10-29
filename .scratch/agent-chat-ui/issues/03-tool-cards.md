# 03: Collapsible tool cards with input and output

**Parent spec:** `spec.md` (Solution 3).

**Status:** ready-for-agent

**Blocked by:** 01

## Backend (`backend/app/agent/`)

**Events** (`events.py`)
- `ToolStarted` gets `input: str | None = None` and `ToolFinished` gets `output: str | None = None`.
- Both hold JSON or text cut to 4096 characters. Write a helper that cuts and appends `…` when it cuts.
- Ticket 05 needs the full output of `show_ui`, so make the cut skip tools whose name ends in `show_ui`, or put the cut in one helper that ticket 05 can bypass.

**API loop** (`api_loop.py`)
- `input` is `call.arguments` and `output` is the tool result's text, at about `:114-118`.

**ACP** (`acp_client.py`)
- `input` is `json.dumps(update["rawInput"])` when it is present on `tool_call`.
- When it only arrives on `tool_call_update`, carry it on `ToolFinished`: add `input` to ToolFinished too, so that `with_event` fills a missing input.
- `output` is the text of `content` (`[{type: "content", content: {type: "text", text}}]`) at about `:391-411`.

**Transcript** (`transcript_store.py`)
- `ToolPart` gets `input` and `output`, both `str | None = None`, so old transcripts still load.
- `with_event` copies `input` from ToolStarted. From ToolFinished it copies `output`, plus `input` when the part has none yet.

## Frontend
- In `api.ts` (around `:2196`), add the tool part's `input?: string | null` and `output?: string | null`, and the event types. Update the reducer in `agentStream.ts` (`:93-104`).
- `ToolRow.tsx` becomes a collapsible card, ported from `<main>/docs/referensi/open-pencil-master/src/theme/chat/tool.ts` and `components/chat/tool/ToolCallCard.vue`:
  - root: `rounded-lg border border-border bg-fill`, keeping `data-tool-row`;
  - trigger: `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-fill`;
  - status dot: `size-4 rounded-full`, with LoaderCircle spinning while running, Check on a `bg-success/20` background when done, and TriangleAlert on `bg-danger/15` on error;
  - name: `text-xs font-medium`; summary: `flex-1 truncate font-mono text-[11px] text-muted`;
  - chevron.
- Body, `border-t border-border px-2 py-2`:
  - a two-button segmented switch, Input/Output, defaulting to Output when one exists;
  - a `<pre>` showing pretty-printed JSON (`JSON.parse` falls back to raw text), `max-h-60 overflow-auto text-[11px] font-mono`;
  - the error in `text-danger` when present.
  - A card with neither input nor output can't be expanded.
- New file `ToolGroup.tsx`. In `TurnView`, consecutive tool parts are grouped.
  - A run of 3 or fewer renders as cards.
  - A longer run renders as a dashed collapsible row ("N steps", the names joined by ` · `, `rounded-lg border border-dashed border-border`) above the latest card. Expanding it shows the earlier cards.
  - Port this from `ToolCallGroup.vue`.

## Acceptance
- [ ] `test_agent_api_loop.py`: the events carry `input` (the arguments JSON) and `output` (the result text); a long output is cut to 4096 characters.
- [ ] `test_agent_acp.py`: rawInput and content are carried, including rawInput that only arrives on the update. Use `fake_acp_agent.py`.
- [ ] A transcript JSON without the new fields still loads.
- [ ] `agentStream.test.ts`: the reducer keeps `input` and `output`.
- [ ] Only the agent backend test files and the frontend agent tests are run, and they pass, along with typecheck.
