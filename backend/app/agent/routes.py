"""The Agent's HTTP routes: its providers and keys under /api/agent, and a Candidate's Agent Turns
and Agent Threads under /api/jobs/{job}/candidates/{candidate}/agent. Included from `create_app`."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field, StringConstraints

from app.agent.acp_client import AcpError, AcpExited
from app.agent.attachments import Attachments, BadAttachments, UnknownCandidate, resolve
from app.agent.credentials import SavedCredential, credential_for, delete_credential, save_credential
from app.agent.events import agent_events, topic
from app.agent.sessions import AgentSessionManager, TurnRunning
from app.agent.transcript_store import (
    AgentThread,
    TranscriptTurn,
    create_thread,
    delete_thread,
    list_threads,
    newest_thread,
    rename_thread,
)
from app.agent.providers import (
    PROVIDERS,
    AcpProvider,
    ApiProvider,
    DetectionCache,
    ProviderListing,
    api_status,
    provider_by_id,
)
from app.api import AfterSave, AppSettings, EditBy, ExistingJob, Logos, Media, Presets, Store, restore_revision
from app.candidates import Candidate
from app.config import Settings
from app.jobs import JobNotFound

router = APIRouter(prefix="/api/agent")
candidate_router = APIRouter(prefix="/api/jobs/{job_id}/candidates/{candidate_id}/agent")


class CredentialUpdate(BaseModel):
    """What the setup form saves; a field left out keeps what was saved."""

    api_key: str | None = Field(default=None, min_length=1, repr=False)
    base_url: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)


@router.get("/providers")
async def list_providers(request: Request) -> list[ProviderListing]:
    settings = _settings(request)
    detection = _detection(request)
    acp = [provider for provider in PROVIDERS if isinstance(provider, AcpProvider)]
    acp_statuses = dict(zip([p.id for p in acp], await asyncio.gather(*(detection.status(p) for p in acp))))
    return [
        ProviderListing(
            provider=provider,
            status=acp_statuses[provider.id]
            if isinstance(provider, AcpProvider)
            else api_status(provider, credential_for(settings, provider.id)),
        )
        for provider in PROVIDERS
    ]


class LoginStarted(BaseModel):
    """How the owner signs in: in the browser that `authenticate` opened (`acp`), or by running
    `command` in a terminal. `message` says which, for the setup to show."""

    provider: str
    login: Literal["acp", "terminal"]
    command: list[str] | None
    message: str


@router.post("/providers/{provider_id}/login")
async def login_provider(provider_id: str, request: Request) -> LoginStarted:
    provider = provider_by_id(provider_id)
    if provider is None:
        raise HTTPException(404, f"No Agent Provider {provider_id!r}")
    if not isinstance(provider, AcpProvider):
        raise HTTPException(400, f"{provider.label} takes a key, not a sign-in")
    if provider.login == "terminal":
        command = provider.login_command or []
        return LoginStarted(
            provider=provider.id, login="terminal", command=command, message=f"Run {' '.join(command)} in a terminal, then come back."
        )
    try:
        await _sessions(request).login(provider)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except (AcpError, AcpExited, TimeoutError, OSError) as error:
        raise HTTPException(502, f"{provider.label} couldn't start signing in: {error}") from error
    _detection(request).forget(provider.id)
    return LoginStarted(
        provider=provider.id, login="acp", command=None, message=f"Finish signing in to {provider.label} in the browser that opened."
    )


@router.put("/credentials/{provider_id}")
async def put_credential(provider_id: str, update: CredentialUpdate, request: Request) -> ProviderListing:
    provider = _api_provider(provider_id)
    if update.base_url and not provider.base_url_editable:
        raise HTTPException(400, f"{provider.label}'s base URL can't be changed")
    settings = _settings(request)
    await asyncio.to_thread(save_credential, settings, provider.id, SavedCredential(**update.model_dump(exclude_unset=True)))
    return ProviderListing(provider=provider, status=api_status(provider, credential_for(settings, provider.id)))


@router.delete("/credentials/{provider_id}", status_code=204)
async def remove_credential(provider_id: str, request: Request) -> Response:
    provider = _api_provider(provider_id)
    await asyncio.to_thread(delete_credential, _settings(request), provider.id)
    return Response(status_code=204)


class TurnRequest(BaseModel):
    """The owner's message: to which provider (and model; else its saved or default one), from which tab."""

    provider: str
    model: str | None = Field(default=None, min_length=1)
    prompt: str = Field(min_length=1)
    # What goes with it (attachments.py).
    attachments: Attachments = Field(default_factory=list)
    tab: str = Field(min_length=1)
    # The Agent Thread it goes to; else the newest.
    thread: str | None = Field(default=None, min_length=1)


