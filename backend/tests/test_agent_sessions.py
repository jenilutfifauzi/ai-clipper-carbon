"""Agent Sessions (.scratch/agent-mode/issues/03): one turn at a time per tab, Stop, the chat kept
with the Job, and the providers a turn can't be sent to. On the fake provider of test_agent_api_loop."""

import json
import time

from app.agent.transcript_store import load_transcript, transcript_path

from test_agent_api_loop import (  # noqa: F401  (fixtures)
    FAIL,
    HOLD,
    agent_events,
    agent_url,
    answer,
    calls,
    chat,
    job,
    send,
    served,
    until_finished,
)


def wait_for_requests(chat, count: int, timeout: float = 5) -> None:
    deadline = time.monotonic() + timeout
    while len(chat.requests) < count:
        assert time.monotonic() < deadline, "the provider wasn't called"
        time.sleep(0.01)


def test_stop_ends_the_turn_as_cancelled_and_keeps_it(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [HOLD]
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Take your time").json()["turn"]
    wait_for_requests(chat, 1)

    assert served.post(f"{agent_url(job, candidate)}/cancel", json={"tab": "tab-a"}).status_code == 204

    name, finished = until_finished(stream)[-1]
    assert finished == {"type": "turn_finished", "turn": turn, "stop": "cancelled", "first_revision": None, "last_revision": None}
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    assert (kept["id"], kept["stop"]) == (turn, "cancelled")


def test_a_second_send_while_a_turn_runs_is_refused_but_another_tab_may_send(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [HOLD, answer("Other tab.")]
    stream = agent_events(served, job, candidate)
    assert next(stream) == ("ready", {"running": {}})
    first = send(served, job, candidate, "First").json()["turn"]
    wait_for_requests(chat, 1)

    again = send(served, job, candidate, "Second")
    other = send(served, job, candidate, "From another tab", tab="tab-b")

    assert again.status_code == 409
    assert other.status_code == 202
    served.post(f"{agent_url(job, candidate)}/cancel", json={"tab": "tab-a"})
    finished = [data for name, data in stream_until_both(stream) if name == "turn_finished"]
    assert {(data["turn"], data["stop"]) for data in finished} == {(first, "cancelled"), (other.json()["turn"], "end_turn")}
    # Once it has ended, the tab may send again.
    chat.replies = [answer("Again.")]
    assert send(served, job, candidate, "Second").status_code == 202


def stream_until_both(stream) -> list[tuple[str, dict]]:
    received = until_finished(stream)
    return received + (until_finished(stream) if [name for name, _ in received].count("turn_finished") < 2 else [])


def test_the_chat_is_kept_and_sent_back_as_history(served, chat, job):
    candidate = job["candidates"][0]
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    chat.replies = [calls(("edit_candidate", ids | {"changes": {"hook_text": "Agent hook"}})), answer("Set ", "it.", reasoning="Easy.")]
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Set the hook").json()["turn"]
    finished = until_finished(stream)[-1][1]

    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()

    assert {key: kept[key] for key in ("id", "provider", "model", "prompt", "stop", "first_revision", "last_revision")} == {
        "id": turn, "provider": "deepseek", "model": "deepseek-chat", "prompt": "Set the hook", "stop": "end_turn",
        "first_revision": finished["first_revision"], "last_revision": finished["last_revision"],
    }
    tool = kept["parts"][0]
    assert json.loads(tool.pop("input")) == ids | {"changes": {"hook_text": "Agent hook"}}
    assert "Agent hook" in tool.pop("output")
    assert kept["parts"] == [
        {"type": "tool", "call": "call-0", "tool": "edit_candidate", "summary": "sets hook_text", "ok": True, "error": None,
         "revision": finished["last_revision"]},
        {"type": "thought", "text": "Easy."},
        {"type": "text", "text": "Set it."},
    ]
    assert kept["started_at"]

    chat.replies = [answer("Sure.")]
    send(served, job, candidate, "And now?")
    until_finished(stream)

    messages = chat.requests[-1]["messages"]
    assert messages[1:] == [
        {"role": "user", "content": "Set the hook"},
        {"role": "assistant", "content": "Set it."},
        {"role": "user", "content": "And now?"},
    ]


def test_a_provider_without_a_key_or_one_that_isnt_installed_is_refused_clearly(served, job, tmp_path, monkeypatch):
    candidate = job["candidates"][0]
    url = f"{agent_url(job, candidate)}/turns"

    no_key = served.post(url, json={"provider": "anthropic", "prompt": "Hi", "tab": "tab-a"})
    # An ACP agent that isn't installed; ones that are are test_agent_acp's.
    empty = tmp_path / "empty-bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    monkeypatch.setenv("HOME", str(tmp_path))
    acp = served.post(url, json={"provider": "gemini-cli", "prompt": "Hi", "tab": "tab-a"})
    unknown = served.post(url, json={"provider": "nope", "prompt": "Hi", "tab": "tab-a"})
    missing = served.post(f"/api/jobs/{job['id']}/candidates/nope/agent/turns", json={"provider": "deepseek", "prompt": "Hi", "tab": "t"})

    assert no_key.status_code == 400 and "no key" in no_key.json()["detail"]
    assert acp.status_code == 400 and "isn't installed" in acp.json()["detail"]
    assert unknown.status_code == 404
    assert missing.status_code == 404


def test_a_provider_error_ends_the_turn_with_an_error_event(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [FAIL]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Hi")
    received = until_finished(stream)

    assert [name for name, _ in received] == ["turn_started", "error", "turn_finished"]
    assert "401" in received[1][1]["message"]
    assert received[-1][1]["stop"] == "error"


def test_a_transcript_from_before_tool_cards_still_loads(tmp_path):
    turn = {
        "id": "t1", "provider": "deepseek", "model": None, "prompt": "Hi", "stop": "end_turn", "started_at": "2026-01-01T00:00:00Z",
        "parts": [{"type": "tool", "call": "c1", "tool": "get_candidate", "summary": "", "ok": True, "error": None, "revision": None}],
    }
    path = transcript_path(tmp_path, "cand")
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps([turn]))

    [loaded] = load_transcript(tmp_path, "cand")

    [tool] = loaded.parts
    assert (tool.input, tool.output, tool.ok) == (None, None, True)
