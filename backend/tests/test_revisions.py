"""Seam A: a Candidate's Revision, and saves made from a stale one refused (ADR 0003)."""

import json

import anyio
import pytest

from app.jobs import CANDIDATES_FILE
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp, reviewed  # noqa: F401 (fixtures)
from test_review import candidate_url, candidates, patch
from test_selection import analyzed, clip


def test_a_candidate_starts_at_revision_1_and_each_change_raises_it(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    assert candidate["revision"] == 1

    assert patch(client, job, candidate, hook_text="A new hook")["revision"] == 2
    assert patch(client, job, candidate, revision=2, hook_kicker="NEW")["revision"] == 3
    [stored] = candidates(client, job)
    assert stored["revision"] == 3


def test_a_save_from_an_older_revision_is_refused_with_the_candidate_as_it_is_now(
    client, from_episode, llm, wait_for_status
):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    now = patch(client, job, candidate, revision=1, hook_text="The agent's hook")

    # Made from Revision 1, which the agent's save has moved past.
    response = client.patch(candidate_url(job, candidate), json={"revision": 1, "hook_text": "The owner's hook"})
    assert response.status_code == 409
    assert response.json()["detail"]["candidate"] == now
    assert "Revision 2" in response.json()["detail"]["message"]
    assert candidates(client, job) == [now]


def test_a_preview_of_a_draft_from_an_older_revision_is_still_planned(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    patch(client, job, candidate, hook_text="The agent's hook")

    # Nothing is saved, so there is nothing to save over.
    response = client.post(f"{candidate_url(job, candidate)}/preview-plan", json={"revision": 1, "hook_text": "Mine"})
    assert response.status_code == 200, response.text


def test_choosing_for_rendering_and_saving_nothing_new_keep_the_revision(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]

    assert patch(client, job, candidate, revision=1, selected=True)["revision"] == 1
    assert patch(client, job, candidate, revision=1, hook_text=candidate["hook_text"])["revision"] == 1
    # Choosing it from a stale Revision is refused like any save from one.
    patch(client, job, candidate, hook_text="Changed")
    assert client.patch(candidate_url(job, candidate), json={"revision": 1, "selected": False}).status_code == 409


def test_a_save_without_a_revision_is_saved_over_whatever_is_there(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    patch(client, job, candidate, revision=1, hook_text="The agent's hook")

    saved = patch(client, job, candidate, hook_text="An older caller's hook")
    assert (saved["hook_text"], saved["revision"]) == ("An older caller's hook", 3)


def test_a_candidate_saved_before_revisions_is_at_revision_1(client, settings, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    stored = json.loads(path.read_text())
    path.write_text(json.dumps([{k: v for k, v in candidate.items() if k != "revision"} for candidate in stored]))

    [candidate] = candidates(client, job)
    assert candidate["revision"] == 1
    assert patch(client, job, candidate, revision=1, hook_text="Edited")["revision"] == 2


# Through MCP


@pytest.mark.anyio
async def test_the_tools_tell_the_revision_and_an_edit_from_a_stale_one_fails_with_the_candidate(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    assert candidate["revision"] == 1
    [listed] = [c for c in (await call(mcp, "get_job", job_id=job["id"]))["candidates"] if c["id"] == candidate["id"]]
    assert listed["revision"] == 1

    edited = await call(mcp, "edit_candidate", **ids, changes={"revision": 1, "hook_text": "Mine"})
    assert edited["revision"] == 2
    error = await fails(mcp, "edit_candidate", **ids, changes={"revision": 1, "hook_text": "Stale"})
    assert "Revision 2" in error
    assert json.loads(error[error.index("{"):])["hook_text"] == "Mine"
    assert (await call(mcp, "get_candidate", **ids))["hook_text"] == "Mine"


@pytest.mark.anyio
async def test_merges_made_at_the_same_time_keep_both(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    async def add(layer_id: str) -> None:
        await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": layer_id, "text": layer_id, "start": 0, "secs": 1}])

    async with anyio.create_task_group() as group:
        for layer_id in ("first", "second", "third"):
            group.start_soon(add, layer_id)
    layers = (await call(mcp, "get_candidate", **ids))["text_layers"]
    assert sorted(layer["id"] for layer in layers) == ["first", "second", "third"]
