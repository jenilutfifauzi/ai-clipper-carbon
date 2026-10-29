"""The chats of each Candidate, its Agent Threads: jobs/<job>/agent/<candidate>/index.json lists them,
and jobs/<job>/agent/<candidate>/<thread>.json keeps each one's finished Agent Turns, written whole as
each turn finishes (ADR 0030). A Candidate's single chat from before Threads, agent/<candidate>.json,
becomes its first Thread when first read."""

import re
import secrets
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.agent.events import AgentEvent, Stop, TextDelta, ThoughtDelta, ToolFinished, ToolStarted
from app.storage import write_atomic

TRANSCRIPTS_DIR = "agent"
INDEX = "index.json"
NEW_TITLE = "New chat"
# How much of its first prompt titles a Thread.
TITLE_CHARS = 60
# A Thread's id, as made here: also what keeps a request's id from naming a path elsewhere.
_THREAD_ID = re.compile(r"[0-9a-f]{1,32}")
# The index is read, changed and written again; two turns finishing at once mustn't lose either's
# change, nor two first reads both migrate.
_INDEX_LOCK = threading.RLock()


class AgentThread(BaseModel):
    """One chat of a Candidate with the Agent."""

    id: str
    title: str
    created_at: datetime
    # When its last turn finished, or it was made: the newest is listed first.
    updated_at: datetime


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ThoughtPart(BaseModel):
    type: Literal["thought"] = "thought"
    text: str


class ToolPart(BaseModel):
    type: Literal["tool"] = "tool"
    call: str
    tool: str
    summary: str
    # None while it runs (and for one a cancelled turn left running).
    ok: bool | None = None
    error: str | None = None
    revision: int | None = None
    # What the call was given and gave back, for its card in the chat (events.shown); None in a
    # transcript from before they were kept.
    input: str | None = None
    output: str | None = None


TurnPart = Annotated[TextPart | ThoughtPart | ToolPart, Field(discriminator="type")]


class TranscriptTurn(BaseModel):
    id: str
    provider: str
    model: str | None
    prompt: str
    parts: list[TurnPart] = Field(default_factory=list)
    first_revision: int | None = None
    last_revision: int | None = None
    stop: Stop
    started_at: datetime


_TRANSCRIPT = TypeAdapter(list[TranscriptTurn])


_THREADS = TypeAdapter(list[AgentThread])


def legacy_transcript_path(job_dir: Path, candidate_id: str) -> Path:
    """Where a Candidate's one chat was kept before Threads."""
    return job_dir / TRANSCRIPTS_DIR / f"{candidate_id}.json"


def threads_dir(job_dir: Path, candidate_id: str) -> Path:
    return job_dir / TRANSCRIPTS_DIR / candidate_id


def transcript_path(job_dir: Path, candidate_id: str, thread_id: str) -> Path:
    """Raises LookupError for an id that no Thread could have."""
    if not _THREAD_ID.fullmatch(thread_id):
        raise LookupError(f"No Agent Thread {thread_id!r}")
    return threads_dir(job_dir, candidate_id) / f"{thread_id}.json"


def list_threads(job_dir: Path, candidate_id: str) -> list[AgentThread]:
    """The Candidate's Threads, the most recently used first; none before its first."""
    return sorted(_index(job_dir, candidate_id), key=lambda thread: thread.updated_at, reverse=True)


def newest_thread(job_dir: Path, candidate_id: str) -> AgentThread:
    """The Thread a request naming none goes to: the most recently used, made now when there is none."""
    with _INDEX_LOCK:
        threads = list_threads(job_dir, candidate_id)
        return threads[0] if threads else _create(job_dir, candidate_id, NEW_TITLE)


def create_thread(job_dir: Path, candidate_id: str, title: str = NEW_TITLE) -> AgentThread:
    with _INDEX_LOCK:
        return _create(job_dir, candidate_id, title)


def rename_thread(job_dir: Path, candidate_id: str, thread_id: str, title: str) -> AgentThread:
    """Raises LookupError for a Thread the Candidate hasn't got."""
    with _INDEX_LOCK:
        threads = _index(job_dir, candidate_id)
        thread = _find(threads, thread_id)
        renamed = thread.model_copy(update={"title": title})
        _write_index(job_dir, candidate_id, [renamed if each.id == thread_id else each for each in threads])
        return renamed


def delete_thread(job_dir: Path, candidate_id: str, thread_id: str) -> None:
    """Forget the Thread and its turns. Raises LookupError for one the Candidate hasn't got."""
    with _INDEX_LOCK:
        threads = _index(job_dir, candidate_id)
        _find(threads, thread_id)
        _write_index(job_dir, candidate_id, [each for each in threads if each.id != thread_id])
        transcript_path(job_dir, candidate_id, thread_id).unlink(missing_ok=True)


def load_transcript(job_dir: Path, candidate_id: str, thread_id: str) -> list[TranscriptTurn]:
    """The Thread's finished turns, oldest first; none before its first."""
    _migrated(job_dir, candidate_id)
    path = transcript_path(job_dir, candidate_id, thread_id)
    return _TRANSCRIPT.validate_json(path.read_bytes()) if path.is_file() else []


