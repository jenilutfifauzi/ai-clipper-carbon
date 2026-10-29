"""The chat of each Candidate: its finished Agent Turns, kept in jobs/<job>/agent/<candidate>.json and
written whole as each turn finishes."""

from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.agent.events import AgentEvent, Stop, TextDelta, ThoughtDelta, ToolFinished, ToolStarted
from app.storage import write_atomic

TRANSCRIPTS_DIR = "agent"


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


def transcript_path(job_dir: Path, candidate_id: str) -> Path:
    return job_dir / TRANSCRIPTS_DIR / f"{candidate_id}.json"


def load_transcript(job_dir: Path, candidate_id: str) -> list[TranscriptTurn]:
    """The Candidate's finished turns, oldest first; none before its first."""
    path = transcript_path(job_dir, candidate_id)
    return _TRANSCRIPT.validate_json(path.read_bytes()) if path.is_file() else []


def append_turn(job_dir: Path, candidate_id: str, turn: TranscriptTurn) -> None:
    path = transcript_path(job_dir, candidate_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, _TRANSCRIPT.dump_json([*load_transcript(job_dir, candidate_id), turn], indent=2))


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
