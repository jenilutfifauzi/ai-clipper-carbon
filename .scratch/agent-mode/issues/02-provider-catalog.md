# 02: Agent Provider catalog, credentials and detection

**Parent spec:** `spec.md` (Solution "Agent Providers"; "Keys").

**What to build:** the backend knows which Agent Providers exist, whether each is ready, and stores API keys. Nothing talks to a model yet.

- **`backend/app/agent/providers.py`.** A static catalog of `AgentProvider` (Pydantic, discriminated on `kind`).
  - **`acp`**: `id` (`claude-code`, `codex`, `gemini-cli`, `antigravity`), `label`, `command: list[str]` with fallbacks, `install_hint`, `login: "acp" | "terminal"`, `login_command`, `docs_url`, `warning: str | None` (Antigravity's ToS note).
    - For Claude Code and Codex, prefer an installed adapter binary (`claude-agent-acp`, `codex-acp`) and fall back to `npx -y <npm package>` when `npx` is on PATH.
  - **`api`**: `id` (`deepseek`, `openai-compatible`, `anthropic`, `gemini`), `label`, `base_url`, `base_url_editable`, `models: list[str]`, `default_model`, `key_env: list[str]` (env fallbacks), `docs_url`.
  - DeepSeek's `base_url` is `https://api.deepseek.com` and its models are `deepseek-chat` and `deepseek-reasoner`.
- **`backend/app/agent/credentials.py`.**
  - `DATA_DIR/agent/credentials.json` stores `{provider_id: {api_key, base_url?, model?}}`.
  - Written atomically through `storage.py` with `chmod 600`.
  - `credential_for(provider_id) -> Credential | None` reads the file first, then the env names (via `config.py`).
  - Keys never leave this module except to an API adapter.
- **Detection.**
  - `detect(provider) -> ProviderStatus`:
    - ACP: `installed` (`shutil.which` on the command or npx), `version` when cheap.
    - API: `ready` = has a key.
  - Login state for ACP is `unknown` here; issue 05 fills it in.
  - Detection runs off the event loop (`asyncio.to_thread`) and is cached for 30 s.
- **Routes** (`backend/app/agent/routes.py`, an `APIRouter` included from `main.py`):
  - `GET /api/agent/providers` returns the catalog plus status, with `has_key` and never the key.
  - `PUT /api/agent/credentials/{provider_id}` saves `{api_key?, base_url?, model?}`. An unknown provider gets a 404, and an ACP provider gets a 400.
  - `DELETE /api/agent/credentials/{provider_id}`.
- **Frontend API types.** Add `AgentProvider`, `ProviderStatus` and calls to `frontend/src/api.ts`, next to the other typed calls.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `GET /api/agent/providers` lists all eight providers; the response carries no key material even when a key is saved.
- [ ] Saving a DeepSeek key marks it ready; deleting it falls back to `LLM_API_KEY` when `LLM_BASE_URL` is DeepSeek's.
- [ ] The credentials file is mode 600.
- [ ] An ACP provider whose command and npx are both missing reads `installed: false` with its install hint.
- [ ] Tests in `backend/tests/test_agent_providers.py`; only that file is run.
