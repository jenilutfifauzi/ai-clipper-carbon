# 01: The MCP endpoint and Job tools

**Parent spec:** `spec.md` in this feature folder (user stories 1, 3, 16).

**What to build:**
- **Dependencies:** `mcp` (v2); `httpx` moves to the app's dependencies.
- **Server:** `app/mcp_server.py` builds the `MCPServer` for an app. A helper calls the app's REST routes in-process and turns a failed call into a tool error with the API's message. Compact views of a Job, a Candidate and a Clip.
- **Wiring:** `create_app` adds the `/mcp` route ahead of the frontend's catch-all, which leaves `mcp` alone; its lifespan runs the session manager.
- **Tools:** `create_job_from_url`, `list_jobs`, `get_job` (no Transcript), `retry_job`, `delete_job`.
- **Claude Code:** `.mcp.json` at the repo root.

**Blocked by:** none.

**Status:** done

- [x] `POST /mcp` (no slash) answers `initialize` with the built frontend present; `/jobs/<id>` still serves the frontend.
- [x] A foreign Host is refused.
- [x] A Job created through MCP reaches review; `get_job` has its Candidates and no Transcript.
- [x] A REST error (404, 409) comes back as a tool error with its detail.
- [x] `make test` passes.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`: `initialize` posted to `/mcp` (no slash) over HTTP with a built frontend present answers 200; `Host: evil.example` gets 421; `/jobs/abc` still serves index.html; `/mcp/other` is 404. A Job made through MCP reaches review and `get_job` has no Transcript, history or profile. 404 and 409 come back as tool errors with the API's detail.
- Over real HTTP: uvicorn on another port with a scratch `DATA_DIR`, and `mcp.Client("http://127.0.0.1:8765/mcp")`: 23 tools listed, `list_presets`, `get_job` of an unknown Job as a tool error, the glossary resource.
- `make test`: 399 passed.

**Changes from the plan:**
- The SDK's `/mcp` route is added to the app's router as it is, rather than wrapped in another Route.
- Tools return an object (`{"jobs": [...]}`, `{"clips": [...]}`, `{"presets": [...]}`), since the SDK sends a returned list as a content block per item, and an empty one as no content at all.
- Tool results are unstructured (`structured_output=False`), so their JSON is sent once.
- httpx's per-request INFO log is turned down to warnings: it logged every tool's call to the API.
