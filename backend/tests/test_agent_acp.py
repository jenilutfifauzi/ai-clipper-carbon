"""ACP agents (.scratch/agent-mode/issues/05): Claude Code and Codex run as subprocesses speaking the
Agent Client Protocol. Here both are the fake agent of fake_acp_agent.py, found on PATH under their
adapters' names, scripted turn by turn; what it receives is read back from its log."""

import json
import os
import sys
import time
from pathlib import Path

import pytest

from test_agent_api_loop import agent_events, agent_url, chat, job, served, until_finished  # noqa: F401  (fixtures)

FAKE_AGENT = Path(__file__).with_name("fake_acp_agent.py")


class FakeAgent:
    def __init__(self, folder: Path) -> None:
        self.log = folder / "received.jsonl"
        self.script = folder / "script.json"
        self.log.touch()
        self.turns([])

    def turns(self, turns: list[list[dict]]) -> None:
        self.script.write_text(json.dumps(turns))

    def received(self, method: str | None = None) -> list[dict]:
        messages = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [message for message in messages if method is None or message.get("method") == method]

    def wait_for(self, method: str, count: int = 1, timeout: float = 5) -> list[dict]:
        deadline = time.monotonic() + timeout
        while len(found := self.received(method)) < count:
            assert time.monotonic() < deadline, f"the agent didn't receive {method}: {self.received()}"
            time.sleep(0.01)
        return found


@pytest.fixture
def fake_agent(tmp_path, monkeypatch) -> FakeAgent:
    """The fake agent as `claude-agent-acp`, `codex-acp`, `gemini` (whose help lists `--acp`) and
    `agy_acp_server`, the only commands on PATH."""
    folder = tmp_path / "fake-acp"
    folder.mkdir()
    bin_dir = folder / "bin"
    bin_dir.mkdir()
    for name in ("claude-agent-acp", "codex-acp", "gemini", "agy_acp_server"):
        launcher = bin_dir / name
        launcher.write_text(
            "#!/bin/sh\n"
            'case "$1" in --help) echo "  --acp  Starts the agent in ACP mode"; exit 0;; --version) echo 1.0.0; exit 0;; esac\n'
            f'exec "{sys.executable}" "{FAKE_AGENT}" "$@"\n'
        )
        launcher.chmod(0o755)
    agent = FakeAgent(folder)
    monkeypatch.setenv("PATH", str(bin_dir))
    monkeypatch.setenv("HOME", str(folder))
    monkeypatch.setenv("FAKE_ACP_LOG", str(agent.log))
    monkeypatch.setenv("FAKE_ACP_SCRIPT", str(agent.script))
    return agent


def send(client, job: dict, candidate: dict, prompt: str, provider: str = "claude-code", tab: str = "tab-a"):
    return client.post(f"{agent_url(job, candidate)}/turns", json={"provider": provider, "prompt": prompt, "tab": tab})


def says(text: str) -> dict:
    return {"update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": text}}}


def test_a_turn_launches_the_agent_with_the_scoped_server_and_the_system_prompt(served, job, fake_agent, settings):
    candidate = job["candidates"][0]
    fake_agent.turns([[says("Done.")], [says("Again.")]])
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Tighten the pauses")

    assert sent.status_code == 202, sent.text
    turn = sent.json()["turn"]
    received = until_finished(stream)
    assert received == [
        ("turn_started", {"type": "turn_started", "turn": turn, "tab": "tab-a", "provider": "claude-code", "model": None, "prompt": "Tighten the pauses"}),
        ("text", {"type": "text", "turn": turn, "delta": "Done."}),
        ("turn_finished", {"type": "turn_finished", "turn": turn, "stop": "end_turn", "first_revision": None, "last_revision": None}),
    ]
    [initialize] = fake_agent.received("initialize")
    assert initialize["params"]["protocolVersion"] == 1
    capabilities = initialize["params"]["clientCapabilities"]
    assert capabilities["fs"] == {"readTextFile": False, "writeTextFile": False}
    assert capabilities["terminal"] is False
    [new] = fake_agent.received("session/new")
    cwd = Path(new["params"]["cwd"])
    assert cwd.parent == settings.data_dir / "agent" / "sandbox"
    assert cwd.is_dir()
    [server] = new["params"]["mcpServers"]
    assert server["type"] == "http"
    assert server["name"] == "ai-clipper"
    assert server["url"] == settings.backend_origin + "/mcp/agent"
    [header] = server["headers"]
    assert header["name"] == "Authorization" and header["value"].startswith("Bearer ")
    # Claude Code's adapter is told to allow the scoped server's tools without asking.
    assert "mcp__ai-clipper" in new["params"]["_meta"]["claudeCode"]["options"]["allowedTools"]
    [prompt] = fake_agent.received("session/prompt")
    assert prompt["params"]["sessionId"] == "fake-session"
    text = "".join(block["text"] for block in prompt["params"]["prompt"])
    assert candidate["id"] in text and job["id"] in text
    assert text.endswith("Tighten the pauses")

    # The next turn goes to the same process, without the system prompt.
    send(served, job, candidate, "Again")
    until_finished(stream)
    assert len(fake_agent.received("initialize")) == 1
    second = fake_agent.received("session/prompt")[-1]
    assert second["params"]["prompt"] == [{"type": "text", "text": "Again"}]


