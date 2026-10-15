"""Seam A: a Job's Candidate events, which keep the open editors in step (edit-sync 03).

Read from a real uvicorn server, like the Job's events (test_events.py): a TestClient only hands over
a streamed body once it has ended.
"""

import json
import threading
import time
from collections.abc import Iterator

import anyio
import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from mcp import Client

from app.jobs import CANDIDATES_FILE
from app.main import create_app
from app.ports import Ports
from test_events import events, wait_until
from test_jobs_api import create_job
from test_selection import clip

AGENT_HEADERS = {"X-Edit-Source": "agent"}


@pytest.fixture
def served(settings, video_source, transcriber, llm, from_episode) -> Iterator[tuple[httpx.Client, FastAPI]]:
    """A client of the app served by uvicorn in a thread, and the app."""
    app = create_app(settings, Ports(video_source, transcriber, llm))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started:
        assert time.monotonic() < deadline, "uvicorn didn't start"
        time.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5) as client:
            yield client, app
    finally:
        server.should_exit = True
        thread.join(5)


def in_review(client, llm) -> tuple[dict, dict]:
    llm.clips = [clip("10:00", "10:44")]
    job = create_job(client)
    wait_until(client, job["id"], "review")
    [candidate] = client.get(f"/api/jobs/{job['id']}").json()["candidates"]
    return job, candidate


def candidate_events(client, job_id: str) -> Iterator[tuple[str, object]]:
    with client.stream("GET", f"/api/jobs/{job_id}/candidates/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        yield from events(response.iter_lines())


def test_a_save_is_told_with_its_revision_editor_tab_and_changed_parts(served, llm):
    client, _ = served
    job, candidate = in_review(client, llm)
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"

    stream = candidate_events(client, job["id"])
    # The Candidates as they are when it connects, so that an editor can see what it missed.
    assert next(stream) == ("ready", {"candidates": [candidate]})
    saved = client.patch(url, json={"revision": 1, "hook_text": "New hook", "hook_kicker": "BARU"},
                         headers={"X-Edit-Source": "clip-editor", "X-Edit-Tab": "tab-a"}).json()
    assert next(stream) == ("candidate", {"candidate": saved, "source": "clip-editor", "tab": "tab-a", "parts": ["Hook"]})

    moved = client.patch(url, json={"start": 601.2, "layout": "split"}).json()
    assert next(stream) == ("candidate", {"candidate": moved, "source": "unknown", "tab": None, "parts": ["Range", "Layout"]})


def test_a_save_through_mcp_is_told_as_the_agents(served, llm):
    client, app = served
    job, candidate = in_review(client, llm)

    async def edit() -> None:
        async with Client(app.state.mcp) as mcp:
            result = await mcp.call_tool("merge_candidate_items", {
                "job_id": job["id"], "candidate_id": candidate["id"],
                "text_layers": [{"id": "title", "text": "Judul", "start": 0, "secs": 1}],
            })
            assert not result.is_error, result.content

    stream = candidate_events(client, job["id"])
    assert next(stream)[0] == "ready"
    anyio.run(edit)
    name, data = next(stream)
    assert (name, data["source"], data["tab"], data["parts"]) == ("candidate", "agent", None, ["Text Layers"])
    assert data["candidate"]["revision"] == 2


def test_a_save_by_another_process_is_found_when_the_candidates_are_read_again(served, llm, settings):
    client, _ = served
    job, candidate = in_review(client, llm)
    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE

    stream = candidate_events(client, job["id"])
    assert next(stream)[0] == "ready"
    # As a CLI run would: written to disk, with nothing told to this process.
    [stored] = json.loads(path.read_text())
    path.write_text(json.dumps([stored | {"hook_text": "From the CLI", "revision": 2}]))
    name, data = next(stream)
    assert (name, data["source"], data["parts"], data["candidate"]["hook_text"]) == ("candidate", "unknown", ["Hook"], "From the CLI")


def test_deleting_the_job_ends_the_stream(served, llm):
    client, _ = served
    job, _ = in_review(client, llm)

    stream = candidate_events(client, job["id"])
    assert next(stream)[0] == "ready"
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert list(stream) == [("deleted", job["id"])]
