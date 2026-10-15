# 08: Agent guidance and docs

**Parent spec:** `spec.md` in this feature folder (all user stories).

**What to build:**
- The server's instructions: the workflow, Source time and Timeline time, which lists replace, when edits are allowed, the hook's and Kicker's limits and Emphasis, and the browser's editor saving over the agent.
- `ai-clipper://glossary` serves `GLOSSARY.md`.
- README: Using with Claude Code.
- A test keeping the tool list small enough for an agent's context.

**Blocked by:** 01–07.

**Status:** ready-for-human

- [x] The tool list is under its size budget.
- [ ] In real Claude Code: a YouTube URL, review, a hook and a Text Layer edited, rendered, the MP4 opened from its path; the open browser shows the edits.

## Comments

**2026-10-15: built; the walkthrough is left.**

**Done:**
- The server's instructions: the workflow, Source time and Timeline time, which lists replace, when edits are allowed, the hook, Emphasis and the Kicker's limit, Media Library items, and the browser saving over the agent.
- `ai-clipper://glossary`.
- README: "Using with Claude Code (MCP)".
- `.mcp.json`.
- `tests/test_mcp.py`: the 23 tools' list is about 44 KB, under the 60 KB budget; the glossary resource is read.

**Left for a human:** the walkthrough in real Claude Code (`make dev`, then a session in this repo).
