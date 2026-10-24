# 0027: The Agent runs in the backend behind a scoped MCP server

Status: accepted
Date: 2026-10-24

## Context

The `agent-mode` feature (`.scratch/agent-mode/spec.md`) puts an Agent tab in the Inspector of the Advanced Edit, where the owner chats with an Agent that edits the open Candidate.

Today:
- **An outside agent can already edit a Candidate** through the `ai-clipper` MCP server, and the editor picks up each save as an outside Revision (ADR 0003). But it reaches every tool: it can delete Jobs, render, and edit other Candidates.
- **Coding agents run shell commands and write files.** Claude Code, Codex and Gemini CLI ask their client's permission for these.
- **The app is a browser plus FastAPI.** A browser can't start a subprocess, and can't keep a key out of the page.
- **The app's LLM layer (`llm.py`) only scores Windows.** It has no tool calling.
- **Owners come in different ways:** a Claude, ChatGPT or Google subscription (usable only through the vendor's own agent), or an API key (DeepSeek, an OpenAI-compatible service, Anthropic, Gemini).

open-pencil (`docs/referensi/open-pencil-master`) speaks to coding agents over the Agent Client Protocol (ACP) and to API models through its own tool loop, all sharing one tool set. We take the shape, not the code.

## Decision

- **The Agent runs in the backend**, in its own package `backend/app/agent/`, its router included from `main.py`. The browser only sends the owner's messages and folds a stream of events (one SSE stream per Candidate).
- **Two kinds of Agent Provider:**
  - **ACP agents** (Claude Code, Codex, Gemini CLI, Antigravity) are subprocesses the backend starts, speaking NDJSON JSON-RPC over stdio through our own client. They sign in with their own login (`authenticate`, or their CLI). Antigravity runs only as its official binary, and its setup warns that Google's terms may not allow a personal login through other apps.
  - **API providers** (DeepSeek, OpenAI-compatible, Anthropic, Gemini) are called by a tool loop in the backend: up to 30 tool steps per Agent Turn, streaming text. Their keys are kept in `DATA_DIR/agent/credentials.json` (mode 600), falling back to the existing `.env` names. A key is never sent back to the browser, only whether one is set.
- **Every Agent reaches the Candidate only through the scoped MCP server at `/mcp/agent`.**
  - `build_mcp(app)` gains a scope option. The scoped instance registers only the allowed tools: the same functions as the full server's, not copies.
  - The allowed tools read, edit and dry-run the open Candidate and its Revisions; read the Job's Transcript, the Media Library and its Media Words, Style Presets, Looks and the Channel Profile; apply Templates; and make a Narration (`generate_speech`). None creates or deletes a Job, touches another Candidate, or renders.
  - Each call carries a bearer token, kept in memory for the Agent Session's life, naming one Job, one Candidate and the current Agent Turn. A call naming any other Job or Candidate is refused.
  - ACP agents are given the scoped server in `session/new`; the API loop lists its tools through an in-process MCP client and converts them to each API's schema.
- **Permissions for anything else are refused.** The backend answers an ACP agent's `session/request_permission` itself: allowed for the scoped server's tools, refused for everything else (shell, files, web). No dialog is shown to the owner. The client claims no fs or terminal capability, and the agent runs in an empty working directory under `DATA_DIR/agent/sandbox/<session>`.
- **The system prompt is the MCP server's own `INSTRUCTIONS`**, plus the open Job and Candidate ids and a short summary of the Candidate.

## Considered options

- **The Agent in the browser.** Calling APIs from the page would put keys in it, and a browser can't start an ACP agent at all.
- **Pointing every Agent at the full MCP server.** No new mount is needed, but the Agent could delete Jobs, render and edit other Candidates from a chat about one.
- **A copied set of tool functions for the scoped server.** It is plainer to read, but two copies drift apart; a scope check in front of the same functions doesn't.
- **Asking the owner to approve each permission.** That is how coding agents usually work, but every request outside the scoped tools is one the Agent should never need. A dialog would only teach the owner to click Allow.
- **API providers only, through `llm.py`.** It has no tool calling, and subscriptions are reachable only through the vendors' own agents.
- **open-pencil's code.** We take its ideas only; the names and structure here are our own.

## Consequences

- **The full MCP server is unchanged** for an outside agent, which still reaches every tool.
- **A new MCP tool reaches an Agent only once it is added to the allowed list.** Each new tool needs a decision about the scope.
- **The owner is never asked to approve a shell command,** because an Agent can't run one.
- **An ACP agent must be installed on this Mac** and signed in through its own login; the app doesn't bundle one.
- **Keys stay on this Mac.** What the Agent reads (the Transcript, the Candidate) goes to the provider's model.
