"""The API tool loop's Gemini adapter, through the `google-genai` SDK app/llm.py uses too, with the MCP
tools declared as functions."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from google import genai
from google.genai import errors, types
from mcp_types import Tool

from app.agent.api_loop import HTTP_TIMEOUT, Exchange, ProviderFailed, Reply, Step, ToolCall, ToolResult, api_driver
from app.agent.driver import ChatMessage, TurnContext
from app.agent.events import AgentEvent, TextDelta, ThoughtDelta

# What Gemini's function declarations refuse in a JSON schema: references are inlined instead.
REFUSED_KEYWORDS = frozenset({"additionalProperties", "$defs", "definitions", "$schema", "$id", "$comment"})
# google-genai's timeout is in milliseconds.
TIMEOUT_MS = int(HTTP_TIMEOUT.read * 1000)


@asynccontextmanager
async def gemini_adapter(context: TurnContext) -> AsyncIterator[Step]:
    async with httpx.AsyncClient(transport=context.http_transport, timeout=HTTP_TIMEOUT) as http:
        options = types.HttpOptions(base_url=context.credential.base_url, timeout=TIMEOUT_MS, httpx_async_client=http)
        client = genai.Client(api_key=context.credential.api_key, http_options=options)

        async def step(exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
            try:
                async for event in _stream_reply(client, exchange, reply):
                    yield event
            except errors.APIError as error:
                raise ProviderFailed(f"{context.provider.label} answered {error.code}: {error.message}") from error

        yield step


run_gemini_turn = api_driver(gemini_adapter)


def gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """`schema` without the keywords Gemini refuses, each `$ref` to its definitions replaced by the
    definition; a definition that refers to itself is left an open object the second time."""
    definitions = {**schema.get("definitions", {}), **schema.get("$defs", {})}

    def clean(node: Any, inlined: frozenset[str]) -> Any:
        if isinstance(node, list):
            return [clean(item, inlined) for item in node]
        if not isinstance(node, dict):
            return node
        if isinstance(ref := node.get("$ref"), str):
            name = ref.rsplit("/", 1)[-1]
            if name in inlined or name not in definitions:
                return {"type": "object"}
            beside = {key: value for key, value in node.items() if key != "$ref"}
            return clean(definitions[name] | beside, inlined | {name})
        return {
            key: {name: clean(value, inlined) for name, value in node[key].items()} if key == "properties" else clean(value, inlined)
            for key, value in node.items()
            if key not in REFUSED_KEYWORDS
        }

    return clean(schema, frozenset())


def gemini_tools(tools: list[Tool]) -> list[types.Tool]:
    declarations = [
        types.FunctionDeclaration(name=tool.name, description=tool.description or "", parameters_json_schema=gemini_schema(tool.input_schema))
        for tool in tools
    ]
    return [types.Tool(function_declarations=declarations)] if declarations else []


async def _stream_reply(client: genai.Client, exchange: Exchange, reply: Reply) -> AsyncIterator[AgentEvent]:
    config = types.GenerateContentConfig(
        system_instruction=exchange.system,
        tools=gemini_tools(exchange.tools),
        thinking_config=types.ThinkingConfig(include_thoughts=True),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    # Every part streamed, its thought signatures with it, goes back as the model's turn.
    parts: list[types.Part] = []
    stream = await client.aio.models.generate_content_stream(model=exchange.model, contents=_contents(exchange), config=config)
    async for chunk in stream:
        content = chunk.candidates[0].content if chunk.candidates else None
        for part in (content.parts if content else None) or []:
            parts.append(part)
            if part.text and part.thought:
                reply.thoughts += part.text
                yield ThoughtDelta(turn=exchange.turn, delta=part.text)
            elif part.text:
                reply.text += part.text
                yield TextDelta(turn=exchange.turn, delta=part.text)
            if (call := part.function_call) is not None:
                # Gemini names a call only sometimes; the turn's events need a name for each.
                name = call.id or f"call-{len(reply.calls)}"
                reply.calls.append(ToolCall(id=name, name=call.name or "", arguments=json.dumps(call.args or {})))
    reply.native = types.Content(role="model", parts=parts)


def _contents(exchange: Exchange) -> list[types.Content]:
    contents: list[types.Content] = []
    # The ids Gemini gave the last reply's calls: a result answers with its call's id only then.
    named: set[str] = set()
    for entry in exchange.entries:
        if isinstance(entry, ChatMessage):
            role = "user" if entry.role == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part(text=entry.text)]))
        elif isinstance(entry, Reply):
            contents.append(entry.native)
            named = {part.function_call.id for part in entry.native.parts or [] if part.function_call and part.function_call.id}
        else:
            contents.append(types.Content(role="user", parts=[_response(result, named) for result in entry]))
    return contents


def _response(result: ToolResult, named: set[str]) -> types.Part:
    """A call's result as a function response; the answer to a failed call is its error."""
    said = {"output": result.text} if result.ok else {"error": result.text}
    call_id = result.call.id if result.call.id in named else None
    return types.Part(function_response=types.FunctionResponse(id=call_id, name=result.call.name, response=said))