class ThreadRename(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TurnAccepted(BaseModel):
    turn: str


class CancelRequest(BaseModel):
    tab: str = Field(min_length=1)


@candidate_router.post("/turns", status_code=202)
async def send_turn(job_id: str, candidate_id: str, request: TurnRequest, http: Request) -> TurnAccepted:
    await _existing_candidate(http, job_id, candidate_id)
    provider = provider_by_id(request.provider)
    if provider is None:
        raise HTTPException(404, f"No Agent Provider {request.provider!r}")
    credential, model = None, request.model
    if isinstance(provider, ApiProvider):
        credential = credential_for(_settings(http), provider.id)
        if credential is None:
            raise HTTPException(400, f"{provider.label} has no key: add one in the Agent tab's setup")
        model = request.model or credential.model or provider.default_model
        if model is None:
            raise HTTPException(400, f"Choose a model for {provider.label}")
    thread = await _thread(http, job_id, candidate_id, request.thread)
    try:
        attached = await asyncio.to_thread(resolve, http.app.state.store, job_id, candidate_id, request.attachments)
    except UnknownCandidate as error:
        raise HTTPException(404, str(error)) from error
    except BadAttachments as error:
        raise HTTPException(400, str(error)) from error
    try:
        turn = await _sessions(http).send(job_id, candidate_id, request.tab, provider, model, credential, request.prompt, thread, attached)
    except TurnRunning as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return TurnAccepted(turn=turn)


@candidate_router.post("/cancel", status_code=204)
async def cancel_turn(job_id: str, candidate_id: str, request: CancelRequest, http: Request) -> Response:
    """Stop the tab's turn, if one runs: it ends with what it had done so far."""
    await _sessions(http).cancel(job_id, candidate_id, request.tab)
    return Response(status_code=204)


@candidate_router.post("/turns/{turn}/revert")
def revert_turn(
    job_id: str,
    candidate_id: str,
    turn: str,
    http: Request,
    job: ExistingJob,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    edit: EditBy,
    after_save: AfterSave,
) -> Candidate:
    """Restore the Revision before the finished turn's first (ADR 0028), as the Candidate's next
    Revision. 404 for a turn not in the chat, 409 for one that saved nothing."""
    first, _ = _turn_revisions(http, job_id, candidate_id, turn)
    history = store.revision_history(job_id, candidate_id)
    before = next((entry for entry in reversed(history) if entry.revision < first), None)
    if before is None:
        raise HTTPException(409, f"The Revision History no longer keeps the state before Agent Turn {turn}")
    return restore_revision(job_id, candidate_id, before.revision, job, store, settings, presets, logos, library, edit, after_save)


@candidate_router.post("/turns/{turn}/restore")
def restore_turn(
    job_id: str,
    candidate_id: str,
    turn: str,
    http: Request,
    job: ExistingJob,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    edit: EditBy,
    after_save: AfterSave,
) -> Candidate:
    """Bring back the finished turn's last Revision, as the Candidate's next Revision. 404 for a turn
    not in the chat, 409 for one that saved nothing."""
    _, last = _turn_revisions(http, job_id, candidate_id, turn)
    return restore_revision(job_id, candidate_id, last, job, store, settings, presets, logos, library, edit, after_save)


@candidate_router.get("/transcript")
async def get_transcript(job_id: str, candidate_id: str, http: Request, thread: str | None = Query(default=None)) -> list[TranscriptTurn]:
    """An Agent Thread's finished turns, oldest first: the newest Thread's when none is named."""
    await _existing_candidate(http, job_id, candidate_id)
    return await asyncio.to_thread(_sessions(http).transcript, job_id, candidate_id, await _thread(http, job_id, candidate_id, thread))


@candidate_router.get("/threads")
async def get_threads(job_id: str, candidate_id: str, http: Request) -> list[AgentThread]:
    """The Candidate's Agent Threads, the most recently used first; one is made when it has none."""
    await _existing_candidate(http, job_id, candidate_id)
    job_dir = _job_dir(http, job_id)
    await asyncio.to_thread(newest_thread, job_dir, candidate_id)
    return await asyncio.to_thread(list_threads, job_dir, candidate_id)


@candidate_router.post("/threads", status_code=201)
async def post_thread(job_id: str, candidate_id: str, http: Request) -> AgentThread:
    await _existing_candidate(http, job_id, candidate_id)
    return await asyncio.to_thread(create_thread, _job_dir(http, job_id), candidate_id)


@candidate_router.patch("/threads/{thread}")
async def patch_thread(job_id: str, candidate_id: str, thread: str, body: ThreadRename, http: Request) -> AgentThread:
    await _existing_candidate(http, job_id, candidate_id)
    try:
        return await asyncio.to_thread(rename_thread, _job_dir(http, job_id), candidate_id, thread, body.title)
    except LookupError as error:
        raise HTTPException(404, f"Candidate {candidate_id} has no Agent Thread {thread}") from error


@candidate_router.delete("/threads/{thread}", status_code=204)
async def remove_thread(job_id: str, candidate_id: str, thread: str, http: Request) -> Response:
    """Forget the Thread and its turns; 409 while a turn runs in it. The Revisions its turns saved stay."""
    await _existing_candidate(http, job_id, candidate_id)
    if _sessions(http).thread_busy(job_id, candidate_id, thread):
        raise HTTPException(409, f"An Agent Turn is running in Agent Thread {thread}")
    try:
        await asyncio.to_thread(delete_thread, _job_dir(http, job_id), candidate_id, thread)
    except LookupError as error:
        raise HTTPException(404, f"Candidate {candidate_id} has no Agent Thread {thread}") from error
    return Response(status_code=204)


@candidate_router.get("/events", response_class=EventSourceResponse)
async def stream_agent_events(job_id: str, candidate_id: str, http: Request) -> AsyncIterator[ServerSentEvent]:
    """`ready` with the turns running now, then each Agent Turn's events on this Candidate (events.py)."""
    await _existing_candidate(http, job_id, candidate_id)
    sessions = _sessions(http)
    async for event in agent_events(sessions.feed, topic(job_id, candidate_id), lambda: sessions.running(job_id, candidate_id)):
        yield event


async def _existing_candidate(request: Request, job_id: str, candidate_id: str) -> None:
    store = request.app.state.store
    try:
        await asyncio.to_thread(store.get, job_id)
    except JobNotFound as error:
        raise HTTPException(404, f"No Job {job_id}") from error
    candidates = await asyncio.to_thread(store.load_candidates, job_id) or []
    if not any(candidate.id == candidate_id for candidate in candidates):
        raise HTTPException(404, f"Job {job_id} has no Candidate {candidate_id}")


async def _thread(request: Request, job_id: str, candidate_id: str, thread: str | None) -> str:
    """The Agent Thread a request names, which must be the Candidate's; the newest when it names none."""
    job_dir = _job_dir(request, job_id)
    if thread is None:
        return (await asyncio.to_thread(newest_thread, job_dir, candidate_id)).id
    if not any(each.id == thread for each in await asyncio.to_thread(list_threads, job_dir, candidate_id)):
        raise HTTPException(404, f"Candidate {candidate_id} has no Agent Thread {thread}")
    return thread


def _job_dir(request: Request, job_id: str) -> Path:
    return request.app.state.store.job_dir(job_id)


def _turn_revisions(request: Request, job_id: str, candidate_id: str, turn: str) -> tuple[int, int]:
    """The first and last Revision a finished turn of any of the Candidate's Threads saved."""
    kept = _sessions(request).finished_turn(job_id, candidate_id, turn)
    if kept is None:
        raise HTTPException(404, f"Candidate {candidate_id} has no finished Agent Turn {turn}")
    if kept.first_revision is None or kept.last_revision is None:
        raise HTTPException(409, f"Agent Turn {turn} saved no Revision")
    return kept.first_revision, kept.last_revision


def _sessions(request: Request) -> AgentSessionManager:
    return request.app.state.agent_sessions


def _api_provider(provider_id: str) -> ApiProvider:
    provider = provider_by_id(provider_id)
    if provider is None:
        raise HTTPException(404, f"No Agent Provider {provider_id!r}")
    if not isinstance(provider, ApiProvider):
        raise HTTPException(400, f"{provider.label} signs in with its own login, not a key")
    return provider


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _detection(request: Request) -> DetectionCache:
    """One per app, made on first use."""
    state = request.app.state
    if getattr(state, "agent_detection", None) is None:
        state.agent_detection = DetectionCache()
    return state.agent_detection
