"""The API tool loop's adapters (.scratch/agent-mode/issues/07): one Agent Turn, scripted reply by
reply, run through the Chat Completions, Anthropic Messages and Gemini adapters alike. Each fake
answers as its API streams, through the transport its SDK sends on (httpx2 for `anthropic`, httpx
otherwise); the scoped MCP server is a fake holding one tool, so that only the adapter is under test."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace

import httpx
import httpx2
import pytest
from mcp_types import CallToolResult, ListToolsResult, TextContent, Tool

from app.agent.api_gemini import gemini_schema
from app.agent.credentials import Credential, SavedCredential, credential_for, save_credential
from app.agent.driver import ChatMessage, TurnContext
from app.agent.providers import provider_by_id
from app.agent.sessions import driver_for

HOOK = {"changes": {"hook_text": "Agent hook"}}
# What a pydantic model's schema looks like to an MCP client: a $ref into $defs, and closed objects.
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"changes": {"$ref": "#/$defs/Changes"}},
    "required": ["changes"],
    "$defs": {
        "Changes": {
            "type": "object",
            "additionalProperties": False,
            "properties": {"hook_text": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None}},
        }
    },
}


@dataclass
class FakeMcp:
    calls: list[tuple[str, dict]] = field(default_factory=list)

    async def list_tools(self) -> ListToolsResult:
        return ListToolsResult(tools=[Tool(name="edit_candidate", description="Edit the Candidate", input_schema=SCHEMA)])

    async def call_tool(self, name: str, arguments: dict) -> CallToolResult:
        self.calls.append((name, arguments))
        return CallToolResult(content=[TextContent(type="text", text="Saved Revision 2")], is_error=False)


@dataclass
class FakeEndpoint:
    mcp: FakeMcp = field(default_factory=FakeMcp)

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[FakeMcp]:
        yield self.mcp


@dataclass
class Scripted:
    """An API answering each request with the next of `replies` (each the body of a stream), and
    keeping the requests' bodies and headers."""

    replies: list[str]
    requests: list[dict] = field(default_factory=list)
    headers: list = field(default_factory=list)

    def answer(self, body: bytes, headers) -> str:
        self.requests.append(json.loads(body))
        self.headers.append(headers)
        return self.replies.pop(0)

    def httpx(self) -> httpx.MockTransport:
        async def handle(request: httpx.Request) -> httpx.Response:
            body = self.answer(request.content, request.headers)
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

        return httpx.MockTransport(handle)

    def httpx2(self) -> httpx2.MockTransport:
        async def handle(request: httpx2.Request) -> httpx2.Response:
            body = self.answer(request.content, request.headers)
            return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

        return httpx2.MockTransport(handle)


def data(*chunks: dict) -> str:
    return "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)


# Chat Completions (DeepSeek): reasoning_content is its thinking.
def chat_chunk(delta: dict, finish: str | None = None) -> dict:
    return {"id": "c", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


CHAT_REPLIES = [
    data(
        chat_chunk({"role": "assistant", "reasoning_content": "Plan."}),
        chat_chunk({"tool_calls": [{"index": 0, "id": "call-0", "type": "function", "function": {"name": "edit_candidate", "arguments": json.dumps(HOOK)}}]}),
        chat_chunk({}, "tool_calls"),
    ) + "data: [DONE]\n\n",
    data(chat_chunk({"content": "Done."}), chat_chunk({}, "stop")) + "data: [DONE]\n\n",
]


# Anthropic Messages: named server-sent events.
def events(*named: dict) -> str:
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in named)


def message(*blocks: list[dict], stop: str) -> str:
    start = {
        "type": "message_start",
        "message": {
            "id": "msg", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5", "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1},
        },
    }
    end = [
        {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 5}},
        {"type": "message_stop"},
    ]
    return events(start, *(event for block in blocks for event in block), *end)


def block(index: int, start: dict, *deltas: dict) -> list[dict]:
    return [
        {"type": "content_block_start", "index": index, "content_block": start},
        *({"type": "content_block_delta", "index": index, "delta": delta} for delta in deltas),
        {"type": "content_block_stop", "index": index},
    ]


ANTHROPIC_REPLIES = [
    message(
        block(0, {"type": "thinking", "thinking": "", "signature": ""},
              {"type": "thinking_delta", "thinking": "Plan."}, {"type": "signature_delta", "signature": "sig-1"}),
        block(1, {"type": "tool_use", "id": "call-0", "name": "edit_candidate", "input": {}},
              {"type": "input_json_delta", "partial_json": json.dumps(HOOK)[:10]},
              {"type": "input_json_delta", "partial_json": json.dumps(HOOK)[10:]}),
        stop="tool_use",
    ),
    message(block(0, {"type": "text", "text": ""}, {"type": "text_delta", "text": "Done."}), stop="end_turn"),
]


# Gemini: thoughts are parts marked `thought`, and a call carries the signature to send back.
def gemini_chunk(*parts: dict, finish: str | None = None) -> dict:
    candidate = {"content": {"role": "model", "parts": list(parts)}, "index": 0}
    return {"candidates": [candidate | ({"finishReason": finish} if finish else {})]}


GEMINI_REPLIES = [
    data(
        gemini_chunk({"text": "Plan.", "thought": True}),
        gemini_chunk({"functionCall": {"id": "call-0", "name": "edit_candidate", "args": HOOK}, "thoughtSignature": "c2lnLTE="}, finish="STOP"),
    ),
    data(gemini_chunk({"text": "Done."}, finish="STOP")),
]

