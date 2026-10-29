"""Agent UI (.scratch/agent-chat-ui/issues/05, ADR 0031): the scoped server's show_ui tool, which
validates a spec of one of five kinds and gives it back normalized; the chat's tool part that carries it.
The tool through /mcp/agent as in test_agent_scope, then a turn on the fake provider of
test_agent_api_loop."""

import json

import pytest

from app.agent.events import MAX_SHOWN, ToolFinished, ToolStarted, shown
from app.agent.transcript_store import ToolPart, with_event

from test_agent_api_loop import (  # noqa: F401  (fixtures)
    agent_events,
    agent_url,
    answer,
    calls,
    chat,
    send,
    served,
    until_finished,
)
from test_agent_scope import call, job, refused, result, rpc, scope, token  # noqa: F401  (fixtures)
from conftest import wait_for
from test_jobs_api import create_job

CHOICES = {
    "kind": "choices",
    "title": "Which hook?",
    "options": [
        {"label": "Short", "prompt": "Use the short hook", "detail": "Four words"},
        {"label": "Long", "prompt": "Use the long hook", "detail": None},
    ],
}


@pytest.fixture
def served_job(served) -> dict:
    """test_agent_api_loop's `job`, on the served app: a Job in review with a Candidate and a DeepSeek key."""
    job = create_job(served)
    wait_for(served, job["id"], "review")
    assert served.post(f"/api/jobs/{job['id']}/candidates", json={"start": 0.1, "end": 1.6}).status_code == 201
    assert served.put("/api/agent/credentials/deepseek", json={"api_key": "sk-test"}).status_code == 200
    return served.get(f"/api/jobs/{job['id']}").json()


@pytest.mark.parametrize(
    ("spec", "normalized"),
    [
        (
            CHOICES,
            {
                "kind": "choices",
                "title": "Which hook?",
                "options": [{"label": "Short", "prompt": "Use the short hook", "detail": "Four words"}, {"label": "Long", "prompt": "Use the long hook"}],
            },
        ),
        ({"kind": "candidate", "note": "Hook moved up"}, {"kind": "candidate", "note": "Hook moved up"}),
        (
            {"kind": "table", "columns": ["Segment", "Length"], "rows": [["Intro", 3.5], ["Punchline", 2]]},
            {"kind": "table", "columns": ["Segment", "Length"], "rows": [["Intro", 3.5], ["Punchline", 2]]},
        ),
        ({"kind": "key_values", "title": None, "items": [{"label": "Length", "value": 42}]}, {"kind": "key_values", "items": [{"label": "Length", "value": 42}]}),
        (
            {"kind": "callout", "tone": "warning", "body": "The hook is **long**.", "checklist": [{"text": "Shorten it", "done": False}]},
            {"kind": "callout", "tone": "warning", "body": "The hook is **long**.", "checklist": [{"text": "Shorten it", "done": False}]},
        ),
    ],
)
def test_each_kind_is_validated_and_given_back_normalized(client, scope, token, spec, normalized):
    assert result(call(client, token, "show_ui", spec=spec)) == normalized


@pytest.mark.parametrize(
    ("spec", "named"),
    [
        ({"kind": "choices", "options": [{"label": "Only", "prompt": "Only"}]}, "options"),
        ({"kind": "choices", "options": [{"label": "x" * 81, "prompt": "a"}, {"label": "b", "prompt": "b"}]}, "label"),
        ({"kind": "table", "columns": ["A", "B"], "rows": [["one"]]}, "rows[0]"),
        ({"kind": "callout", "tone": "loud", "body": "Hi"}, "tone"),
        ({"kind": "chart"}, "kind"),
        ({"kind": "candidate", "title": "Not drawn"}, "title"),
    ],
)
def test_a_bad_spec_is_a_tool_error_naming_the_field(client, token, spec, named):
    assert named in refused(call(client, token, "show_ui", spec=spec))


def test_show_ui_is_on_the_scoped_server_only(client, token):
    scoped = {tool["name"] for tool in rpc(client, "tools/list", {}, token)["result"]["tools"]}
    assert "show_ui" in scoped

    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "Host": "127.0.0.1:8000"}
    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}, headers=headers)
    [data] = [line.removeprefix("data: ") for line in response.text.splitlines() if line.startswith("data: ")]
    assert "show_ui" not in {tool["name"] for tool in json.loads(data)["result"]["tools"]}


@pytest.mark.parametrize("tool", ["show_ui", "mcp__ai-clipper__show_ui"])
def test_with_event_fills_the_ui_of_a_finished_show_ui_call(tool):
    spec = json.dumps({"kind": "candidate", "note": "Done"})
    parts = with_event([], ToolStarted(turn="t", call="c", tool=tool, summary="", input=spec))

    [part] = with_event(parts, ToolFinished(turn="t", call="c", ok=True, output=spec))

    assert isinstance(part, ToolPart) and part.ui == {"kind": "candidate", "note": "Done"}


@pytest.mark.parametrize(
    ("tool", "finished"),
    [
        ("get_candidate", ToolFinished(turn="t", call="c", ok=True, output='{"kind": "candidate"}')),
        ("show_ui", ToolFinished(turn="t", call="c", ok=False, error="bad spec")),
        ("show_ui", ToolFinished(turn="t", call="c", ok=True, output="not a spec")),
    ],
)
def test_another_call_a_failed_one_or_an_output_that_isnt_a_spec_has_no_ui(tool, finished):
    parts = with_event([], ToolStarted(turn="t", call="c", tool=tool, summary=""))

    [part] = with_event(parts, finished)

    assert part.ui is None


def test_a_show_ui_output_is_never_cut():
    long = "x" * (MAX_SHOWN + 10)
    assert shown(long, "mcp__ai-clipper__show_ui") == long
    assert shown(long, "get_candidate") == long[:MAX_SHOWN] + "…"


def test_a_live_tool_finished_and_the_kept_turn_carry_the_ui(served, chat, served_job):
    candidate = served_job["candidates"][0]
    chat.replies = [calls(("show_ui", {"spec": CHOICES})), answer("Pick one.")]
    stream = agent_events(served, served_job, candidate)
    next(stream)

    send(served, served_job, candidate, "Offer two hooks")
    received = dict(until_finished(stream))

    expected = {"kind": "choices", "title": "Which hook?", "options": [CHOICES["options"][0], {"label": "Long", "prompt": "Use the long hook"}]}
    assert received["tool_finished"]["ui"] == expected
    [kept] = served.get(f"{agent_url(served_job, candidate)}/transcript").json()
    [tool, _] = kept["parts"]
    assert tool["ui"] == expected
