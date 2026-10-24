# 06: ACP agents: Gemini CLI and Antigravity

**Parent spec:** `spec.md` (Solution "Agent Providers").

**What to build:** Gemini CLI and Antigravity appear as ACP providers and work through the client from 05.

- **Gemini CLI.**
  - Launched as `gemini --experimental-acp`, or `gemini --acp` when `gemini --help` lists it; detection picks the flag.
  - Login is `terminal` (`gemini` signs in on first run), or ACP `authenticate` when the agent offers it.
- **Antigravity.**
  - The official `agy_acp_server` binary, found on PATH or through the Antigravity install location. Check the ACP registry entry for its name and paths on macOS.
  - It needs an auth method chosen in its own settings before a session starts. When `session/new` is refused for this reason, setup says so and points to its docs.
  - The provider's `warning`: "Google's terms may not allow a personal Antigravity login to be used from other apps. Use it at your own risk, or use Gemini CLI or a Gemini API key."
  - The model list it offers to clients is its own business; we don't spoof the client name.
- **Quirks.** Agent differences (MCP over http vs stdio, `_meta`) live in the provider entry, not in `if` chains in the client.

**Blocked by:** 05

**Status:** done

- [x] Detection picks `--acp` or `--experimental-acp` from a faked `--help` output.
- [x] The Antigravity entry carries the warning, and `ProviderSetup` shows it (renderToStaticMarkup).
- [x] A refused `session/new` ends the turn with a readable `error`.
- [x] Tests extend `test_agent_providers.py` / `test_agent_acp.py`; only those are run.

**Notes (2026-10):**
- Gemini CLI defines `--acp` and keeps `--experimental-acp` as a deprecated alias (`packages/cli/src/config/config.ts`); the ACP registry launches it with `--acp`. Its `initialize` answers `mcpCapabilities: {http: true, sse: true}` (`packages/cli/src/acp/acpRpcDispatcher.ts`), so no stdio bridge is needed. Its auth methods: "Log in with Google" (picked by `login_method`), API key, Vertex AI, gateway.
- Antigravity's registry entry is `antigravity-acp`: a zip per platform whose command is `./agy_acp_server.par` (macOS arm64/x86_64), no npx. The entry says nothing about auth or MCP transports. An agent that doesn't advertise `mcpCapabilities.http` now fails its turn with a readable error rather than getting an HTTP server it can't use; a stdio bridge would be the follow-up if Antigravity turns out to be stdio-only.
