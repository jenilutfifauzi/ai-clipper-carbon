"""What an Agent Turn tells the editor as it runs (`AgentEvent`), and how it reaches each open stream
of its Candidate (`AgentFeed`, topic `agent:<job>:<candidate>`)."""

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from typing import Annotated, Literal

from fastapi.sse import ServerSentEvent
from pydantic import BaseModel, Field

# How much of a tool call's input or output an event carries for the chat's tool card.
MAX_SHOWN = 4096

# Why a turn ended: the model answered without a tool call, it used up its steps, the owner pressed
# Stop, or something failed (an `error` event says what).
Stop = Literal["end_turn", "step_limit", "cancelled", "error"]


class TurnStarted(BaseModel):
    type: Literal["turn_started"] = "turn_started"
    turn: str
    # The browser tab whose chat sent it: that tab takes its Revisions as undo steps (ADR 0028).
    tab: str
    # The Agent Thread it is a turn of: a chat shows only its own Thread's turns.
    thread: str
    provider: str
    model: str | None
    # What the owner asked, so that every open chat shows it while the turn runs.
    prompt: str


class TextDelta(BaseModel):
    type: Literal["text"] = "text"
    turn: str
    delta: str


class ThoughtDelta(BaseModel):
    type: Literal["thought"] = "thought"
    turn: str
    delta: str


class ToolStarted(BaseModel):
    type: Literal["tool_started"] = "tool_started"
    turn: str
    call: str
    # Without any `mcp__…__` prefix.
    tool: str
    summary: str
    # The call's arguments (JSON, or text when they aren't), cut by `shown`.
    input: str | None = None


class ToolFinished(BaseModel):
    type: Literal["tool_finished"] = "tool_finished"
    turn: str
    call: str
    ok: bool
    error: str | None = None
    # The Revision the call saved, if it saved one.
    revision: int | None = None
    # The result's text, cut by `shown`; and the call's input when it only arrived with its end (ACP).
    output: str | None = None
    input: str | None = None


class TurnFinished(BaseModel):
    type: Literal["turn_finished"] = "turn_finished"
    turn: str
    stop: Stop
    # The first and last Revision the turn saved: Revert restores the one before the first.
    first_revision: int | None = None
    last_revision: int | None = None


class AgentError(BaseModel):
    type: Literal["error"] = "error"
    turn: str | None = None
    message: str


AgentEvent = Annotated[
    TurnStarted | TextDelta | ThoughtDelta | ToolStarted | ToolFinished | TurnFinished | AgentError,
    Field(discriminator="type"),
]


def shown(text: str | None, tool: str = "") -> str | None:
    """`text` cut to MAX_SHOWN characters, with `…` when it was cut, for a tool card. A `show_ui` call's
    is kept whole (the tool name may carry an `mcp__…__` prefix): the chat draws it (ticket 05)."""
    if text is None or len(text) <= MAX_SHOWN or tool.endswith("show_ui"):
        return text
    return text[:MAX_SHOWN] + "…"


def topic(job_id: str, candidate_id: str) -> str:
    return f"agent:{job_id}:{candidate_id}"


class AgentFeed:
    """The Agent's events by topic, handed to each stream watching it. In memory, on the app's loop."""

    def __init__(self) -> None:
        self._watchers: dict[str, set[asyncio.Queue[AgentEvent | None]]] = defaultdict(set)

    def publish(self, name: str, event: AgentEvent) -> None:
        for queue in self._watchers.get(name, ()):
            queue.put_nowait(event)

    def close(self) -> None:
        """End every stream: the app is stopping."""
        for queues in self._watchers.values():
            for queue in queues:
                queue.put_nowait(None)

    @contextmanager
    def watch(self, name: str) -> Iterator[asyncio.Queue[AgentEvent | None]]:
        queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue()
        self._watchers[name].add(queue)
        try:
            yield queue
        finally:
            self._watchers[name].discard(queue)
            if not self._watchers[name]:
                del self._watchers[name]


async def agent_events(feed: AgentFeed, name: str, running: Callable[[], dict[str, str]]) -> AsyncIterator[ServerSentEvent]:
    """A `ready` event with the turns `running` now (`{tab: turn}`), then each event of topic `name` as
    it is published, named by its type, until the app stops."""
    with feed.watch(name) as queue:
        yield ServerSentEvent(event="ready", data={"running": running()})
        while (event := await queue.get()) is not None:
            yield ServerSentEvent(event=event.type, data=event)
