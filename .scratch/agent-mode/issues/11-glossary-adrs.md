# 11: Glossary terms and ADRs 0027–0029

**Parent spec:** `spec.md` (Implementation Decisions).

**What to build:** the domain docs name the new concepts and record the decisions.

- **`GLOSSARY.md`.** Add an "Agent Mode" section with:
  - **Agent**
  - **Agent Provider**: ACP agent or API provider
  - **Agent Session**: per Candidate and editor tab
  - **Agent Turn**
  - **Agent Presence**
  - **Scoped MCP server**
- **ADR 0027.** The Agent runs in the backend. ACP agents are subprocesses over stdio, and every Agent reaches the Candidate only through the scoped MCP server at `/mcp/agent`. Permissions for anything else are refused.
- **ADR 0028.** Agent saves are tagged `agent:<turn>` in Revision History. A turn is undone through Revision restore. In the tab that started it, each agent Revision is adopted as an undo step; other tabs see it as an outside Revision.
- **ADR 0029.** Agent Presence is computed from the diff of consecutive Revisions, not from tool arguments. It is kept in a store outside React state, and is shown by CSS on wrapper elements.
- **Format.** Follow the format of the existing ADRs in `docs/adr/`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Three ADR files and the glossary section exist and use the glossary's existing terms exactly.
