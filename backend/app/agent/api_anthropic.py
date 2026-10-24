"""The API tool loop's Anthropic Messages adapter, through the `anthropic` SDK (whose HTTP library is
httpx2: a TurnContext's transport for it must be one of httpx2's)."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anthropic
from anthropic import AsyncAnthropic, DefaultAsyncHttpxClient
from mcp_types import Tool

from app.agent.api_loop import Exchange, ProviderFailed, Reply, Step, ToolCall, api_driver
from app.agent.driver import ChatMessage, TurnContext
from app.agent.events import AgentEvent, TextDelta, ThoughtDelta

# Streamed, so a long reply doesn't meet a request timeout.
MAX_TOKENS = 64_000
# Its thinking is shown as the turn's thoughts: summarized, since the default leaves it empty.
THINKING = {"type": "adaptive", "display": "summarized"}
CACHED = {"type": "ephemeral"}
# Replies whose tool calls may be cut short: none of them is run.
UNFINISHED = ("max_tokens", "refusal")


@asynccontextmanager
async def anthropic_adapter(context: TurnContext) -> AsyncIterator[Step]:
    http = DefaultAsyncHttpxClient(transport=context.http_transport) if context.http_transport else None
    client = AsyncAnthropic(
        api_key=context.credential.api_key,
        base_url=context.credential.base_url or context.provider.base_url,
        http_client=http,
    )
    async with client:

        async def step(exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
            try:
                async for event in _stream_reply(client, exchange, reply):
                    yield event
            except anthropic.APIStatusError as error:
                raise ProviderFailed(f"{context.provider.label} answered {error.status_code}: {error.message}") from error

        yield step


run_anthropic_turn = api_driver(anthropic_adapter)


def anthropic_tools(tools: list[Tool]) -> list[dict]:
    """The MCP tools as Messages `tools`, a cache breakpoint on the last: they come first in the prompt."""
    declared = [{"name": tool.name, "description": tool.description or "", "input_schema": tool.input_schema} for tool in tools]
    if declared:
        declared[-1]["cache_control"] = CACHED
    return declared


async def _stream_reply(client: AsyncAnthropic, exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
    async with client.messages.stream(
        model=exchange.model,
        max_tokens=MAX_TOKENS,
        thinking=THINKING,
        system=[{"type": "text", "text": exchange.system, "cache_control": CACHED}],
        tools=anthropic_tools(exchange.tools),
        messages=_messages(exchange),
    ) as stream:
        async for event in stream:
            if event.type != "content_block_delta":
                continue
            if event.delta.type == "thinking_delta" and event.delta.thinking:
                reply.thoughts += event.delta.thinking
                yield ThoughtDelta(turn=exchange.turn, delta=event.delta.thinking)
            elif event.delta.type == "text_delta" and event.delta.text:
                reply.text += event.delta.text
                yield TextDelta(turn=exchange.turn, delta=event.delta.text)
        message = await stream.get_final_message()
    reply.native = message.content
    if message.stop_reason in UNFINISHED:
        return
    reply.calls = [
        ToolCall(id=block.id, name=block.name, arguments=json.dumps(block.input))
        for block in message.content
        if block.type == "tool_use"
    ]


def _messages(exchange: Exchange) -> list[dict]:
    messages: list[dict] = []
    for entry in exchange.entries:
        if isinstance(entry, ChatMessage):
            messages.append({"role": entry.role, "content": entry.text})
        elif isinstance(entry, Reply):
            # Its thinking blocks go back as they came, signatures and all.
            messages.append({"role": "assistant", "content": entry.native})
        else:
            results = [
                {"type": "tool_result", "tool_use_id": result.call.id, "content": result.text, "is_error": not result.ok}
                for result in entry
            ]
            messages.append({"role": "user", "content": results})
    return messages
