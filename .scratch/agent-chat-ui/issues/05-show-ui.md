# 05: Generative UI: the `show_ui` tool

**Parent spec:** `spec.md` (Solution 5).

**Status:** ready-for-agent

**Blocked by:** 03, 04

## Backend
- Specs: a new `backend/app/agent/ui_spec.py`, a Pydantic union discriminated by `kind`:
  - `choices`: `{title?: str, options: [{label: str, prompt: str, detail?: str}]}`, with 2–6 options; `label` is at most 80 characters.
  - `candidate`: `{note?: str, frame?: str}`. `frame` is a path that `save_frame` returned. It carries no Candidate data, because the frontend draws the live Candidate.
  - `table`: `{title?, columns: [str] (1–8), rows: [[str|int|float]] (≤50)}`. Every row is as long as `columns`.
  - `key_values`: `{title?, items: [{label, value: str|int|float}] (1–20)}`.
  - `callout`: `{tone: "info"|"success"|"warning"|"danger", title?, body: str, checklist?: [{text, done: bool}]}`.
- The tool: `show_ui(spec)` in `backend/app/mcp_server.py`.
  - Registered on the **scoped** server only, and added to `ALLOWED_TOOLS` in `scope.py`.
  - It validates the spec and returns its normalized JSON (`model_dump_json(exclude_none=True)`).
  - On a validation error it raises a tool error naming the field, so the agent can repair its call.
  - The docstring says when to use it: offering alternatives the user picks from (`choices`), showing the Candidate after a change (`candidate`), structured data (`table`, `key_values`), warnings or steps (`callout`). Use it sparingly, at most once or twice a turn, and never for what a sentence says just as well.
- Delivery: `ToolFinished.output` of `show_ui` is not cut (see ticket 03).
  - `ToolPart` gets `ui: dict | None = None`.
  - In `with_event`, when a `show_ui` tool finishes ok, parse `output` through the union into `ui`. The tool name may carry a `mcp__…__` prefix, so match on the suffix. A parse failure leaves `ui` None.
  - Add `ui` to `ToolFinished` as well, filled in `sessions._run` or in `with_event`, so live clients get it without parsing. Pick one place and keep it single-sourced.
- Prompt: add 3–4 lines to `prompt.py`'s system prompt pointing at `show_ui`, and update the scoped server's INSTRUCTIONS.

## Frontend (`agent/ui/`)
- `GenerativeUi.tsx` switches on `ui.kind`. An unknown kind renders nothing.
- `ChoicesCard`:
  - the title, then options as full-width buttons (`rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-fill`, with the label, plus `detail` in `text-xs text-muted`);
  - clicking an option sends `option.prompt` as a new turn, the same path as the composer;
  - every option is disabled while a turn runs, or once a later turn exists in the Thread;
  - when the next turn's prompt equals an option's prompt, that option is marked chosen (Check icon, `border-accent-text`).
- `CandidateCard`:
  - extract `Thumbnail`, and a presentational `CandidateSummary`, from `frontend/src/pages/job/CandidateList.tsx`, export them, and keep `CandidateList` rendering exactly as before;
  - it shows the live Candidate the Advanced Edit already holds (find how AgentTab can reach it, e.g. a prop from `Inspector`): name, `formatClock` range, `ScoreRing`, hook text;
  - `note` is shown under it;
  - `frame`, when given, is shown as the image instead of the thumbnail, through whichever route serves `save_frame` output; check `save_frame`'s result.
- `DataTable`: `overflow-x-auto`, `text-xs tabular-nums`, header row in `text-muted`.
- `KeyValues`: a `grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs`.
- `Callout`: tone colours from tokens (`text-accent-text` for info, `text-success`, `text-waiting`/accent for warning, `text-danger`), an icon, title, body (through ChatMarkdown), and a read-only checklist (CircleCheck / Circle).
- In `TurnView` (and `ToolGroup`), a tool part with `ui` renders `<GenerativeUi>` in place of its tool card, and is never folded into "N steps".

## Docs
- `docs/adr/0031-generative-ui-is-a-scoped-mcp-tool.md`: why a tool and not a text format (validated by a schema, the same for every provider), and why `candidate` carries no data.
- `GLOSSARY.md`, "Agent Mode": **Agent UI**, a component the Agent shows in the chat through `show_ui`.

## Acceptance
- [ ] New file `tests/test_agent_show_ui.py` covers:
  - each kind validates and is normalized;
  - a bad spec is a tool error;
  - `with_event` fills `ui`, including with a prefixed tool name;
  - `show_ui` is in the scoped tool list and not on `/mcp`.
- [ ] `test_agent_scope.py` passes, updated for the new tool.
- [ ] Frontend: `agentStream.test.ts` keeps `ui`. `agentTab.test.tsx` tests that clicking a choice sends its prompt, that the options are disabled afterwards, and that an unknown kind renders nothing.
- [ ] typecheck passes. Only the agent test files are run.