def append_turn(job_dir: Path, candidate_id: str, thread_id: str, turn: TranscriptTurn) -> None:
    """Keep the finished turn in its Thread, which becomes the newest; a Thread still titled "New chat"
    takes its title from the turn's prompt. A Thread deleted meanwhile is listed again."""
    with _INDEX_LOCK:
        threads = _index(job_dir, candidate_id)
        path = transcript_path(job_dir, candidate_id, thread_id)
        write_atomic(path, _TRANSCRIPT.dump_json([*load_transcript(job_dir, candidate_id, thread_id), turn], indent=2))
        now = datetime.now(UTC)
        thread = next((each for each in threads if each.id == thread_id), None) or AgentThread(
            id=thread_id, title=NEW_TITLE, created_at=now, updated_at=now
        )
        title = _title(turn.prompt) if thread.title == NEW_TITLE else thread.title
        updated = thread.model_copy(update={"title": title, "updated_at": now})
        _write_index(job_dir, candidate_id, [updated, *(each for each in threads if each.id != thread_id)])


def find_turn(job_dir: Path, candidate_id: str, turn_id: str) -> TranscriptTurn | None:
    """A finished turn of any of the Candidate's Threads: Revert and Restore are per Revision, whichever
    Thread the turn is in (ADR 0028)."""
    for thread in list_threads(job_dir, candidate_id):
        if kept := next((turn for turn in load_transcript(job_dir, candidate_id, thread.id) if turn.id == turn_id), None):
            return kept
    return None


def _index(job_dir: Path, candidate_id: str) -> list[AgentThread]:
    _migrated(job_dir, candidate_id)
    path = threads_dir(job_dir, candidate_id) / INDEX
    return _THREADS.validate_json(path.read_bytes()) if path.is_file() else []


def _write_index(job_dir: Path, candidate_id: str, threads: list[AgentThread]) -> None:
    folder = threads_dir(job_dir, candidate_id)
    folder.mkdir(parents=True, exist_ok=True)
    write_atomic(folder / INDEX, _THREADS.dump_json(threads, indent=2))


def _create(job_dir: Path, candidate_id: str, title: str) -> AgentThread:
    now = datetime.now(UTC)
    thread = AgentThread(id=secrets.token_hex(6), title=title, created_at=now, updated_at=now)
    _write_index(job_dir, candidate_id, [thread, *_index(job_dir, candidate_id)])
    return thread


def _find(threads: list[AgentThread], thread_id: str) -> AgentThread:
    thread = next((each for each in threads if each.id == thread_id), None)
    if thread is None:
        raise LookupError(f"No Agent Thread {thread_id!r}")
    return thread


def _title(prompt: str) -> str:
    return " ".join(prompt.split())[:TITLE_CHARS] or NEW_TITLE


def _migrated(job_dir: Path, candidate_id: str) -> None:
    """Make the chat kept before Threads the Candidate's first Thread, titled from its first prompt:
    the old file is moved into a folder made aside, which then takes the Threads' place whole."""
    legacy, folder = legacy_transcript_path(job_dir, candidate_id), threads_dir(job_dir, candidate_id)
    if not legacy.is_file() or folder.exists():
        return
    with _INDEX_LOCK:
        if legacy.is_file() and not folder.exists():
            _migrate(legacy, folder)


def _migrate(legacy: Path, folder: Path) -> None:
    turns = _TRANSCRIPT.validate_json(legacy.read_bytes())
    now = datetime.now(UTC)
    thread = AgentThread(
        id=secrets.token_hex(6),
        title=_title(turns[0].prompt) if turns else NEW_TITLE,
        created_at=turns[0].started_at if turns else now,
        updated_at=turns[-1].started_at if turns else now,
    )
    aside = folder.with_name(f".{folder.name}.migrating")
    aside.mkdir(parents=True, exist_ok=True)
    write_atomic(aside / INDEX, _THREADS.dump_json([thread], indent=2))
    legacy.replace(aside / f"{thread.id}.json")
    aside.replace(folder)


def with_event(parts: list[TurnPart], event: AgentEvent) -> list[TurnPart]:
    """`parts` with `event` folded in: a delta extends the text or thought before it, a tool call adds a
    row that its finish fills in. Other events leave them as they are."""
    last = parts[-1] if parts else None
    if isinstance(event, TextDelta | ThoughtDelta):
        kind = TextPart if isinstance(event, TextDelta) else ThoughtPart
        if isinstance(last, kind):
            return [*parts[:-1], kind(text=last.text + event.delta)]
        return [*parts, kind(text=event.delta)]
    if isinstance(event, ToolStarted):
        return [*parts, ToolPart(call=event.call, tool=event.tool, summary=event.summary, input=event.input)]
    if isinstance(event, ToolFinished):
        done = {"ok": event.ok, "error": event.error, "revision": event.revision, "output": event.output}
        return [
            part.model_copy(update={**done, "input": part.input if part.input is not None else event.input})
            if isinstance(part, ToolPart) and part.call == event.call
            else part
            for part in parts
        ]
    return parts


def turn_text(turn: TranscriptTurn) -> str:
    """What the Agent said in `turn`, its thoughts and tool calls left out."""
    return "".join(part.text for part in turn.parts if isinstance(part, TextPart))
