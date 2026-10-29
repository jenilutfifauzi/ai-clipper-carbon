# Agent chat UI: open-pencil look, Markdown, tool cards, Threads, generative UI

## Problem
The Agent tab (`frontend/src/pages/job/advanced/agent/AgentTab.tsx`) works but is plain:
- its header is a row of Provider/Model selects;
- the Agent's answers are pre-wrap text with no Markdown;
- each tool call is a flat row with no input or output;
- each Candidate has one chat that can't be started over;
- the Agent can only answer in text.

## Solution
Make the tab look and behave like open-pencil's chat panel. The reference is Vue, in `docs/referensi/open-pencil-master/src/components/chat/*` and `src/theme/chat/*`. `docs/referensi` is gitignored, so worktrees read it from the main checkout: `/Users/indobuzz/Developer/ai-clipper/docs/referensi/open-pencil-master`. The colours are ai-clipper's own tokens (`frontend/src/styles/tokens.css`), not open-pencil's blue.

1. **Restyle** with open-pencil's layout:
   - a compact header: Thread title dropdown, Follow, `+`, `⋯`;
   - a bubble on the right for the user, in the accent gradient, and a bubble on the left for the Agent, in `bg-fill`;
   - a framed composer with a toolbar holding a model pill, a settings gear and Send/Stop;
   - a typing indicator, and a collapsible reasoning block.
2. **Markdown** in the Agent's text, rendered with react-markdown and remark-gfm.
3. **Tool cards** that open to show the call's input and output (JSON). Long runs of calls fold into "N steps".
4. **Agent Threads**: several chats per Candidate. `+` starts one, and the title dropdown lists and switches between them.
5. **Generative UI** (the idea comes from openui.com): the Agent calls a scoped MCP tool, `show_ui(spec)`, and the chat renders the spec as a component. The five kinds are `choices`, `candidate`, `table`, `key_values` and `callout`. A tool is used rather than a text format because it is validated by a schema and works the same for every Agent Provider, ACP and API alike.

## Decisions
- Tokens: `raised`, `bg-fill`, `accent`/`accent-end`, `text-muted`, `border-border`. No new palette.
- No pointer button in the composer: the Agent has no selection input yet. Images and other Agent Attachments, from a + in the composer, are .scratch/agent-attachments/spec.md.
- The data hooks and aria labels that the tests rely on are kept: `data-composer`, `data-example`, `data-tool-row`, `data-turn-actions`, "Send", "Stop", "Message the Agent".
- Revert and Restore stay per Revision (ADR 0028), whichever Thread the turn is in.
- Switching Threads on an ACP session closes its ACP process, so the agent starts with no history.
- Run only the feature's tests:
  - backend `tests/test_agent_*.py`, with `<main>/backend/.venv/bin/python -m pytest` from the worktree's `backend/`;
  - frontend `npm run typecheck` and `npx vitest run src/pages/job/advanced/agent`.
  - Never the full suite.

## Tickets
`issues/01` restyle → `02` Markdown → `03` tool cards → `04` Threads → `05` show_ui.
