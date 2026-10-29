"""The API tool loop's OpenAI Chat Completions adapter (DeepSeek, OpenAI-compatible), over httpx."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from mcp_types import Tool

from app.agent.api_loop import HTTP_TIMEOUT, Exchange, ProviderFailed, Reply, Step, ToolCall, api_driver
from app.agent.driver import ChatMessage, TurnContext
from app.agent.events import AgentEvent, TextDelta, ThoughtDelta


@asynccontextmanager
async def chat_adapter(context: TurnContext) -> AsyncIterator[Step]:
    base_url = (context.credential.base_url or context.provider.base_url).rstrip("/")
    headers = {"Authorization": f"Bearer {context.credential.api_key}"}
    async with httpx.AsyncClient(transport=context.http_transport, base_url=base_url, headers=headers, timeout=HTTP_TIMEOUT) as http:

        async def step(exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
            async for event in _stream_reply(http, context.provider.label, exchange, reply):
                yield event

        yield step


run_chat_turn = api_driver(chat_adapter)


def chat_tool(tool: Tool) -> dict:
    """An MCP tool as a Chat Completions `tools` entry."""
    return {"type": "function", "function": {"name": tool.name, "description": tool.description or "", "parameters": tool.input_schema}}


async def _stream_reply(http: httpx.AsyncClient, label: str, exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
    """Stream one reply into `reply`, yielding its text and reasoning as they come."""
    body = {"model": exchange.model, "messages": _messages(exchange), "tools": [chat_tool(tool) for tool in exchange.tools], "stream": True}
    calls: dict[int, ToolCall] = {}
    async with http.stream("POST", "/chat/completions", json=body) as response:
        if response.is_error:
            said = (await response.aread()).decode(errors="replace")[:500]
            raise ProviderFailed(f"{label} answered {response.status_code}: {said}")
        async for line in response.aiter_lines():
            data = line.removeprefix("data:").strip() if line.startswith("data:") else None
            if not data or data == "[DONE]":
                continue
            for choice in json.loads(data).get("choices") or []:
                delta = choice.get("delta") or {}
                if thought := delta.get("reasoning_content"):
                    reply.thoughts += thought
                    yield ThoughtDelta(turn=exchange.turn, delta=thought)
                if text := delta.get("content"):
                    reply.text += text
                    yield TextDelta(turn=exchange.turn, delta=text)
                for piece in delta.get("tool_calls") or []:
                    call = calls.setdefault(piece.get("index", 0), ToolCall())
                    function = piece.get("function") or {}
                    call.id = piece.get("id") or call.id
                    call.name = function.get("name") or call.name
                    call.arguments += function.get("arguments") or ""
    reply.calls = list(calls.values())


def _messages(exchange: Exchange) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": exchange.system}]
    for entry in exchange.entries:
        if isinstance(entry, ChatMessage):
            messages.append({"role": entry.role, "content": _content(entry)})
        elif isinstance(entry, Reply):
            messages.append(_assistant_message(entry))
        else:
            messages += [{"role": "tool", "tool_call_id": result.call.id, "content": result.text} for result in entry]
    return messages


def _content(message: ChatMessage) -> str | list[dict]:
    """A message's words, followed by its images as data URLs when it has any."""
    if not message.images:
        return message.text
    images = [{"type": "image_url", "image_url": {"url": f"data:{image.media_type};base64,{image.data}"}} for image in message.images]
    return [{"type": "text", "text": message.text}, *images]


def _assistant_message(reply: Reply) -> dict:
    message: dict[str, Any] = {"role": "assistant", "content": reply.text or None}
    # DeepSeek's thinking mode wants a turn's reasoning back while its tool calls run.
    if reply.thoughts:
        message["reasoning_content"] = reply.thoughts
    if reply.calls:
        message["tool_calls"] = [
            {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.arguments or "{}"}}
            for call in reply.calls
        ]
    return message