def test_thoughts_text_and_tool_calls_arrive_as_events(served, job, fake_agent):
    candidate = job["candidates"][0]
    edit = {"job_id": job["id"], "candidate_id": candidate["id"], "changes": {"hook_text": "Agent hook"}}
    fake_agent.turns([[
        {"update": {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "Pauses first."}}},
        {"update": {"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "mcp__ai-clipper__edit_candidate", "kind": "other", "status": "pending", "rawInput": edit}},
        {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "in_progress"}},
        {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
                    "content": [{"type": "content", "content": {"type": "text", "text": "Saved Revision 2"}}]}},
        {"update": {"sessionUpdate": "tool_call", "toolCallId": "t2", "title": "mcp__ai-clipper__get_candidate", "status": "pending"}},
        {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t2", "status": "failed",
                    "content": [{"type": "content", "content": {"type": "text", "text": "No such Candidate"}}]}},
        says("Tightened "),
        says("them."),
    ]])
    stream = agent_events(served, job, candidate)
    next(stream)

    turn = send(served, job, candidate, "Tighten the pauses", provider="codex").json()["turn"]
    received = until_finished(stream)

    assert received[1:-1] == [
        ("thought", {"type": "thought", "turn": turn, "delta": "Pauses first."}),
        ("tool_started", {"type": "tool_started", "turn": turn, "call": "t1", "tool": "edit_candidate", "summary": "sets hook_text",
                          "input": json.dumps(edit)}),
        ("tool_finished", {"type": "tool_finished", "turn": turn, "call": "t1", "ok": True, "error": None, "revision": None,
                           "output": "Saved Revision 2", "input": None}),
        ("tool_started", {"type": "tool_started", "turn": turn, "call": "t2", "tool": "get_candidate", "summary": "", "input": None}),
        ("tool_finished", {"type": "tool_finished", "turn": turn, "call": "t2", "ok": False, "error": "No such Candidate", "revision": None,
                           "output": None, "input": None}),
        ("text", {"type": "text", "turn": turn, "delta": "Tightened "}),
        ("text", {"type": "text", "turn": turn, "delta": "them."}),
    ]
    assert received[0][1]["provider"] == "codex"
    # Codex's adapter gets no Claude Code options.
    [new] = fake_agent.received("session/new")
    assert "_meta" not in new["params"]


def test_a_raw_input_that_only_comes_with_an_update_reaches_the_card_and_the_transcript(served, job, fake_agent):
    candidate = job["candidates"][0]
    asked = {"job_id": job["id"], "candidate_id": candidate["id"]}
    fake_agent.turns([[
        {"update": {"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "mcp__ai-clipper__get_candidate", "status": "pending"}},
        {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "in_progress", "rawInput": asked}},
        {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
                    "content": [{"type": "content", "content": {"type": "text", "text": "x" * 5000}}]}},
        says("Read it."),
    ]])
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Read the Candidate")
    received = dict(until_finished(stream))

    assert received["tool_started"]["input"] is None
    finished = received["tool_finished"]
    assert finished["input"] == json.dumps(asked)
    assert finished["output"] == "x" * 4096 + "…"
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    [tool, _] = kept["parts"]
    assert (tool["input"], tool["output"]) == (json.dumps(asked), "x" * 4096 + "…")


