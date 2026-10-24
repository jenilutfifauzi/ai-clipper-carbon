# 03: Agent Sessions, Agent Turns and the API tool loop (DeepSeek first)

**Parent spec:** `spec.md` (Solution "Agent Turns"; Implementation Decisions "API tool loop", "Events", "System prompt").

**What to build:** the owner can send a message to an API provider for the open Candidate, over HTTP, and get a streamed turn whose tool calls edit the Candidate through the scoped MCP server. This issue covers the OpenAI Chat Completions adapter (DeepSeek, OpenAI-compatible); Anthropic and Gemini come in 07.

- **`sessions.py`.** `AgentSessionManager` on `app.state.agent_sessions`, created in the lifespan; it closes every session on shutdown.
  - A session is keyed by `(job_id, candidate_id, tab)`. It holds its provider, model, scope token and a turn lock, and runs at most one turn at a time (a second send while busy gets a 409).
  - `send(...)` starts a turn as a task:
    - set the scope's turn
    - run the provider's driver
    - publish `AgentEvent`s
    - record the first and last Revision saved with tab `agent:<turn>` (read from Revision History after each tool call)
  - `cancel(...)` cancels the task, and the turn ends with `stop: "cancelled"`.
- **`AgentEvent`** (Pydantic, discriminated on `type`): `turn_started {turn, provider, model}`, `text {turn, delta}`, `thought {turn, delta}`, `tool_started {turn, call, tool, summary}`, `tool_finished {turn, call, ok, error?, revision?}`, `turn_finished {turn, stop, first_revision?, last_revision?}`, `error {turn?, message}`.
- **Streaming.** Events are fanned out through the pattern in `backend/app/events.py` on the topic `agent:<job>:<candidate>`. `GET /api/jobs/{job}/candidates/{cand}/agent/events` is an SSE stream of them.
- **`api_loop.py`.**
  - Connect an in-process `mcp.Client` to the scoped server with the session's token (see `tests/test_mcp.py` for the in-process pattern; the token must reach the scope check).
  - List the tools and convert them to Chat Completions `tools`.
  - Stream the completion, then run each tool call through the client.
  - Feed the results back, trimming any tool result over 12 kB with a note.
  - Stop on a reply with no tool calls, or after 30 steps (`stop: "step_limit"`).
  - `summary` is a one-line string built from the tool's arguments (`edit_candidate`: the top-level keys it sets; `merge_candidate_items`: kinds and counts). It is our own formatter.
  - DeepSeek's `reasoning_content` becomes `thought` events.
- **System prompt.** `prompt.py` builds it from the scoped MCP server's instructions, plus the Job and Candidate ids, the Candidate's title, length, Canvas Aspect, and counts of Segments, Text Layers, Music Clips, Overlays and Shapes.
- **Chat history.**
  - `transcript_store.py` keeps `jobs/<job>/agent/<candidate>.json`: a list of turns `{id, provider, model, prompt, parts[], first_revision, last_revision, stop, started_at}`, written atomically when each turn finishes.
  - The API loop sends the previous turns' user/assistant text (not tool traffic) as history, capped at the last 10 turns.
- **Routes:**
  - `POST …/agent/turns {provider, model?, prompt, tab}` returns 202 with `{turn}`.
  - `POST …/agent/cancel {tab}`.
  - `GET …/agent/transcript`.
  - A provider without a key gets a 400 with a clear message.

**Blocked by:** 01, 02

**Status:** done

- [x] With a fake OpenAI-compatible server (an `httpx.MockTransport` or a tiny ASGI app) scripted to call `edit_candidate` then answer, a turn streams `turn_started`, `tool_started`, `tool_finished` (with the new revision), `text` and `turn_finished` (with first and last revision), in that order.
- [x] The Candidate is changed by the tool call, and its Revision has tab `agent:<turn>`.
- [x] A scripted tool call on another Candidate gets an error result fed back to the model; nothing is saved.
- [x] Cancel mid-turn ends it with `stop: "cancelled"`.
- [x] A second send while a turn runs is a 409.
- [x] The transcript is saved and returned by `GET …/agent/transcript`.
- [x] Tests in `backend/tests/test_agent_api_loop.py` and `test_agent_sessions.py`; only these are run.
