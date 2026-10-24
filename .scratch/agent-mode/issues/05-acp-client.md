# 05: ACP agents: Claude Code and Codex

**Parent spec:** `spec.md` (Solution "Agent Providers", "What the Agent may touch"; Implementation Decisions "ACP client").

**What to build:** the owner chooses Claude Code or Codex in the Agent tab, signs in, and sends a message. The agent edits the Candidate through the scoped MCP server only.

- **`acp_client.py`.** Our own client for the Agent Client Protocol (protocol version 1). Read the spec at agentclientprotocol.com, not open-pencil's code.
  - **Process.** `asyncio.create_subprocess_exec` with stdin/stdout pipes. stderr goes to the log. It runs in `DATA_DIR/agent/sandbox/<session>` (created empty), with the environment passed through, so the CLIs find their own logins.
  - **Transport.** JSON-RPC 2.0 over newline-delimited JSON. One reader task routes responses to pending futures by id, notifications to a handler, and requests from the agent to a handler that must answer.
  - **Calls.**
    - `initialize` with `clientCapabilities` claiming no `fs` and no `terminal`.
    - `session/new` with `cwd` and `mcpServers: [{type: "http", name: "ai-clipper", url: <base>/mcp/agent, headers: [{name: "Authorization", value: "Bearer <token>"}]}]`. Use the stdio→http bridge only if an agent lacks HTTP MCP support.
    - `session/prompt`, with the system prompt in front of the first one.
    - `session/cancel` (a notification).
    - `authenticate`.
  - **Updates.** `session/update` notifications map to `AgentEvent`:
    - `agent_message_chunk` → `text`
    - `agent_thought_chunk` → `thought`
    - `tool_call` → `tool_started`
    - `tool_call_update` with status completed or failed → `tool_finished`
  - **Permissions.** `session/request_permission` picks an allow option only when the tool belongs to the `ai-clipper` server (its title or `_meta` names `mcp__ai-clipper__…`). Otherwise it picks reject. If there is no reject option, it answers `cancelled`.
  - **Claude Code.** Pass the adapter's documented `_meta` to pre-allow the scoped server's tools, if it has one.
  - **Exit.** When the process exits during a turn, the turn ends with `error`, and the next send starts a fresh process.
- **Driver.** `sessions.py` runs ACP providers through this client: one process per Agent Session, kept alive between turns and killed when the session closes or the backend shuts down.
- **Login.**
  - `POST /api/agent/providers/{id}/login`:
    - For `login: "acp"`, start a short-lived client, `initialize`, and call `authenticate` with the agent's first auth method. This opens the browser on this Mac.
    - For `login: "terminal"`, return the command to run.
  - `GET /api/agent/providers` now reports `logged_in` when cheap (an `initialize` result or a known credentials file), otherwise `unknown`.
  - The Login button in `ProviderSetup` calls this route and shows the returned command or a "finish signing in in the browser" note.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] A fake ACP agent (a small Python script under `backend/tests/` speaking NDJSON) receives `initialize`, `session/new` with the `/mcp/agent` server and bearer header, and `session/prompt` with the system prompt in front.
- [ ] The fake agent's message chunks, thought chunks and tool calls arrive as `text`, `thought`, `tool_started` and `tool_finished` events.
- [ ] Permission requests for `mcp__ai-clipper__edit_candidate` are allowed; for a shell tool they are rejected.
- [ ] Cancel sends `session/cancel` and the turn ends `cancelled`; a crash mid-turn ends it with `error`, and the next send works.
- [ ] Tests in `backend/tests/test_agent_acp.py`; only it is run.