SCRIPTS = {
    "deepseek": (CHAT_REPLIES, Scripted.httpx),
    "anthropic": (ANTHROPIC_REPLIES, Scripted.httpx2),
    "gemini": (GEMINI_REPLIES, Scripted.httpx),
}


def run_turn(provider_id: str, api: Scripted, endpoint: FakeEndpoint, transport, model: str | None = None) -> list[dict]:
    provider = provider_by_id(provider_id)
    context = TurnContext(
        turn="t1",
        provider=provider,
        model=model or provider.default_model,
        credential=Credential(api_key="sk-test", source="saved"),
        system="You edit one Candidate.",
        history=[ChatMessage(role="user", text="Hi"), ChatMessage(role="assistant", text="Hello.")],
        prompt="Set the hook",
        tools=endpoint,
        http_transport=transport,
    )

    async def collect() -> list[dict]:
        return [event.model_dump() async for event in driver_for(provider)(context)]

    return asyncio.run(collect())


@pytest.fixture(params=list(SCRIPTS))
def turn(request) -> tuple[str, Scripted, FakeEndpoint, list[dict]]:
    replies, transport = SCRIPTS[request.param]
    api = Scripted(list(replies))
    endpoint = FakeEndpoint()
    return request.param, api, endpoint, run_turn(request.param, api, endpoint, transport(api))


def test_every_adapter_yields_the_same_turn(turn):
    _, api, endpoint, received = turn

    # Each API spells the arguments its own way; they are the same JSON.
    assert json.loads(received[1].pop("input")) == HOOK
    assert received == [
        {"type": "thought", "turn": "t1", "delta": "Plan."},
        {"type": "tool_started", "turn": "t1", "call": "call-0", "tool": "edit_candidate", "summary": "sets hook_text"},
        {"type": "tool_finished", "turn": "t1", "call": "call-0", "ok": True, "error": None, "revision": None,
         "output": "Saved Revision 2", "input": None},
        {"type": "text", "turn": "t1", "delta": "Done."},
        {"type": "turn_finished", "turn": "t1", "stop": "end_turn", "first_revision": None, "last_revision": None},
    ]
    assert endpoint.mcp.calls == [("edit_candidate", HOOK)]
    assert len(api.requests) == 2


def test_anthropic_is_called_with_its_key_cached_system_and_tools_and_thinking_sent_back():
    replies, _ = SCRIPTS["anthropic"]
    api = Scripted(list(replies))
    run_turn("anthropic", api, FakeEndpoint(), api.httpx2())

    first, second = api.requests
    assert api.headers[0]["authorization"] == "Bearer sk-test"
    assert (first["model"], first["stream"]) == ("claude-sonnet-5-5", True)
    assert first["thinking"]["type"] == "adaptive"
    assert first["system"] == [{"type": "text", "text": "You edit one Candidate.", "cache_control": {"type": "ephemeral"}}]
    [tool] = first["tools"]
    assert (tool["name"], tool["input_schema"], tool["cache_control"]) == ("edit_candidate", SCHEMA, {"type": "ephemeral"})
    assert first["messages"] == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello."},
        {"role": "user", "content": "Set the hook"},
    ]
    *_, asked, results = second["messages"]
    assert [part["type"] for part in asked["content"]] == ["thinking", "tool_use"]
    assert asked["content"][0]["signature"] == "sig-1"
    assert asked["content"][1]["input"] == HOOK
    assert results == {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "call-0", "content": "Saved Revision 2", "is_error": False}],
    }


def test_gemini_is_sent_clean_declarations_and_its_signed_call_back():
    replies, _ = SCRIPTS["gemini"]
    api = Scripted(list(replies))
    run_turn("gemini", api, FakeEndpoint(), api.httpx())

    first, second = api.requests
    assert api.headers[0]["x-goog-api-key"] == "sk-test"
    assert first["systemInstruction"]["parts"] == [{"text": "You edit one Candidate."}]
    [declaration] = first["tools"][0]["functionDeclarations"]
    assert declaration["name"] == "edit_candidate"
    # google-genai sends this one field in snake case, which the API takes.
    assert declaration["parameters_json_schema"] == gemini_schema(SCHEMA)
    assert [content["role"] for content in first["contents"]] == ["user", "model", "user"]
    *_, asked, results = second["contents"]
    assert asked["role"] == "model"
    assert any(part.get("thoughtSignature") == "c2lnLTE=" for part in asked["parts"])
    [answer] = results["parts"]
    assert answer["functionResponse"]["name"] == "edit_candidate"
    assert answer["functionResponse"]["response"] == {"output": "Saved Revision 2"}


def test_a_gemini_schema_loses_what_gemini_refuses_and_keeps_its_meaning():
    assert gemini_schema(SCHEMA) == {
        "type": "object",
        "properties": {
            "changes": {
                "type": "object",
                "properties": {"hook_text": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None}},
            }
        },
        "required": ["changes"],
    }


def test_gemini_runs_the_gemini_model_the_app_is_set_to(settings):
    settings = replace(settings, gemini_api_key="g-key", gemini_model="gemini-custom")

    from_env = credential_for(settings, "gemini")
    save_credential(settings, "gemini", SavedCredential(api_key="saved-key"))
    saved = credential_for(settings, "gemini")
    save_credential(settings, "gemini", SavedCredential(model="gemini-chosen"))
    chosen = credential_for(settings, "gemini")

    assert (from_env.model, saved.model, chosen.model) == ("gemini-custom", "gemini-custom", "gemini-chosen")


def test_anthropic_defaults_to_sonnet_and_lists_opus_and_haiku():
    anthropic = provider_by_id("anthropic")

    assert anthropic.default_model == "claude-sonnet-5-5"
    assert set(anthropic.models) == {"claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"}
