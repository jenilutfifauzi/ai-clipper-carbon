"""The scoped MCP server at /mcp/agent (.scratch/agent-mode/issues/01): the tools an Agent may use,
called over HTTP as an ACP agent would, bound by a bearer token to one Job and one Candidate."""

import json

import pytest

from app.agent.scope import ALLOWED_TOOLS, AgentScope
from conftest import wait_for
from test_jobs_api import create_job

MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "Host": "127.0.0.1:8000"}


def rpc(client, method: str, params: dict, token: str | None = None) -> dict:
    """The JSON-RPC result (or error) of one request to /mcp/agent, sent with `token` as its bearer."""
    headers = MCP_HEADERS | ({"Authorization": f"Bearer {token}"} if token else {})
    response = client.post("/mcp/agent", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, headers=headers)
    assert response.status_code == 200, response.text
    [data] = [line.removeprefix("data: ") for line in response.text.splitlines() if line.startswith("data: ")]
    return json.loads(data)


def call(client, token: str | None, tool: str, **arguments) -> dict:
    return rpc(client, "tools/call", {"name": tool, "arguments": arguments}, token)["result"]


def result(called: dict) -> dict:
    assert not called.get("isError"), called
    return json.loads(called["content"][0]["text"])


def refused(called: dict) -> str:
    assert called.get("isError"), called
    return called["content"][0]["text"]


@pytest.fixture
def job(client) -> dict:
    """A Job in review with two manual Candidates."""
    job = create_job(client)
    wait_for(client, job["id"], "review")
    for start, end in ((0.1, 1.6), (0.1, 1.6)):
        assert client.post(f"/api/jobs/{job['id']}/candidates", json={"start": start, "end": end}).status_code == 201
    return client.get(f"/api/jobs/{job['id']}").json()


@pytest.fixture
def scope(job) -> AgentScope:
    return AgentScope(job_id=job["id"], candidate_id=job["candidates"][0]["id"], session_id="s1", turn_id="t1")


@pytest.fixture
def token(client, scope) -> str:
    return client.app.state.agent_scopes.issue(scope)


def test_the_scoped_server_lists_only_the_allowed_tools(client, token):
    listed = {tool["name"] for tool in rpc(client, "tools/list", {}, token)["result"]["tools"]}

    assert listed == set(ALLOWED_TOOLS)
    assert not listed & {"create_job_from_url", "render_clips", "delete_job"}


def test_a_call_without_a_token_or_with_a_revoked_one_is_refused(client, scope, token):
    ids = {"job_id": scope.job_id, "candidate_id": scope.candidate_id}
    assert "bearer token" in refused(call(client, None, "get_candidate", **ids))
    assert "bearer token" in refused(call(client, "unknown", "get_candidate", **ids))
    assert result(call(client, token, "get_candidate", **ids))["id"] == scope.candidate_id

    client.app.state.agent_scopes.revoke(token)

    assert "bearer token" in refused(call(client, token, "get_candidate", **ids))


def test_edits_reach_the_scoped_candidate_only(client, job, scope, token):
    other = job["candidates"][1]

    mine = call(client, token, "edit_candidate", job_id=scope.job_id, candidate_id=scope.candidate_id, changes={"hook_text": "Mine"})
    assert result(mine)["hook_text"] == "Mine"

    theirs = {"changes": {"hook_text": "Theirs"}}
    assert "Candidate" in refused(call(client, token, "edit_candidate", job_id=job["id"], candidate_id=other["id"], **theirs))
    assert "Job" in refused(call(client, token, "edit_candidate", job_id="other", candidate_id=scope.candidate_id, **theirs))
    both = [scope.candidate_id, other["id"]]
    assert "Candidate" in refused(call(client, token, "apply_template", job_id=job["id"], candidate_ids=both, template_id=None))
    first, second = client.get(f"/api/jobs/{job['id']}").json()["candidates"]
    assert first["hook_text"] == "Mine"
    assert second == other


def test_a_save_through_the_scoped_server_names_its_agent_turn_in_its_revision(client, scope, token):
    ids = {"job_id": scope.job_id, "candidate_id": scope.candidate_id}
    call(client, token, "edit_candidate", **ids, changes={"hook_text": "In the turn"})
    client.app.state.agent_scopes.set_turn(token, None)
    call(client, token, "edit_candidate", **ids, changes={"hook_text": "Between turns"})

    path = f"/api/jobs/{scope.job_id}/candidates/{scope.candidate_id}/revisions"
    between, turn, *_ = client.get(path).json()["revisions"]
    assert (turn["source"], turn["tab"]) == ("agent", "agent:t1")
    assert (between["source"], between["tab"]) == ("agent", "agent:s1")
