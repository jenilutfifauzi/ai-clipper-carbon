"""The API tool loop: an Agent Turn run against a model's HTTP API, whose tool calls go through the
scoped MCP server. The loop is the same for every API; an `ApiAdapter` speaks one of them
(api_chat.py, api_anthropic.py, api_gemini.py): it streams one model step from the turn's exchange so
far, and the loop runs the tool calls the step asked for and adds their results."""

import json
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Any

import httpx
from mcp import Client
from mcp_types import CallToolResult, TextContent, Tool

from app.agent.driver import ChatMessage, Driver, TurnContext
from app.agent.events import AgentEvent, ToolFinished, ToolStarted, TurnFinished

# Model replies a turn may make before it is stopped: each but the last runs tool calls.
MAX_STEPS = 30
# A tool result longer than this (in bytes) is cut, with a note, before the model reads it.
MAX_RESULT_BYTES = 12_000
# How many earlier turns' words the model is sent.
HISTORY_TURNS = 10
# A model may think a while before its first token.
HTTP_TIMEOUT = httpx.Timeout(30.0, read=300.0)


class ProviderFailed(Exception):
    """The model's API answered with an error; its message is the API's."""


@dataclass
class ToolCall:
    id: str = ""
    name: str = ""
    # As JSON text, as the model wrote it.
    arguments: str = ""


@dataclass
class ToolResult:
    call: ToolCall
    ok: bool
    # Trimmed to MAX_RESULT_BYTES; why it failed when it did.
    text: str


@dataclass
class Reply:
    """One model step, as an adapter streams it in: its words, its thinking and its tool calls, and
    `native`, the reply as its API gave it, which the adapter sends back as is (thinking signatures)."""

    text: str = ""
    thoughts: str = ""
    calls: list[ToolCall] = field(default_factory=list)
    native: Any = None


# What the turn has said so far, oldest first: earlier turns' words and the owner's prompt, the
# model's replies, and the results of each reply's tool calls.
Entry = ChatMessage | Reply | list[ToolResult]


@dataclass
class Exchange:
    turn: str
    model: str | None
    system: str
    tools: list[Tool]
    entries: list[Entry]


Step = Callable[[Exchange, Reply], AsyncIterator[AgentEvent]]
"""Stream the model's next reply to the exchange into `Reply`, yielding its text and thoughts as they
come. Raises ProviderFailed when the API refuses."""

ApiAdapter = Callable[[TurnContext], AbstractAsyncContextManager[Step]]
"""An API's client, opened for one turn with its credential, as the step that calls it."""


def api_driver(adapter: ApiAdapter) -> Driver:
    """The driver (driver.py) running a turn through `adapter`."""

    async def run(context: TurnContext) -> AsyncIterator[AgentEvent]:
        async for event in run_api_turn(context, adapter):
            yield event

    return run


async def run_api_turn(context: TurnContext, adapter: ApiAdapter) -> AsyncIterator[AgentEvent]:
    """Ask, run the tool calls asked for, feed their results back, until a reply calls none or
    MAX_STEPS replies have been made."""
    if context.credential is None:
        raise ProviderFailed(f"{context.provider.label} has no key")
    async with adapter(context) as step, context.tools.connect() as mcp:
        exchange = Exchange(
            turn=context.turn,
            model=context.model,
            system=context.system,
            tools=(await mcp.list_tools()).tools,
            entries=[*context.history, ChatMessage(role="user", text=context.prompt)],
        )
        for _ in range(MAX_STEPS):
            reply = Reply()
            async for event in step(exchange, reply):
                yield event
            exchange.entries.append(reply)
            if not reply.calls:
                yield TurnFinished(turn=context.turn, stop="end_turn")
                return
            results: list[ToolResult] = []
            for call in reply.calls:
                yield ToolStarted(turn=context.turn, call=call.id, tool=call.name, summary=tool_summary(call.name, arguments(call)))
                ok, text = await _run_tool(mcp, call)
                results.append(ToolResult(call=call, ok=ok, text=trimmed(text)))
                yield ToolFinished(turn=context.turn, call=call.id, ok=ok, error=None if ok else text)
            exchange.entries.append(results)
        yield TurnFinished(turn=context.turn, stop="step_limit")


def tool_summary(name: str, arguments: dict[str, Any] | None) -> str:
    """One line on what a call does, from its arguments: the keys edit_candidate sets, the kinds and
    counts merge_candidate_items gives, else its arguments other than the Job's and Candidate's ids."""
    if arguments is None:
        return "arguments that aren't JSON"
    if name == "edit_candidate":
        return "sets " + (", ".join(arguments.get("changes") or {}) or "nothing")
    if name == "merge_candidate_items":
        counts = [f"{kind} ×{len(items)}" for kind, items in arguments.items() if isinstance(items, list)]
        return "merges " + (", ".join(counts) or "nothing")
    shown = [f"{key}={_short(value)}" for key, value in arguments.items() if key not in ("job_id", "candidate_id")]
    return ", ".join(shown)[:120]


def trimmed(text: str) -> str:
    """`text`, cut to MAX_RESULT_BYTES with a note when it is longer."""
    data = text.encode()
    if len(data) <= MAX_RESULT_BYTES:
        return text
    kept = data[:MAX_RESULT_BYTES].decode(errors="ignore")
    return f"{kept}\n[trimmed: the result was {len(data)} bytes, of which the first {MAX_RESULT_BYTES} are shown; ask for less]"


def arguments(call: ToolCall) -> dict[str, Any] | None:
    """The call's arguments, or None when they aren't a JSON object."""
    try:
        parsed = json.loads(call.arguments or "{}")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _run_tool(mcp: Client, call: ToolCall) -> tuple[bool, str]:
    """Whether the call succeeded, and its result's text (or why it failed) for the model."""
    parsed = arguments(call)
    if parsed is None:
        return False, f"The arguments of {call.name} weren't a JSON object: {call.arguments[:200]}"
    try:
        result: CallToolResult = await mcp.call_tool(call.name, parsed)
    except Exception as error:  # an MCP or transport error: the model is told, and the turn goes on
        return False, f"{call.name} failed: {error}"
    text = "\n".join(block.text for block in result.content if isinstance(block, TextContent))
    return not result.is_error, text


def _short(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value)
    return text if len(text) <= 40 else text[:39] + "…"
