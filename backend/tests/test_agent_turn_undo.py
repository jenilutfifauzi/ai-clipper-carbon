"""Undoing an Agent Turn (.scratch/agent-mode/issues/08, ADR 0028): Revert restores the Revision before
the turn and Restore its last, each as a new Revision with source `restore`. On the fake provider of
test_agent_api_loop."""

from unittest.mock import ANY

from test_agent_api_loop import (  # noqa: F401  (fixtures)
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

OWNER = {"X-Edit-Source": "advanced-edit", "X-Edit-Tab": "tab-a"}


def candidate_url(job: dict, candidate: dict) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}"


def owner_saves(served, job: dict, candidate: dict, hook: str) -> dict:
    current = served.get(f"/api/jobs/{job['id']}").json()["candidates"][0]
    saved = served.patch(candidate_url(job, candidate), json={"hook_text": hook, "revision": current["revision"]}, headers=OWNER)
    assert saved.status_code == 200, saved.text
    return saved.json()


def a_turn_setting_the_hook_twice(served, chat, job: dict, candidate: dict) -> tuple[str, dict]:
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    chat.replies = [
        calls(("edit_candidate", ids | {"changes": {"hook_text": "Agent one"}})),
        calls(("edit_candidate", ids | {"changes": {"hook_text": "Agent two"}})),
        answer("Done."),
    ]
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Set the hook").json()["turn"]
    received = until_finished(stream)
    return turn, received[-1][1]


def test_revert_restores_the_state_before_the_turn_and_restore_brings_back_its_last(served, chat, job):
    candidate = job["candidates"][0]
    # Two owner saves soon after each other share one Revision History entry, as the turn's two do.
    owner_saves(served, job, candidate, "Mine")
    before = owner_saves(served, job, candidate, "Mine again")
    turn, finished = a_turn_setting_the_hook_twice(served, chat, job, candidate)
    assert finished["first_revision"] == before["revision"] + 1 and finished["last_revision"] == before["revision"] + 2

    # Right after turn_finished: the turn is in the chat already.
    reverted = served.post(f"{agent_url(job, candidate)}/turns/{turn}/revert", headers=OWNER)

    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["hook_text"] == "Mine again"
    assert reverted.json()["revision"] == finished["last_revision"] + 1
    [newest, *_] = served.get(f"{candidate_url(job, candidate)}/revisions").json()["revisions"]
    assert (newest["revision"], newest["source"]) == (reverted.json()["revision"], "restore")

    restored = served.post(f"{agent_url(job, candidate)}/turns/{turn}/restore", headers=OWNER)

    assert restored.status_code == 200, restored.text
    assert restored.json()["hook_text"] == "Agent two"
    assert restored.json()["revision"] == reverted.json()["revision"] + 1


def test_a_turn_without_revisions_cant_be_reverted_or_restored(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Nothing to do.")]
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Hi").json()["turn"]
    until_finished(stream)

    assert served.post(f"{agent_url(job, candidate)}/turns/{turn}/revert").status_code == 409
    assert served.post(f"{agent_url(job, candidate)}/turns/{turn}/restore").status_code == 409
    assert served.post(f"{agent_url(job, candidate)}/turns/nope/revert").status_code == 404


def test_turn_started_names_the_prompt(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Hello.")]
    stream = agent_events(served, job, candidate)
    next(stream)
    turn = send(served, job, candidate, "Say hello").json()["turn"]

    _, started = until_finished(stream)[0]

    assert started == {"type": "turn_started", "turn": turn, "tab": "tab-a", "thread": ANY, "provider": "deepseek", "model": "deepseek-chat", "prompt": "Say hello"}
