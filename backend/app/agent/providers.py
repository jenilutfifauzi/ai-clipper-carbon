"""The Agent Providers (GLOSSARY.md): the coding agents the backend launches over ACP and the API models
its own tool loop calls, and whether each is ready to run an Agent Turn."""

import asyncio
import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.agent.credentials import Credential
from app.config import DEFAULT_GEMINI_MODEL

# How long a detection of the ACP agents' commands holds before it is made again.
DETECTION_TTL_SECS = 30.0
# `<command> --version` is given this long; a slower one leaves the version unknown.
VERSION_TIMEOUT_SECS = 3.0
# `<command> --help`, read for its ACP flag, is given this long (Gemini CLI is a Node program).
HELP_TIMEOUT_SECS = 10.0
# The scoped MCP server's name as an ACP agent knows it: its tools are `mcp__ai-clipper__<tool>`.
MCP_SERVER_NAME = "ai-clipper"
# Claude Code's built-in tools that touch the shell, files or the web: refused outright through the
# adapter's `_meta`, whatever the owner's own Claude Code settings allow.
CLAUDE_CODE_DISALLOWED = ["Bash", "BashOutput", "KillShell", "Edit", "MultiEdit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]


class AcpProvider(BaseModel):
    """A coding agent run as a subprocess speaking the Agent Client Protocol over stdio."""

    kind: Literal["acp"] = "acp"
    id: str
    label: str
    # Its adapter's or CLI's command, tried first.
    command: list[str]
    # Where else `command[0]` may be: another name on PATH, or a path (`~` is the home folder).
    locations: list[str] = []
    # The ACP flags it may take, newest first: the first that `<command> --help` lists is added to
    # `command`, the last when it lists none (an older CLI's help may not show it).
    acp_flags: list[str] = []
    # The npm package run through `npx -y` when `command` isn't installed but npx is; None: no fallback.
    npx_package: str | None = None
    install_hint: str
    # How the owner signs in: through ACP's `authenticate`, or by running `login_command` in a terminal.
    login: Literal["acp", "terminal"]
    login_command: list[str] | None = None
    docs_url: str
    # Shown in its setup, such as Antigravity's terms note.
    warning: str | None = None
    # What to do before its first turn, shown in its setup and when it refuses to open a session.
    setup_note: str | None = None
    # Sent as `session/new`'s `_meta`: Claude Code's adapter reads its Agent SDK options there.
    session_meta: dict[str, Any] | None = Field(default=None, exclude=True)


class ApiProvider(BaseModel):
    """A model the backend's own tool loop calls over its HTTP API."""

    kind: Literal["api"] = "api"
    id: str
    label: str
    base_url: str
    # Whether the owner may point it elsewhere (an OpenAI-compatible service).
    base_url_editable: bool = False
    models: list[str]
    default_model: str | None
    # The `.env` names its key is read from when none is saved (app/agent/credentials.py).
    key_env: list[str]
    docs_url: str
    # Whether its models take images with a message (an ACP agent's `initialize` answer says so instead).
    sees_images: bool = True


AgentProvider = Annotated[AcpProvider | ApiProvider, Field(discriminator="kind")]


class ProviderStatus(BaseModel):
    """Whether a provider can run an Agent Turn now. Never carries a key."""

    id: str
    ready: bool
    # ACP: whether its command, or npx for its package, is on PATH; None for an API provider.
    installed: bool | None = None
    # The command it would be launched with, its fallback included; None when neither is installed.
    command: list[str] | None = None
    version: str | None = None
    # ACP sign-in, as far as a known login file tells (`login_state`); "unknown" otherwise.
    login: Literal["unknown", "signed_in", "signed_out"] | None = None
    # API: whether a key is saved or found in the environment, where from, and the base URL and model used.
    has_key: bool | None = None
    key_source: Literal["saved", "env"] | None = None
    base_url: str | None = None
    model: str | None = None


class ProviderListing(BaseModel):
    provider: AgentProvider
    status: ProviderStatus


PROVIDERS: list[AcpProvider | ApiProvider] = [
    AcpProvider(
        id="claude-code",
        label="Claude Code",
        command=["claude-agent-acp"],
        npx_package="@agentclientprotocol/claude-agent-acp",
        install_hint="npm install -g @agentclientprotocol/claude-agent-acp (and Claude Code itself)",
        # Its adapter offers terminal sign-ins only (`claude auth login`).
        login="terminal",
        login_command=["claude", "auth", "login"],
        docs_url="https://docs.claude.com/en/docs/claude-code",
        # The scoped server's tools allowed without asking; the shell, files and the web refused.
        session_meta={
            "claudeCode": {"options": {"allowedTools": [f"mcp__{MCP_SERVER_NAME}"], "disallowedTools": CLAUDE_CODE_DISALLOWED}}
        },
    ),
    AcpProvider(
        id="codex",
        label="Codex",
        command=["codex-acp"],
        npx_package="@agentclientprotocol/codex-acp",
        install_hint="npm install -g @agentclientprotocol/codex-acp (and the Codex CLI)",
        # Its adapter's `authenticate` with ChatGPT opens the browser; `codex login` does the same by hand.
        login="acp",
        login_command=["codex", "login"],
        docs_url="https://developers.openai.com/codex/cli",
    ),
    AcpProvider(
        id="gemini-cli",
        label="Gemini CLI",
        command=["gemini"],
        # `--acp` in current releases; `--experimental-acp` before, kept as a deprecated alias.
        acp_flags=["--acp", "--experimental-acp"],
        install_hint="npm install -g @google/gemini-cli",
        # Its `authenticate` offers "Log in with Google" in the browser; `gemini` signs in on first run too.
        login="acp",
        login_command=["gemini"],
        docs_url="https://github.com/google-gemini/gemini-cli",
    ),
    AcpProvider(
        id="antigravity",
        label="Antigravity",
        command=["agy_acp_server"],
        # The ACP registry's macOS build is `agy_acp_server.par`, in a zip unpacked wherever the owner puts it.
        locations=["agy_acp_server.par", "~/.local/bin/agy_acp_server.par", "~/.local/bin/agy_acp_server"],
        install_hint="Download agy_acp_server from the ACP registry and put it on PATH or in ~/.local/bin",
        login="acp",
        docs_url="https://antigravity.google/docs/ide/extensions",
        warning=(
            "Google's terms may not allow a personal Antigravity login to be used from other apps. "
            "Use it at your own risk, or use Gemini CLI or a Gemini API key."
        ),
        setup_note="Choose how Antigravity signs in, in Antigravity's own settings, before its first turn.",
    ),
    ApiProvider(
        id="deepseek",
        label="DeepSeek",
        base_url="https://api.deepseek.com",
        models=["deepseek-chat", "deepseek-reasoner"],
        default_model="deepseek-chat",
        key_env=["LLM_API_KEY"],
        docs_url="https://api-docs.deepseek.com",
        # Its chat models read text alone.
        sees_images=False,
    ),
    ApiProvider(
        id="openai-compatible",
        label="OpenAI-compatible",
        base_url="https://api.openai.com/v1",
        base_url_editable=True,
        models=[],
        default_model=None,
        key_env=["LLM_API_KEY"],
        docs_url="https://platform.openai.com/docs/api-reference/chat",
    ),
    ApiProvider(
        id="anthropic",
        label="Anthropic",
        base_url="https://api.anthropic.com",
        models=["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
        default_model="claude-sonnet-5-5",
        key_env=["ANTHROPIC_API_KEY"],
        docs_url="https://docs.claude.com/en/api/overview",
    ),
    ApiProvider(
        id="gemini",
        label="Gemini",
        base_url="https://generativelanguage.googleapis.com",
        models=[DEFAULT_GEMINI_MODEL],
        default_model=DEFAULT_GEMINI_MODEL,
        key_env=["GEMINI_API_KEY"],
        docs_url="https://ai.google.dev/gemini-api/docs",
    ),
]


def provider_by_id(provider_id: str) -> AcpProvider | ApiProvider | None:
    return next((provider for provider in PROVIDERS if provider.id == provider_id), None)


def launch_command(provider: AcpProvider, which: Callable[[str], str | None] = shutil.which) -> list[str] | None:
    """The command `provider` is started with: its own when installed (on PATH or at one of its
    `locations`, with its ACP flag), else `npx -y <package>` when npx is, else None. Blocking the
    first time an `acp_flags` CLI is seen: its `--help` is read."""
    if binary := _installed(provider, which):
        flag = _acp_flag(which(binary) or binary, tuple(provider.acp_flags)) if provider.acp_flags else None
        return [binary, *provider.command[1:], *([flag] if flag else [])]
    if provider.npx_package and which("npx"):
        return ["npx", "-y", provider.npx_package]
    return None


def _installed(provider: AcpProvider, which: Callable[[str], str | None]) -> str | None:
    """`command[0]` when on PATH, else the first of its `locations` there is: a name as is, a path in full."""
    for name in [provider.command[0], *provider.locations]:
        if "/" not in name:
            if which(name):
                return name
            continue
        path = Path(name).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


@cache
def _acp_flag(binary: str, flags: tuple[str, ...]) -> str:
    """The first of `flags` that `<binary> --help` lists, else the last; read once per installed binary."""
    try:
        result = subprocess.run(
            [binary, "--help"], capture_output=True, text=True, timeout=HELP_TIMEOUT_SECS, check=False, stdin=subprocess.DEVNULL
        )
        listed = set((result.stdout + result.stderr).split())
    except (OSError, subprocess.TimeoutExpired):
        listed = set()
    return next((flag for flag in flags if flag in listed), flags[-1])


def detect_acp(provider: AcpProvider) -> ProviderStatus:
    """Whether `provider` can be launched, and its version when its own command is installed. Blocking."""
    command = launch_command(provider)
    if command is None:
        return ProviderStatus(id=provider.id, ready=False, installed=False, login="unknown")
    version = None if command[:2] == ["npx", "-y"] else _version(command[0])
    return ProviderStatus(id=provider.id, ready=True, installed=True, command=command, version=version, login=login_state(provider))


def login_state(provider: AcpProvider) -> Literal["unknown", "signed_in"]:
    """"signed_in" when the agent's CLI has left its login where it keeps it: Codex's auth.json, Claude
    Code's credentials file or its account in ~/.claude.json (macOS keeps the token in the Keychain),
    or an API key in the environment. Anything else is "unknown": a login may live elsewhere."""
    home = Path.home()
    if provider.id == "codex":
        codex_home = Path(os.environ.get("CODEX_HOME") or home / ".codex")
        return "signed_in" if (codex_home / "auth.json").is_file() else "unknown"
    if provider.id == "claude-code":
        config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or home / ".claude")
        if os.environ.get("ANTHROPIC_API_KEY") or (config_dir / ".credentials.json").is_file():
            return "signed_in"
        return "signed_in" if _has_oauth_account(home / ".claude.json") else "unknown"
    return "unknown"


def _has_oauth_account(path: Path) -> bool:
    try:
        return bool(json.loads(path.read_text()).get("oauthAccount"))
    except (OSError, ValueError, AttributeError):
        return False


def api_status(provider: ApiProvider, credential: Credential | None) -> ProviderStatus:
    """An API provider is ready once it has a key; the key itself stays out."""
    if credential is None:
        return ProviderStatus(
            id=provider.id, ready=False, has_key=False, base_url=provider.base_url, model=provider.default_model
        )
    return ProviderStatus(
        id=provider.id,
        ready=True,
        has_key=True,
        key_source=credential.source,
        base_url=credential.base_url or provider.base_url,
        model=credential.model or provider.default_model,
    )


@dataclass
class DetectionCache:
    """The ACP agents' detections, each kept for `ttl_secs`: launching `--version` isn't free."""

    ttl_secs: float = DETECTION_TTL_SECS
    clock: Callable[[], float] = time.monotonic
    _entries: dict[str, tuple[float, ProviderStatus]] = field(default_factory=dict)

    async def status(self, provider: AcpProvider) -> ProviderStatus:
        cached = self._entries.get(provider.id)
        now = self.clock()
        if cached and now - cached[0] < self.ttl_secs:
            return cached[1]
        status = await asyncio.to_thread(detect_acp, provider)
        self._entries[provider.id] = (now, status)
        return status

    def forget(self, provider_id: str) -> None:
        """Detect it afresh next time: its sign-in may have changed."""
        self._entries.pop(provider_id, None)


def _version(binary: str) -> str | None:
    try:
        result = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=VERSION_TIMEOUT_SECS, check=False, stdin=subprocess.DEVNULL
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = (result.stdout or result.stderr).strip().splitlines()
    return lines[0].strip() if result.returncode == 0 and lines else None
