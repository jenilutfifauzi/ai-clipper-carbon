"""The API tool loop (.scratch/agent-mode/issues/03): an Agent Turn sent to an OpenAI-compatible
provider, whose tool calls edit the Candidate through the scoped MCP server. The provider is a fake
Chat Completions server scripted reply by reply; the app is served by uvicorn, so that the turn's
events can be read from its SSE stream as the editor reads them."""

import asyncio
import json
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field

import httpx
import pytest
import uvicorn

from app.main import create_app
from app.ports import Ports
from conftest import wait_for
from test_events import events
from test_jobs_api import create_job

# A reply the fake holds back until the turn is cancelled.
HOLD = "hold"
# A reply refused as an API with a wrong key refuses it.
FAIL = "fail"


@dataclass
class ScriptedChat:
    """A Chat Completions server answering each request with the next of `replies` (lists of stream
    chunks), and keeping the requests' bodies and headers."""

    replies: list = field(default_factory=list)
    requests: list[dict] = field(default_factory=list)
    headers: list[httpx.Headers] = field(default_factory=list)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        self.headers.append(request.headers)
        reply = self.replies.pop(0)
        if reply == HOLD:
            await asyncio.sleep(30)
        if reply == FAIL:
            return httpx.Response(401, json={"error": {"message": "Authentication Fails"}})
        body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in reply) + "data: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


def chunk(delta: dict, finish: str | None = None) -> dict:
    return {"id": "c", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


def answer(*texts: str, reasoning: str | None = None) -> list[dict]:
    """A reply of text (a chunk per piece), after DeepSeek's reasoning when given."""
    thought = [chunk({"role": "assistant", "reasoning_content": reasoning})] if reasoning else []
    return [*thought, *(chunk({"content": text}) for text in texts), chunk({}, "stop")]


def calls(*called: tuple[str, dict]) -> list[dict]:
    """A reply calling tools, each call's arguments streamed in two pieces."""
    chunks = []
    for index, (name, arguments) in enumerate(called):
        text = json.dumps(arguments)
        half = len(text) // 2
        chunks.append(chunk({"tool_calls": [{"index": index, "id": f"call-{index}", "type": "function", "function": {"name": name, "arguments": text[:half]}}]}))
        chunks.append(chunk({"tool_calls": [{"index": index, "function": {"arguments": text[half:]}}]}))
    return [*chunks, chunk({}, "tool_calls")]


@pytest.fixture
def chat() -> ScriptedChat:
    return ScriptedChat()


@pytest.fixture
def served(settings, video_source, transcriber, llm, chat) -> Iterator[httpx.Client]:
    """A client of the app served by uvicorn in a thread, its Agent's providers reached through `chat`."""
    app = create_app(settings, Ports(video_source, transcriber, llm, agent_transport=chat.transport))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started:
        assert time.monotonic() < deadline, "uvicorn didn't start"
        time.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10) as client:
            yield client
    finally:
        video_source.release()
        server.should_exit = True
        thread.join(5)


@pytest.fixture
def job(served) -> dict:
    """A Job in review with two manual Candidates, and a DeepSeek key saved."""
    job = create_job(served)
    wait_for(served, job["id"], "review")
    for _ in range(2):
        assert served.post(f"/api/jobs/{job['id']}/candidates", json={"start": 0.1, "end": 1.6}).status_code == 201
    assert served.put("/api/agent/credentials/deepseek", json={"api_key": "sk-test"}).status_code == 200
    return served.get(f"/api/jobs/{job['id']}").json()


def agent_url(job: dict, candidate: dict) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}/agent"


