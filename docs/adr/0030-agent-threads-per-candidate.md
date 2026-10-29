# 0030: Agent Threads per Candidate

Status: accepted
Date: 2026-10-29

Builds on 0027 (the Agent behind a scoped MCP server) and 0028 (Agent Revisions undone by restore).

## Context

Each Candidate had one Agent chat, kept in `jobs/<job>/agent/<candidate>.json`. Every turn's history was that whole chat (its last turns, `HISTORY_TURNS`).

Today:
- **A chat can't be started over.** Once the owner has asked about the captions, a question about the hook still carries the captions talk as history: more tokens, and a model steered by what no longer matters.
- **An ACP agent keeps its own conversation.** Its process lives with the Agent Session between turns and remembers what it was told, whatever the transcript on disk says.

## Decision

- **A Candidate has Agent Threads.** A Thread is `{id, title, created_at, updated_at}`. Each keeps its own finished turns, and only those are the history its turns see.
- **The layout is a folder per Candidate.** `agent/<candidate>/index.json` lists the Threads; `agent/<candidate>/<thread>.json` holds each one's turns, as the single file did. Everything is written with `write_atomic`, the index under a lock, since two tabs' turns may finish at once.
- **Titles come from the first prompt.** A Thread starts as "New chat"; its first finished turn titles it with its prompt, cut to 60 characters. The owner may rename it, and a renamed one keeps its name.
- **The newest is the default.** A request without `thread` (a send, the transcript) goes to the Thread used most recently, made on the spot when there is none. Older clients keep working, and deleting the last Thread needs no special case.
- **The old chat migrates on first access.** When `agent/<candidate>.json` exists and the folder doesn't, it becomes the first Thread, titled from its first prompt. The file is moved into a folder made aside, which then takes the folder's place: nothing is copied, and a reader never sees half a migration.
- **Switching Threads closes the session's ACP agent.** When a tab sends to another Thread than its last, its ACP process is closed and the next turn starts a fresh one, which knows nothing of the other Thread's conversation. API providers need nothing: their history is read from the Thread each turn.
- **Revert and Restore stay per Revision** (ADR 0028). A finished turn is found in whichever Thread holds it.
- **A Thread can't be deleted while a turn runs in it** (409). Deleting a Thread forgets its turns, not the Revisions they saved.
- **The browser remembers the open Thread per Candidate** (`agent-thread:<job>:<cand>` in `localStorage`), falling back to the newest. The event stream stays one per Candidate: `turn_started` names its Thread, and the chat shows only the open Thread's turns, while another Thread's running turn still counts for Stop.

## Considered options

- **"Clear chat" on the one transcript.** Simpler, but the earlier conversation is lost for good, and there is no going back to it.
- **Threads in one file.** One write per turn rewrites every Thread's turns; the folder keeps a turn's write to its own Thread.
- **Replaying a Thread's history into a fresh ACP agent.** ACP has no way to seed a session's history, and pasting it into the first prompt would muddle what the owner asked. A fresh agent per switch is plain and predictable.

## Consequences

- **Each Thread is a clean slate for its model.** Shorter histories, and talk about one change doesn't steer the next.
- **An ACP agent forgets on a switch, both ways.** Coming back to a Thread doesn't bring back what that agent was told in it: only API providers replay a Thread's history.
- **The old single-file chat is read once more, then gone.** After the migration only the folder exists.
