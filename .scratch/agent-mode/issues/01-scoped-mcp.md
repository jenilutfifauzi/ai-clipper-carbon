# 01: Scoped MCP server for one Candidate

**Parent spec:** `spec.md` (Solution "What the Agent may touch"; Implementation Decisions "Scoped MCP").

**What to build:** a second MCP server at `/mcp/agent` that exposes only the tools an Agent may use, bound to one Job, one Candidate and the current Agent Turn by a bearer token. Every save it makes is tagged with the turn.

- **`backend/app/agent/scope.py`.**
  - `AgentScope` (Pydantic): `job_id`, `candidate_id`, `session_id`, `turn_id: str | None`.
  - An in-memory `ScopeRegistry` on `app.state.agent_scopes`: `issue(scope) -> token` (`secrets.token_urlsafe`), `resolve(token) -> AgentScope | None`, `set_turn(token, turn_id)`, `revoke(token)`.
  - `ALLOWED_TOOLS` lists the tools by name: `get_candidate`, `edit_candidate`, `merge_candidate_items`, `remove_candidate_items`, `list_revisions`/`restore_revision` (use the real names), `get_transcript`, Media Library reads and `get_media_words`, preset/look/template list, `apply_template`, `generate_speech`, `get_channel_profile`, `save_frame`, and whatever the MCP server names its dry run and asset-list tools. Check `backend/app/mcp_server.py` for the exact names. Exclude everything that creates, deletes or retries Jobs, renders, exports, deletes assets or presets, or sets the Channel Profile.
- **`build_mcp(app, scoped=False)`.**
  - When scoped, register only `ALLOWED_TOOLS` and the glossary resource.
  - Refuse any call whose `job_id`/`candidate_id` argument differs from the token's scope.
  - The scope is read from the request's `Authorization: Bearer` header. Find how the `mcp` v2 SDK exposes the request (Context / request headers). A missing or unknown token refuses every call.
  - Saves send `X-Edit-Source: agent` and `X-Edit-Tab: agent:<turn_id>` (or `agent:<session_id>` outside a turn) instead of the plain `EDIT_SOURCE`.
  - Don't copy tool bodies; thread the headers through the existing in-process call helper.
- **Mount.** `/mcp/agent` is added in `main.py` next to `/mcp` with its own session manager run in the lifespan, and is localhost-only like `/mcp`. Keep `/mcp` exactly as it is.
- **Instructions.** The scoped server's instructions say that it works on one Candidate (its ids are given in the first message).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The scoped server lists only `ALLOWED_TOOLS`; `create_job_from_url`, `render_clips` and `delete_job` aren't listed.
- [ ] A call without a token, or with a revoked one, is refused.
- [ ] `edit_candidate` on the scoped Candidate saves; on another Candidate of the same Job, or another Job, it is refused and nothing is saved.
- [ ] A save through the scoped server is recorded in Revision History with source `agent` and tab `agent:<turn_id>`.
- [ ] `/mcp` still lists every tool (existing `test_mcp.py` unchanged and passing).
- [ ] Tests live in `backend/tests/test_agent_scope.py`; only it and `test_mcp.py` are run.