def agent_events(client: httpx.Client, job: dict, candidate: dict) -> Iterator[tuple[str, dict]]:
    with client.stream("GET", f"{agent_url(job, candidate)}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        yield from events(response.iter_lines())


def until_finished(stream: Iterator[tuple[str, dict]]) -> list[tuple[str, dict]]:
    received = []
    for name, data in stream:
        received.append((name, data))
        if name == "turn_finished":
            return received
    raise AssertionError(f"the stream ended before the turn: {received}")


def send(client: httpx.Client, job: dict, candidate: dict, prompt: str, tab: str = "tab-a") -> httpx.Response:
    return client.post(f"{agent_url(job, candidate)}/turns", json={"provider": "deepseek", "prompt": prompt, "tab": tab})


def test_a_turn_streams_its_tool_call_and_answer_and_its_revisions_name_it(served, chat, job):
    candidate = job["candidates"][0]
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    chat.replies = [calls(("edit_candidate", ids | {"changes": {"hook_text": "Agent hook"}})), answer("Done.")]
    stream = agent_events(served, job, candidate)
    assert next(stream)[0] == "ready"

    sent = send(served, job, candidate, "Set the hook")

    assert sent.status_code == 202, sent.text
    turn = sent.json()["turn"]
    received = until_finished(stream)
    assert [name for name, _ in received] == ["turn_started", "tool_started", "tool_finished", "text", "turn_finished"]
    started, tool_started, tool_finished, text, finished = (data for _, data in received)
    assert started == {"type": "turn_started", "turn": turn, "tab": "tab-a", "provider": "deepseek", "model": "deepseek-chat", "prompt": "Set the hook"}
    # The card's input is the arguments as the model wrote them, its output the result's text.
    arguments = json.dumps(ids | {"changes": {"hook_text": "Agent hook"}})
    assert tool_started == {"type": "tool_started", "turn": turn, "call": "call-0", "tool": "edit_candidate", "summary": "sets hook_text", "input": arguments}
    saved = served.get(f"/api/jobs/{job['id']}").json()["candidates"][0]
    assert saved["hook_text"] == "Agent hook"
    output = tool_finished.pop("output")
    assert "Agent hook" in output
    assert tool_finished == {"type": "tool_finished", "turn": turn, "call": "call-0", "ok": True, "error": None, "revision": saved["revision"], "input": None}
    assert text == {"type": "text", "turn": turn, "delta": "Done."}
    assert finished == {
        "type": "turn_finished", "turn": turn, "stop": "end_turn",
        "first_revision": saved["revision"], "last_revision": saved["revision"],
    }
    [newest, *_] = served.get(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/revisions").json()["revisions"]
    assert (newest["revision"], newest["source"], newest["tab"]) == (saved["revision"], "agent", f"agent:{turn}")


def test_the_model_is_called_with_the_key_the_system_prompt_and_the_scoped_tools(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Hello.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Hi")
    until_finished(stream)

    [request] = chat.requests
    assert chat.headers[0]["authorization"] == "Bearer sk-test"
    assert (request["model"], request["stream"]) == ("deepseek-chat", True)
    system, user = request["messages"]
    assert system["role"] == "system"
    assert candidate["id"] in system["content"] and job["id"] in system["content"]
    assert "Text Layers: 0" in system["content"]
    assert user == {"role": "user", "content": "Hi"}
    names = {tool["function"]["name"] for tool in request["tools"]}
    assert "edit_candidate" in names and "delete_job" not in names


def test_a_call_on_another_candidate_is_refused_and_the_refusal_fed_back(served, chat, job):
    candidate, other = job["candidates"]
    theirs = {"job_id": job["id"], "candidate_id": other["id"], "changes": {"hook_text": "Theirs"}}
    chat.replies = [calls(("edit_candidate", theirs)), answer("I can't.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Edit the other one")
    received = dict(until_finished(stream))

    assert received["tool_finished"]["ok"] is False
    assert "Candidate" in received["tool_finished"]["error"]
    assert received["tool_finished"]["revision"] is None
    assert (received["turn_finished"]["first_revision"], received["turn_finished"]["last_revision"]) == (None, None)
    fed_back = chat.requests[1]["messages"][-1]
    assert fed_back["role"] == "tool" and fed_back["tool_call_id"] == "call-0"
    assert "Refused" in fed_back["content"]
    assert served.get(f"/api/jobs/{job['id']}").json()["candidates"] == job["candidates"]


def test_reasoning_becomes_thoughts(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Hi ", "there.", reasoning="The owner greets me.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Hi")
    received = until_finished(stream)

    assert [(name, data.get("delta")) for name, data in received[1:-1]] == [
        ("thought", "The owner greets me."), ("text", "Hi "), ("text", "there."),
    ]


def test_a_turn_stops_after_thirty_steps(served, chat, job):
    candidate = job["candidates"][0]
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    chat.replies = [calls(("get_candidate", ids)) for _ in range(30)]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Loop forever")
    received = until_finished(stream)

    assert received[-1][1]["stop"] == "step_limit"
    assert len(chat.requests) == 30
    assert [name for name, _ in received].count("tool_finished") == 30


def test_a_long_tool_result_is_trimmed_with_a_note_and_its_card_shows_4096_characters(served, chat, job):
    candidate = job["candidates"][0]
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    layers = [{"id": f"t{i}", "text": "A long title " * 8, "start": 0, "secs": 1} for i in range(40)]
    assert served.patch(url, json={"revision": candidate["revision"], "text_layers": layers}).status_code == 200
    chat.replies = [calls(("get_candidate", {"job_id": job["id"], "candidate_id": candidate["id"]})), answer("Read it.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Read the Candidate")
    received = dict(until_finished(stream))

    fed_back = chat.requests[1]["messages"][-1]["content"]
    assert len(fed_back.encode()) <= 12_000 + 200
    assert "trimmed" in fed_back
    output = received["tool_finished"]["output"]
    assert len(output) == 4096 + 1 and output.endswith("…")
    assert fed_back.startswith(output[:-1])
