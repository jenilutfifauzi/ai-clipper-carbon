# 09: Narrations through MCP

**Parent spec:** `spec.md` in this feature folder (User Stories 49–52; Implementation Decisions "MCP"); ADR 0019.

**What to build:** the agent narrates a Candidate.

- `list_assets(kind="voices")` returns the ready engines and their Voices, with each engine's service, cloud or local, and whether it takes a Style (what `GET /api/voices` says, without download progress).
- `generate_speech(text, engine, voice, speed=1, pauses=0.3, style=None)` runs a Narration through the same runner, waits for it, and returns the Media item's id, name and duration, or the runner's error (busy, too long, engine not ready, engine error) in the owner's words.
- Laying it is the agent's job through `merge_candidate_items` with a Music Clip `{media, start, speech: true}`. No new edit field.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] MCP (prior art `test_mcp.py`): `list_assets(kind="voices")` lists the fake engine and its Voices.
- [ ] MCP: `generate_speech` returns the item's id, name and duration, and the item is in the Media Library.
- [ ] MCP: busy, too long and not-ready errors come back with the runner's messages.
- [ ] MCP: `merge_candidate_items` lays it with `speech: true`, and `dry_run` lists a ducked song's speech spans from it.
