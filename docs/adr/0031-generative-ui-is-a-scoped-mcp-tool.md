# 0031: Generative UI is a scoped MCP tool

Status: accepted
Date: 2026-10-29

Builds on 0027 (the Agent behind a scoped MCP server) and 0030 (Agent Threads).

## Context

The Agent could only answer in text, now Markdown. Some answers want more than text:
- **alternatives** for the owner to pick from ("a shorter hook, or a punchier one?"), where the owner retypes one to choose it;
- **the Candidate after a change**, which the owner would otherwise go and look for;
- **structured data**, such as Segments and their lengths, which Markdown tables carry badly in a narrow chat;
- **a warning, or steps** that should stand apart from the prose.

The idea comes from openui.com: the model asks for a component, and the chat draws it.

## Decision

- **The Agent asks through a tool, `show_ui(spec)`, on the scoped MCP server only.** It is in `ALLOWED_TOOLS`, and the full MCP server at `/mcp` hasn't got it: an outside agent has no chat to draw it in.
- **A spec is one of five kinds**, a Pydantic union discriminated by `kind` (`app/agent/ui_spec.py`):
  - `choices`: 2 to 6 options, each a label of at most 80 characters, the prompt a click sends, and a detail;
  - `candidate`: a note, and a frame that `save_frame` saved;
  - `table`: up to 8 columns and 50 rows, each row as long as the columns;
  - `key_values`: 1 to 20 labelled values;
  - `callout`: a tone (info, success, warning, danger), a title, a Markdown body and a read-only checklist.
- **The tool validates the spec and returns it normalized**, as JSON without the fields left out. A spec it refuses is a tool error naming the field, so the Agent can repair its call. A field the chat doesn't draw is refused rather than dropped.
- **The chat draws the call's output in place of its tool card.** `show_ui`'s output is never cut. When the call finishes, `with_event` parses it into the tool part's `ui`, and the published `tool_finished` carries the same `ui`, so a live chat needn't parse it. A run of tool calls never folds an Agent UI into "N steps", and an unknown kind draws nothing.
- **A choice is sent as the composer sends**, to the open Thread. The options are locked while a turn runs and once the Thread has a later turn; the option whose prompt that turn sent is marked chosen.
- **`candidate` carries no Candidate data.** The chat draws the Candidate the Advanced Edit holds, as a row of the Candidate list, with the Agent's note and, when given, the saved frame in place of the still (served from the Job's directory).

## Considered options

- **A text format in the Agent's answer** (a fenced `ui` block, say). Nothing validates it until the chat tries to draw it, a model's slip shows as a broken block, and each Agent Provider would need its own prompt to write it the same way. A tool has a schema that every provider, ACP and API alike, already reads and is held to.
- **A `candidate` spec with the Candidate's fields.** The Agent would copy what it read, which is stale as soon as the owner or another turn changes the Candidate, and a long Candidate would fill the transcript. The chat already holds the live Candidate.
- **More kinds** (charts, forms, a timeline). Five cover what the Agent has needed; a new kind is a new union member and a new component, and an older chat draws nothing for it.

## Consequences

- **The Agent's components are as reliable as its tool calls.** A bad spec fails the call, not the chat.
- **A kept transcript draws the same component again**, since the part keeps its `ui`; a `candidate` shows the Candidate as it is now, not as it was then.
- **The prompt asks for restraint**: once or twice a turn at most, never for what a sentence says as well.