def permission(call: str, title: str, *kinds: str) -> dict:
    options = [{"optionId": f"{kind}-id", "name": kind, "kind": kind} for kind in kinds]
    return {"permission": {"toolCall": {"toolCallId": call, "title": title}, "options": options}}


def test_permissions_are_given_to_the_scoped_tools_only(served, job, fake_agent):
    candidate = job["candidates"][0]
    fake_agent.turns([[
        permission("p1", "mcp__ai-clipper__edit_candidate", "allow_once", "allow_always", "reject_once"),
        permission("p2", "Bash", "allow_once", "allow_always", "reject_once"),
        permission("p3", "Write /etc/hosts", "allow_always"),
        # Only its id: the tool call announced before names the tool.
        {"update": {"sessionUpdate": "tool_call", "toolCallId": "p4", "title": "Edit", "_meta": {"claudeCode": {"toolName": "mcp__ai-clipper__get_candidate"}}}},
        {"permission": {"toolCall": {"toolCallId": "p4"}, "options": [{"optionId": "yes", "name": "Allow", "kind": "allow_once"}]}},
        says("Done."),
    ]])
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Edit it")
    until_finished(stream)

    answers = [message["result"] for message in fake_agent.received() if "result" in message]
    assert answers == [
        {"outcome": {"outcome": "selected", "optionId": "allow_once-id"}},
        {"outcome": {"outcome": "selected", "optionId": "reject_once-id"}},
        {"outcome": {"outcome": "cancelled"}},
        {"outcome": {"outcome": "selected", "optionId": "yes"}},
    ]


def test_stop_sends_cancel_and_the_turn_ends_cancelled(served, job, fake_agent):
    candidate = job["candidates"][0]
    fake_agent.turns([[says("Working…"), {"hold": True}]])
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Take your time").json()["turn"]
    fake_agent.wait_for("session/prompt")

    assert served.post(f"{agent_url(job, candidate)}/cancel", json={"tab": "tab-a"}).status_code == 204

    received = until_finished(stream)
    assert received[-1][1] == {"type": "turn_finished", "turn": turn, "stop": "cancelled", "first_revision": None, "last_revision": None}
    [cancel] = fake_agent.received("session/cancel")
    assert cancel["params"] == {"sessionId": "fake-session"}
    assert "id" not in cancel


def test_a_crash_mid_turn_ends_it_with_an_error_and_the_next_send_starts_afresh(served, job, fake_agent):
    candidate = job["candidates"][0]
    fake_agent.turns([[says("Hmm"), {"crash": True}], [says("Back.")]])
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Crash")
    crashed = until_finished(stream)

    assert [name for name, _ in crashed] == ["turn_started", "text", "error", "turn_finished"]
    assert "exit status 3" in crashed[2][1]["message"]
    assert crashed[-1][1]["stop"] == "error"

    assert send(served, job, candidate, "Again").status_code == 202
    again = until_finished(stream)
    assert [(name, data.get("delta")) for name, data in again[1:]] == [("text", "Back."), ("turn_finished", None)]
    assert again[-1][1]["stop"] == "end_turn"
    assert len(fake_agent.received("initialize")) == 2
    # The new process gets the system prompt again.
    restarted = fake_agent.received("session/prompt")[-1]["params"]["prompt"][0]["text"]
    assert candidate["id"] in restarted and restarted.endswith("Again")


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_a_tab_that_switches_agents_ends_the_first_ones_process(served, job, fake_agent):
    candidate = job["candidates"][0]
    fake_agent.turns([[says("Claude.")], [says("Codex.")]])
    stream = agent_events(served, job, candidate)
    next(stream)
    send(served, job, candidate, "Hi")
    until_finished(stream)
    [first] = [message["started"] for message in fake_agent.received() if "started" in message]
    assert alive(first)

    send(served, job, candidate, "Hi", provider="codex")
    until_finished(stream)

    deadline = time.monotonic() + 5
    while alive(first):
        assert time.monotonic() < deadline, "the first agent kept running"
        time.sleep(0.01)
    assert len(fake_agent.received("initialize")) == 2


