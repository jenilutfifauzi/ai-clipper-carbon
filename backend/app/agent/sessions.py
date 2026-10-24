"""The Agent Sessions open now: one per Candidate per browser tab, each running at most one Agent Turn
at a time, as a task on the app's loop. A turn's events go out on its Candidate's topic, and its
words into the Candidate's chat when it ends."""

import asyncio
import logging
import secrets
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import FastAPI

from app.agent.acp_client import AcpAgent, start_login
from app.agent.api_anthropic import run_anthropic_turn
from app.agent.api_chat import run_chat_turn
from app.agent.api_gemini import run_gemini_turn
from app.agent.api_loop import HISTORY_TURNS
from app.agent.credentials import Credential
from app.agent.driver import ChatMessage, Driver, ScopedEndpoint, TurnContext
from app.agent.events import AgentError, AgentEvent, AgentFeed, Stop, ToolFinished, TurnFinished, TurnStarted, topic
from app.agent.prompt import system_prompt
from app.agent.providers import AcpProvider, ApiProvider, launch_command
from app.agent.scope import AgentScope, ScopeRegistry
from app.agent.transcript_store import TranscriptTurn, TurnPart, append_turn, load_transcript, turn_text, with_event
from app.jobs import JobStore

logger = logging.getLogger(__name__)

SessionKey = tuple[str, str, str]
# The ACP agents an Agent Turn runs on so far (acp_client.py); Gemini CLI and Antigravity come later.
ACP_DRIVEN = ("claude-code", "codex")
# Where each Agent Session's ACP agent runs: an empty folder of its own under DATA_DIR.
SANDBOX_DIR = Path("agent") / "sandbox"


class TurnRunning(Exception):
    """The session is running a turn already."""


@dataclass
class AgentSession:
    job_id: str
    candidate_id: str
    tab: str
    provider: ApiProvider | AcpProvider
    model: str | None
    credential: Credential | None
    # Its bearer token for the scoped MCP server, whose scope names its turn while one runs.
    token: str
    turn: str | None = None
    task: asyncio.Task | None = None
    # Its ACP agent's process, kept between turns; None for an API provider.
    acp: AcpAgent | None = None

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()


# The API providers' drivers, by provider id.
API_DRIVERS: dict[str, Driver] = {
    "deepseek": run_chat_turn,
    "openai-compatible": run_chat_turn,
    "anthropic": run_anthropic_turn,
    "gemini": run_gemini_turn,
}


def driver_for(provider: ApiProvider | AcpProvider) -> Driver:
    """What runs a turn for `provider`: the API tool loop through its adapter for an API provider."""
    if isinstance(provider, ApiProvider) and provider.id in API_DRIVERS:
        return API_DRIVERS[provider.id]
    raise ValueError(f"{provider.label} can't run an Agent Turn yet")


def acp_command(provider: AcpProvider) -> list[str]:
    """What an ACP provider's agent is launched with. Raises ValueError when it can't run a turn."""
    if provider.id not in ACP_DRIVEN:
        raise ValueError(f"{provider.label} can't run an Agent Turn yet")
    command = launch_command(provider)
    if command is None:
        raise ValueError(f"{provider.label} isn't installed: {provider.install_hint}")
    return command


