# Agent Mode: an AI Agent edits the Candidate from the Advanced Edit

Status: ready-for-agent
Created: 2026-10-24

## Problem Statement

The Advanced Edit can already be driven by an outside agent through the `ai-clipper` MCP server. The open editor then picks up each save as an outside Revision. To use it, though, the owner has to leave the app and do this by hand:
- configure the MCP server in Claude Code (or another client)
- tell the client which Job and Candidate to work on
- watch edits land without knowing who made them or why

There are other gaps too:
- **No chat in the editor.** The owner can't ask for "cut the first two seconds and add a title" next to the picture.
- **No choice of model in the app.** The app's LLM layer (`llm.py`) only scores Windows; it has no tool calling. An owner with a Claude, ChatGPT or Google subscription can't use it, and neither can an owner with only a DeepSeek key.
- **Agent edits can't be undone as edits.** `useEditHistory.elsewhere()` replays an outside Revision under the undo steps, so Ctrl+Z skips it. The only way back is Revision History.
- **Nothing shows where the agent is working.** Segments and layers change in place with no hint of what was touched.
- **An outside agent can do anything.** It can reach every MCP tool: delete Jobs, render, edit other Candidates. Coding agents (Claude Code, Codex) can also run shell commands and write files.

open-pencil (`docs/referensi/open-pencil-master`, MIT) shows the shape we want: a chat that speaks to coding agents over the Agent Client Protocol (ACP) and to API models through its own tool loop, all sharing one tool set, with an agent cursor and flashes on the canvas. We take the ideas only. The code, names and structure here are our own.

## Solution

An **Agent** tab in the Inspector of the Advanced Edit. The owner picks an **Agent Provider**, types a request, and watches an **Agent Turn** stream in. The agent edits this Candidate with the app's own MCP tools, and the editor animates each change as it lands.

**Agent Providers.**
- **ACP agents.** The backend launches each one as a subprocess speaking JSON-RPC over stdio. Login is handled by the agent's own sign-in (`authenticate`, or its CLI login).
  - Claude Code (`claude-agent-acp`)
  - Codex (`codex-acp`)
  - Gemini CLI (`gemini --experimental-acp`)
  - Antigravity (`agy_acp_server`): run as the official binary, which keeps the Google login. Its setup shows a warning that Google's terms may not allow a personal login through other apps.