def test_signing_in_to_codex_calls_authenticate_with_its_browser_sign_in(served, fake_agent):
    response = served.post("/api/agent/providers/codex/login")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "provider": "codex", "login": "acp", "command": None,
        "message": "Finish signing in to Codex in the browser that opened.",
    }
    # The first method the agent runs itself: Codex lists its API key first.
    [authenticate] = fake_agent.wait_for("authenticate")
    assert authenticate["params"] == {"methodId": "chat-gpt"}
    assert fake_agent.received("initialize")


def test_signing_in_to_claude_code_is_a_command_to_run(served, fake_agent):
    response = served.post("/api/agent/providers/claude-code/login")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "claude-code", "login": "terminal", "command": ["claude", "auth", "login"],
        "message": "Run claude auth login in a terminal, then come back.",
    }
    assert fake_agent.received() == []


def test_signing_in_is_refused_for_an_api_provider_or_an_agent_not_installed(served, tmp_path, monkeypatch):
    empty = tmp_path / "empty-bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))

    assert served.post("/api/agent/providers/deepseek/login").status_code == 400
    assert served.post("/api/agent/providers/nope/login").status_code == 404
    not_installed = served.post("/api/agent/providers/codex/login")
    assert not_installed.status_code == 400 and "isn't installed" in not_installed.json()["detail"]


def test_codex_is_reported_signed_in_when_its_login_file_exists(served, fake_agent, tmp_path, monkeypatch):
    codex_home = tmp_path / "codex-home"
    codex_home.mkdir()
    (codex_home / "auth.json").write_text("{}")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    listing = {entry["provider"]["id"]: entry["status"] for entry in served.get("/api/agent/providers").json()}

    assert listing["codex"]["login"] == "signed_in"


def test_gemini_cli_runs_a_turn_launched_with_the_flag_its_help_lists(served, job, fake_agent):
    candidate = job["candidates"][0]
    fake_agent.turns([[says("Gemini here.")]])
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Hi", provider="gemini-cli")

    assert sent.status_code == 202, sent.text
    received = until_finished(stream)
    assert [(name, data.get("delta")) for name, data in received[1:]] == [("text", "Gemini here."), ("turn_finished", None)]
    [started] = [message for message in fake_agent.received() if "started" in message]
    assert started["args"] == ["--acp"]
    [new] = fake_agent.received("session/new")
    assert new["params"]["mcpServers"][0]["type"] == "http"
    # Claude Code's options are Claude Code's alone.
    assert "_meta" not in new["params"]


def test_a_refused_session_ends_the_turn_with_a_readable_error_and_the_next_send_tries_again(served, job, fake_agent, monkeypatch):
    candidate = job["candidates"][0]
    monkeypatch.setenv("FAKE_ACP_REFUSE_SESSION", "Authentication required")
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Hi", provider="antigravity")
    refused = until_finished(stream)

    assert [name for name, _ in refused] == ["turn_started", "error", "turn_finished"]
    message = refused[1][1]["message"]
    assert message.startswith("Antigravity didn't open a session: Authentication required.")
    assert "Antigravity's own settings" in message
    assert "https://antigravity.google/docs" in message
    assert refused[-1][1]["stop"] == "error"
    assert fake_agent.received("session/prompt") == []

    send(served, job, candidate, "Hi", provider="antigravity")
    until_finished(stream)
    assert len(fake_agent.received("initialize")) == 2


def test_an_agent_without_mcp_over_http_ends_the_turn_with_a_readable_error(served, job, fake_agent, monkeypatch):
    candidate = job["candidates"][0]
    monkeypatch.setenv("FAKE_ACP_NO_HTTP", "1")
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Hi", provider="antigravity")
    received = until_finished(stream)

    assert [name for name, _ in received] == ["turn_started", "error", "turn_finished"]
    assert "MCP servers over HTTP" in received[1][1]["message"]
    assert fake_agent.received("session/new") == []