class AgentSessionManager:
    """On app.state.agent_sessions, made in the lifespan; `close` ends every session."""

    def __init__(self, app: FastAPI, http_transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._app = app
        self._http_transport = http_transport
        self._sessions: dict[SessionKey, AgentSession] = {}
        # Sign-ins under way: each waits for the owner to finish in the browser.
        self._logins: set[asyncio.Task] = set()
        self.feed = AgentFeed()

    @property
    def _store(self) -> JobStore:
        return self._app.state.store

    @property
    def _scopes(self) -> ScopeRegistry:
        return self._app.state.agent_scopes

    def running(self, job_id: str, candidate_id: str) -> dict[str, str]:
        """The turns running on the Candidate now, by tab."""
        return {
            session.tab: session.turn
            for session in self._sessions.values()
            if (session.job_id, session.candidate_id) == (job_id, candidate_id) and session.busy and session.turn
        }

    async def send(
        self,
        job_id: str,
        candidate_id: str,
        tab: str,
        provider: ApiProvider | AcpProvider,
        model: str | None,
        credential: Credential | None,
        prompt: str,
    ) -> str:
        """Start a turn of the tab's session (opened now if it isn't) and return its id. Raises
        TurnRunning while the session runs one, and ValueError for a provider that can't run one."""
        command = acp_command(provider) if isinstance(provider, AcpProvider) else None
        driver = driver_for(provider) if command is None else None
        session = self._session(job_id, candidate_id, tab, provider, model, credential)
        if session.busy:
            raise TurnRunning(f"An Agent Turn is running in tab {tab}")
        if command is not None:
            driver = (await self._acp_agent(session, provider, command)).run_turn
        session.provider, session.model, session.credential = provider, model, credential
        session.turn = secrets.token_hex(6)
        session.task = asyncio.create_task(self._run(session, session.turn, driver, prompt))
        return session.turn

    async def cancel(self, job_id: str, candidate_id: str, tab: str) -> bool:
        """Stop the tab's turn; False when none runs. It ends with `stop: "cancelled"`."""
        session = self._sessions.get((job_id, candidate_id, tab))
        if session is None or not session.busy:
            return False
        session.task.cancel()
        with suppress(asyncio.CancelledError):
            await session.task
        return True

    async def login(self, provider: AcpProvider) -> None:
        """Start signing in to `provider` through ACP's `authenticate`: the browser opens on this Mac.
        Raises ValueError when it isn't installed; acp_client's errors when it can't start a sign-in."""
        command = launch_command(provider)
        if command is None:
            raise ValueError(f"{provider.label} isn't installed: {provider.install_hint}")
        sandbox = self._app.state.settings.data_dir / SANDBOX_DIR / f"login-{secrets.token_hex(6)}"
        task = await start_login(command, sandbox, provider.label)
        self._logins.add(task)
        task.add_done_callback(self._logins.discard)

    def transcript(self, job_id: str, candidate_id: str) -> list[TranscriptTurn]:
        return load_transcript(self._store.job_dir(job_id), candidate_id)

    async def close(self) -> None:
        """Cancel every turn, forget every session's token and end the event streams."""
        tasks = [session.task for session in self._sessions.values() if session.busy] + list(self._logins)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*(session.acp.close() for session in self._sessions.values() if session.acp), return_exceptions=True)
        for session in self._sessions.values():
            self._scopes.revoke(session.token)
        self._sessions.clear()
        self.feed.close()

    def _session(
        self, job_id: str, candidate_id: str, tab: str, provider: ApiProvider | AcpProvider, model: str | None, credential: Credential | None
    ) -> AgentSession:
        key = (job_id, candidate_id, tab)
        if (session := self._sessions.get(key)) is not None:
            return session
        session_id = secrets.token_hex(6)
        token = self._scopes.issue(AgentScope(job_id=job_id, candidate_id=candidate_id, session_id=session_id))
        session = AgentSession(job_id, candidate_id, tab, provider, model, credential, token)
        self._sessions[key] = session
        return session

    async def _acp_agent(self, session: AgentSession, provider: AcpProvider, command: list[str]) -> AcpAgent:
        """The session's ACP agent: its own, unless the tab has switched to another provider, whose
        process then replaces it."""
        if session.acp is not None and session.acp.provider_id == provider.id:
            return session.acp
        if session.acp is not None:
            await session.acp.close()
        scope = self._scopes.resolve(session.token)
        sandbox = self._app.state.settings.data_dir / SANDBOX_DIR / scope.session_id
        session.acp = AcpAgent(provider.id, provider.label, command, sandbox)
        return session.acp

    async def _run(self, session: AgentSession, turn: str, driver: Driver, prompt: str) -> None:
        """Run the turn to its end, whatever ends it, and keep it in the chat."""
        name = topic(session.job_id, session.candidate_id)
        started_at = datetime.now(UTC)
        model = session.model or (session.credential.model if session.credential else None) or getattr(session.provider, "default_model", None)
        parts: list[TurnPart] = []
        revisions: list[int] = []
        stop: Stop = "end_turn"

        def publish(event: AgentEvent) -> None:
            nonlocal parts
            parts = with_event(parts, event)
            self.feed.publish(name, event)

        self._scopes.set_turn(session.token, turn)
        publish(TurnStarted(turn=turn, tab=session.tab, provider=session.provider.id, model=model))
        try:
            context = await self._context(session, turn, model, prompt)
            async for event in driver(context):
                if isinstance(event, TurnFinished):
                    stop = event.stop
                    continue
                if isinstance(event, ToolFinished):
                    revision = await self._saved_revision(session, turn, revisions[-1] if revisions else None)
                    revisions += [revision] if revision is not None else []
                    event = event.model_copy(update={"revision": revision})
                publish(event)
        except asyncio.CancelledError:
            stop = "cancelled"
            if (task := asyncio.current_task()) is not None:
                task.uncancel()
        except Exception as error:
            logger.exception("Agent Turn %s failed", turn)
            cause = _innermost(error)
            publish(AgentError(turn=turn, message=str(cause) or type(cause).__name__))
            stop = "error"
        finally:
            self._scopes.set_turn(session.token, None)
        first, last = (revisions[0], revisions[-1]) if revisions else (None, None)
        publish(TurnFinished(turn=turn, stop=stop, first_revision=first, last_revision=last))
        record = TranscriptTurn(
            id=turn, provider=session.provider.id, model=model, prompt=prompt, parts=parts,
            first_revision=first, last_revision=last, stop=stop, started_at=started_at,
        )
        await asyncio.to_thread(append_turn, self._store.job_dir(session.job_id), session.candidate_id, record)

    async def _context(self, session: AgentSession, turn: str, model: str | None, prompt: str) -> TurnContext:
        candidates = await asyncio.to_thread(self._store.load_candidates, session.job_id)
        candidate = next((c for c in candidates or [] if c.id == session.candidate_id), None)
        if candidate is None:
            raise LookupError(f"Job {session.job_id} has no Candidate {session.candidate_id}")
        turns = await asyncio.to_thread(self.transcript, session.job_id, session.candidate_id)
        history = [
            message
            for earlier in turns[-HISTORY_TURNS:]
            for message in (ChatMessage(role="user", text=earlier.prompt), ChatMessage(role="assistant", text=turn_text(earlier)))
            if message.text
        ]
        return TurnContext(
            turn=turn,
            provider=session.provider,
            model=model,
            credential=session.credential,
            system=system_prompt(self._app.state.agent_mcp.instructions or "", session.job_id, candidate),
            history=history,
            prompt=prompt,
            tools=ScopedEndpoint(self._app, session.token, self._app.state.settings.backend_origin),
            http_transport=self._http_transport,
        )

    async def _saved_revision(self, session: AgentSession, turn: str, last: int | None) -> int | None:
        """The Revision the turn's last tool call saved, read from Revision History: its newest entry,
        when it names this turn and is newer than `last`."""
        history = await asyncio.to_thread(self._store.revision_history, session.job_id, session.candidate_id)
        newest = history[-1] if history else None
        if newest is None or newest.tab != f"agent:{turn}" or (last is not None and newest.revision <= last):
            return None
        return newest.revision


def _innermost(error: BaseException) -> BaseException:
    """The error a task group (the MCP client's) wrapped, when it wrapped one alone."""
    while isinstance(error, BaseExceptionGroup) and len(error.exceptions) == 1:
        error = error.exceptions[0]
    return error
