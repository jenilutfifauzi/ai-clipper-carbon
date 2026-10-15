"""Seam A: a Candidate's Revision, and saves made from a stale one refused (ADR 0003)."""

import json

import anyio
import pytest

from app import revisions
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


# Revision History (edit-sync 04)


def saved_by(source: str, tab: str | None = None) -> dict:
    return {"X-Edit-Source": source} | ({"X-Edit-Tab": tab} if tab else {})


def entries(client, job: dict, candidate: dict) -> list[dict]:
    response = client.get(f"{candidate_url(job, candidate)}/revisions")
    assert response.status_code == 200, response.text
    return [{k: v for k, v in entry.items() if k != "at"} for entry in response.json()["revisions"]]


def save(client, job: dict, candidate: dict, headers: dict, **change) -> dict:
    response = client.patch(candidate_url(job, candidate), json=change, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_saves_from_one_editor_make_one_entry_and_the_state_before_another_editors_is_kept(
    client, from_episode, llm, wait_for_status
):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    assert entries(client, job, candidate) == []

    save(client, job, candidate, saved_by("advanced-edit", "tab-a"), hook_text="One")
    save(client, job, candidate, saved_by("advanced-edit", "tab-a"), hook_text="Two", source_volume=0.5)
    save(client, job, candidate, saved_by("agent"), hook_kicker="AGENT")
    save(client, job, candidate, saved_by("advanced-edit", "tab-b"), layout="split")

    # Newest first. The Candidate as Selection made it is kept before the first save.
    assert entries(client, job, candidate) == [
        {"revision": 5, "source": "advanced-edit", "tab": "tab-b", "parts": ["Layout"]},
        {"revision": 4, "source": "agent", "tab": None, "parts": ["Hook"]},
        {"revision": 3, "source": "advanced-edit", "tab": "tab-a", "parts": ["Hook", "Source volume"]},
        {"revision": 1, "source": "original", "tab": None, "parts": []},
    ]


def test_after_a_pause_one_editors_saves_start_a_new_entry_and_the_oldest_go_beyond_the_most_kept(
    client, from_episode, llm, wait_for_status, monkeypatch
):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    # Every save comes after a pause; three entries are kept.
    monkeypatch.setattr(revisions, "GROUP_SECS", 0)
    monkeypatch.setattr(revisions, "HISTORY_MAX", 3)

    for n in range(4):
        save(client, job, candidate, saved_by("clip-editor", "tab-a"), hook_secs=4 + n)
    assert [entry["revision"] for entry in entries(client, job, candidate)] == [5, 4, 3]


def test_restoring_an_entry_saves_it_again_as_the_next_revision(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    url = candidate_url(job, candidate)
    save(client, job, candidate, saved_by("clip-editor"), selected=True)
    save(client, job, candidate, saved_by("agent"), hook_text="The agent's hook", text_layers=[{"id": "t", "text": "T", "start": 0, "secs": 1}])

    response = client.post(f"{url}/revisions/1/restore", json={"revision": 2}, headers=saved_by("clip-editor", "tab-a"))
    assert response.status_code == 200, response.text
    restored = response.json()
    # As Selection made it, but still chosen for rendering.
    assert (restored["revision"], restored["hook_text"], restored["text_layers"], restored["selected"]) == (
        3, candidate["hook_text"], [], True,
    )
    assert entries(client, job, candidate)[0] == {"revision": 3, "source": "restore", "tab": "tab-a", "parts": ["Text Layers", "Hook"]}
    # The entry restored is still there: a Restore takes nothing away.
    assert client.get(f"{url}/revisions/2").json()["candidate"]["hook_text"] == "The agent's hook"

    stale = client.post(f"{url}/revisions/2/restore", json={"revision": 2})
    assert stale.status_code == 409
    assert stale.json()["detail"]["candidate"] == restored
    assert client.post(f"{url}/revisions/99/restore", json={}).status_code == 404
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert client.get(f"{url}/revisions").status_code == 404


@pytest.mark.anyio
async def test_the_agent_lists_and_restores_revisions(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"hook_text": "A mistake"})

    listed = await call(mcp, "list_candidate_revisions", **ids)
    assert [(entry["revision"], entry["source"], entry["parts"]) for entry in listed["revisions"]] == [
        (2, "agent", ["Hook"]), (1, "original", []),
    ]
    restored = await call(mcp, "restore_candidate_revision", **ids, restore=1, revision=2)
    assert (restored["revision"], restored["hook_text"]) == (3, candidate["hook_text"])
    assert "Revision 3" in await fails(mcp, "restore_candidate_revision", **ids, restore=1, revision=2)


def test_the_agent_is_told_the_owner_sees_its_edits_live_and_wins_a_clash(client):
    instructions = " ".join(client.app.state.mcp.instructions.split())
    assert "show these edits as they are saved" in instructions
    assert "the owner's change wins" in instructions
    assert "list_candidate_revisions" in instructions
