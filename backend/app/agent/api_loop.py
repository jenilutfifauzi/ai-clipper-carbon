"""The API tool loop: an Agent Turn run against a model's HTTP API, whose tool calls go through the
scoped MCP server. This is its OpenAI Chat Completions adapter (DeepSeek, OpenAI-compatible)."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
from mcp import Client
from mcp_types import CallToolResult, TextContent, Tool

from app.agent.driver import TurnContext
from app.agent.events import AgentEvent, TextDelta, ThoughtDelta, ToolFinished, ToolStarted, TurnFinished

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
class _ToolCall:
    id: str = ""
    name: str = ""
    arguments: str = ""


@dataclass
class _Reply:
    """One streamed reply as it builds up."""

    text: str = ""
    reasoning: str = ""
    calls: dict[int, _ToolCall] = field(default_factory=dict)


async def run_chat_turn(context: TurnContext) -> AsyncIterator[AgentEvent]:
    """The Chat Completions driver (driver.py): ask, run the tool calls asked for, feed their results
    back, until a reply calls none or MAX_STEPS replies have been made."""
    credential = context.credential
    if credential is None:
        raise ProviderFailed(f"{context.provider.label} has no key")
    base_url = (credential.base_url or context.provider.base_url).rstrip("/")
    headers = {"Authorization": f"Bearer {credential.api_key}"}
    http = httpx.AsyncClient(transport=context.http_transport, base_url=base_url, headers=headers, timeout=HTTP_TIMEOUT)
    async with http, context.tools.connect() as mcp:
        tools = [chat_tool(tool) for tool in (await mcp.list_tools()).tools]
        messages = [
            {"role": "system", "content": context.system},
            *({"role": message.role, "content": message.text} for message in context.history),
            {"role": "user", "content": context.prompt},
        ]
        for _ in range(MAX_STEPS):
            reply = _Reply()
            async for event in _stream_reply(http, context, messages, tools, reply):
                yield event
            messages.append(_assistant_message(reply))
            if not reply.calls:
                yield TurnFinished(turn=context.turn, stop="end_turn")
                return
            for call in reply.calls.values():
                yield ToolStarted(turn=context.turn, call=call.id, tool=call.name, summary=tool_summary(call.name, _arguments(call)))
                ok, text = await _run_tool(mcp, call)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": trimmed(text)})
                yield ToolFinished(turn=context.turn, call=call.id, ok=ok, error=None if ok else text)
        yield TurnFinished(turn=context.turn, stop="step_limit")


def chat_tool(tool: Tool) -> dict:
    """An MCP tool as a Chat Completions `tools` entry."""
    return {"type": "function", "function": {"name": tool.name, "description": tool.description or "", "parameters": tool.input_schema}}


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


async def _stream_reply(
    http: httpx.AsyncClient, context: TurnContext, messages: list[dict], tools: list[dict], reply: _Reply
) -> AsyncIterator[AgentEvent]:
    """Stream one reply into `reply`, yielding its text and reasoning as they come."""
    body = {"model": context.model, "messages": messages, "tools": tools, "stream": True}
    async with http.stream("POST", "/chat/completions", json=body) as response:
        if response.is_error:
            said = (await response.aread()).decode(errors="replace")[:500]
            raise ProviderFailed(f"{context.provider.label} answered {response.status_code}: {said}")
        async for line in response.aiter_lines():
            data = line.removeprefix("data:").strip() if line.startswith("data:") else None
            if not data or data == "[DONE]":
                continue
            for choice in json.loads(data).get("choices") or []:
                delta = choice.get("delta") or {}
                if thought := delta.get("reasoning_content"):
                    reply.reasoning += thought
                    yield ThoughtDelta(turn=context.turn, delta=thought)
                if text := delta.get("content"):
                    reply.text += text
                    yield TextDelta(turn=context.turn, delta=text)
                for piece in delta.get("tool_calls") or []:
                    call = reply.calls.setdefault(piece.get("index", 0), _ToolCall())
                    function = piece.get("function") or {}
                    call.id = piece.get("id") or call.id
                    call.name = function.get("name") or call.name
                    call.arguments += function.get("arguments") or ""


def _assistant_message(reply: _Reply) -> dict:
    message: dict[str, Any] = {"role": "assistant", "content": reply.text or None}
    # DeepSeek's thinking mode wants a turn's reasoning back while its tool calls run.
    if reply.reasoning:
        message["reasoning_content"] = reply.reasoning
    if reply.calls:
        message["tool_calls"] = [
            {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.arguments or "{}"}}
            for call in reply.calls.values()
        ]
    return message


async def _run_tool(mcp: Client, call: _ToolCall) -> tuple[bool, str]:
    """Whether the call succeeded, and its result's text (or why it failed) for the model."""
    arguments = _arguments(call)
    if arguments is None:
        return False, f"The arguments of {call.name} weren't a JSON object: {call.arguments[:200]}"
    try:
        result: CallToolResult = await mcp.call_tool(call.name, arguments)
    except Exception as error:  # an MCP or transport error: the model is told, and the turn goes on
        return False, f"{call.name} failed: {error}"
    text = "\n".join(block.text for block in result.content if isinstance(block, TextContent))
    return not result.is_error, text


def _arguments(call: _ToolCall) -> dict[str, Any] | None:
    try:
        arguments = json.loads(call.arguments or "{}")
    except json.JSONDecodeError:
        return None
    return arguments if isinstance(arguments, dict) else None


def _short(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value)
    return text if len(text) <= 40 else text[:39] + "…"