- **API providers.** A tool loop in the backend calls the model.
  - DeepSeek
  - OpenAI-compatible (base URL, key and model of the owner's choosing)
  - Anthropic
  - Gemini
- **Keys.** Saved by the setup form in `DATA_DIR/agent/credentials.json` (mode 600). When none is saved there, the key is read from the existing `.env` names (`LLM_API_KEY` for DeepSeek or OpenAI-compatible when `LLM_BASE_URL` points there, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`). A key is never sent back to the browser; only `has_key` is.

**What the Agent may touch.**
- Only the Candidate the editor has open: read it, edit it, dry-run it, and its Revisions.
- It can also read the Job's Transcript, the Media Library (and its Words), Style Presets, Templates (apply), Looks, the Channel Profile (read), and Narration (`generate_speech`).
- It can't create or delete Jobs, touch other Candidates, or render.
- Tools come from a **scoped MCP server** at `/mcp/agent`. It registers only the allowed tools and needs a bearer token that names one Job, one Candidate and the current Agent Turn. A call naming any other Job or Candidate is refused.
- An ACP agent's permission requests are answered by the backend: allowed for the scoped server's tools, refused for everything else (shell, files, web). No dialog is shown.
- An ACP agent runs with an empty working directory under `DATA_DIR/agent/sandbox/<session>`.

**Agent Turns.**
- One message from the owner and everything the agent does until it stops: text, collapsible thoughts, and a row per tool call (status, the tool's name without its `mcp__…__` prefix, a one-line summary).
- One turn runs at a time per Agent Session. Stop cancels it.
- Saves made during a turn carry `X-Edit-Source: agent` and `X-Edit-Tab: agent:<turn id>`, so each Revision says which turn made it.
- A finished turn records its first and last Revision.
  - **Revert** restores the Revision before the turn.
  - **Restore** brings back the turn's last Revision.
  - Both are ordinary Revision restores (ADR 0003).
- The chat of each Candidate is kept in `jobs/<job>/agent/<candidate>.json`.

**Undo.** In the tab whose chat started the turn, each agent Revision becomes an ordinary undo step, so Ctrl+Z takes it back. Other tabs still see it as an outside Revision.

**Agent Presence** (the animation).
- **Timeline cursor.** A small arrow with a pill naming the provider glides (180 ms, ease-out) to the item the agent last changed. It shows "thinking…" between tool calls.
- **Pulse.** While a tool call runs, the items it last touched pulse softly.
- **Flash.** When a Revision lands, the items that changed between it and the one before flash once (about 700 ms). The changed items come from a diff of the two Revisions' edits by item id, never from the tool's arguments.
- **Preview outlines.** Text Layers, Shapes and Overlays that changed are outlined on the stage while they flash.
- **Follow agent** (on by default, remembered in localStorage). The Timeline scrolls to the changed items, and the playhead moves to the first one when it is out of view. Scrolling or zooming by hand turns it off for the rest of the turn.
- **Reduced motion** (`prefers-reduced-motion`). The pulse and flash become a still outline, and the cursor jumps instead of gliding.

## User Stories

1. As the owner, I open the Agent tab, choose DeepSeek, paste a key once, and ask for a title over the first three seconds. A Text Layer appears there and flashes on the Timeline.
2. As the owner with a Claude subscription, I choose Claude Code, sign in once, and ask it to tighten the pauses. Segments ripple and the cursor walks along the Main Track.
3. As the owner, I press Ctrl+Z after a turn and the agent's last change is undone like my own.
4. As the owner, I press Revert on an earlier turn and the Candidate goes back to the Revision before it.
5. As the owner, I press Stop and the turn ends with what it had done so far.
6. As the owner, I'm never asked to approve a shell command, because the agent can't run one.
7. As the owner on another tab, I see the agent's edits arrive as outside Revisions, without undo steps.
8. As the owner with reduced motion set, I see outlines instead of pulses.

## Implementation Decisions

- **Runtime in the backend.** The app is a browser plus FastAPI, so only the backend can start ACP subprocesses and hold keys. ADR 0027.
- **Package `backend/app/agent/`.**
  - Modules: `providers`, `credentials`, `scope`, `acp_client`, `api_loop`, `sessions`, `transcript_store`, `routes`.
  - Style: plain functions and Pydantic v2 models, async I/O, guard clauses, RORO.
  - Its router is included from `main.py`; nothing is added to `api.py`.
- **Scoped MCP.**
  - `build_mcp(app)` gains a scope option. The scoped instance registers the tool functions of `ALLOWED_TOOLS` and is mounted at `/mcp/agent`.
  - The scoped instance checks the bearer token on each call, so tool functions are not copied.
  - The token and scope live in an in-memory registry for the Agent Session's life.
- **ACP client.**
  - Our own NDJSON JSON-RPC client over `asyncio.create_subprocess_exec`.
  - Calls `initialize`, `session/new` (with `mcpServers` naming `/mcp/agent` and the bearer header), `session/prompt` and `session/cancel`.
  - Handles `session/update` notifications and `session/request_permission` requests.
  - Uses `authenticate` for login.
  - Writes no files for the agent, since the client capabilities claim no fs or terminal.
- **API tool loop.**
  - Tools are listed from an in-process `mcp.Client` connected to the scoped server, then converted to each API's tool schema.
  - The loop streams text and runs up to 30 tool steps per turn.
  - Adapters: OpenAI Chat Completions (DeepSeek, OpenAI-compatible), Anthropic Messages, Gemini (`google-genai`).
- **Events.**
  - One SSE stream per Candidate (`GET …/agent/events`) carries:
    - `turn_started`
    - `text`
    - `thought`
    - `tool_started {call, tool, summary}`
    - `tool_finished {call, ok, revision?}`
    - `turn_finished {stop, first_revision, last_revision}`
    - `error`
  - The frontend folds them with a pure reducer.
- **System prompt.** The MCP server's `INSTRUCTIONS`, plus the open Job and Candidate ids and a short summary of the Candidate. ACP agents get it in front of the first prompt; API models get it as the system message.
- **Undo.**
  - `useEditHistory` gains `adopt(value, group)`. It takes an outside value as an undo step without saving it again.
  - `AdvancedEdit` uses `adopt` for Revisions whose tab is `agent:<turn>` of a turn this tab started, and `elsewhere()` for all other Revisions.
  - ADR 0028.
- **Presence.**
  - `touchedItems(before, after)` diffs two `AdvancedEdits` by item id per kind.
  - A small presence store (`useSyncExternalStore`) holds status, cursor target, pulsing and flashing ids, so the animation doesn't re-render the editor page.
  - CSS keyframes run on wrapper elements.
  - ADR 0029.
- **Glossary.** Add Agent, Agent Provider, Agent Session, Agent Turn, Agent Presence.

## Out of Scope

- Image attachments, screenshots sent to the model, and a model-seen preview frame.
- Multiplayer presence across machines.
- Agents editing several Candidates or rendering.
- Custom MCP servers added by the owner.
- Antigravity through any path other than its official binary.
