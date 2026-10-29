# 04: Agent Threads (several chats per Candidate)

**Parent spec:** `spec.md` (Solution 4).

**Status:** done

**Blocked by:** 01, 03

## Backend (`backend/app/agent/`)

**Store** (`transcript_store.py`)
- An Agent Thread is `{id, title, created_at, updated_at}`.
- Layout: `jobs/<job>/agent/<candidate>/index.json`, which lists the Threads, and `jobs/<job>/agent/<candidate>/<thread>.json`, which holds that Thread's turns.
- Functions:
  - `list_threads`, newest `updated_at` first;
  - `create_thread(title="New chat")`;
  - `rename_thread`;
  - `delete_thread`;
  - `load_transcript(job_dir, candidate, thread)`;
  - `append_turn(…, thread, turn)`, which bumps `updated_at` and, while the title is still "New chat", sets the title to the first prompt cut to 60 characters.
- Write everything with `write_atomic`.
- **Migration** on first access: when the old `agent/<candidate>.json` exists and the directory doesn't, it becomes the first Thread, titled from its first prompt. The old file is moved, not copied.
- `newest_thread(…)`: the first Thread in the list, created when there is none.

**Routes** (`routes.py`, under `/api/jobs/{job}/candidates/{cand}/agent`)
- `GET /threads`
- `POST /threads` → the new Thread
- `PATCH /threads/{id}` `{title}`
- `DELETE /threads/{id}`: refused with 409 while a turn runs in that Thread. When the last Thread is deleted, a fresh one is created on the next access.
- `POST /turns` takes an optional `thread`; `GET /transcript` takes an optional `?thread=`. Leaving it out means the newest Thread.

**Sessions** (`sessions.py`)
- `send(…, thread)` stores `session.thread`.
- `_context` builds the history from that Thread.
- `_run` appends to it.
- When `thread` differs from the session's previous one and the session has an ACP agent, `await session.acp.close()` and set it to None, so the agent starts without the other Thread's history.

**Events**
- `TurnStarted` carries `thread`, and the frontend reducer keeps it.

## Frontend
- `api.ts`: thread endpoints, plus `thread` on send and transcript.
- `useAgentStream(job, cand, threadId)` loads that Thread's transcript and shows only turns whose `thread` matches. A running turn of another Thread does not appear, but it still counts as running for the tab's Stop button, as it does today.
- `ChatHeader`:
  - The title shows the active Thread's title.
  - Clicking it opens a popover (`w-80 p-2`) with a search input (`rounded border border-border bg-fill px-2 py-1.5 text-xs`) and the Threads, newest first, each showing its title and relative time. The active one is marked.
  - A `+` icon button (Plus, `aria-label="New chat"`) creates a Thread and switches to it.
  - `⋯` holds Rename (an inline edit or a prompt), Copy transcript, and Delete chat (`window.confirm`).
- The active Thread is kept per Candidate in `localStorage` under `agent-thread:<job>:<cand>`, inside try/catch. It falls back to the newest Thread.

## Docs
- `GLOSSARY.md`, "Agent Mode": **Agent Thread**, one chat of a Candidate with the Agent. The Candidate has several; each keeps its own turns, and only its own turns are the history its turns see.
- `docs/adr/0030-agent-threads-per-candidate.md`: why Threads, the layout, the migration, and why an ACP agent is closed on a switch.

## Acceptance
- [x] New file `tests/test_agent_threads.py` covers:
  - create, list, rename and delete;
  - migration of an old `<candidate>.json`;
  - `append_turn` titling the Thread;
  - the routes;
  - the history `_context` builds holding only that Thread's turns.
- [x] `test_agent_sessions.py` and `test_agent_turn_undo.py` still pass. Update their fixtures to pass a thread where the API requires one.
- [x] Frontend agent tests: switching Threads reloads the transcript.
- [x] typecheck passes. Only the agent test files are run.
