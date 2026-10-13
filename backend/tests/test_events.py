"""Seam A: a Job's server-sent events, and the app serving the built frontend.

Streams that must be read while the Job runs go through a real uvicorn server on a free port:
TestClient only hands over a streamed body once the stream has ended.
"""

import json
import threading
import time
from collections.abc import Iterator
from dataclasses import replace

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.llm import QuotaExceeded
from app.main import create_app
from app.ports import Ports
from test_jobs_api import URL, create_job

QUOTA = QuotaExceeded("Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: Quota exceeded.")


@pytest.fixture
def server(settings, video_source, transcriber, llm) -> Iterator[httpx.Client]:
    """A client of the app served by uvicorn in a thread, with the fakes at its ports."""
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
            yield client
    finally:
        video_source.release()
        server.should_exit = True
        thread.join(5)


def events(lines: Iterator[str]) -> Iterator[tuple[str, object]]:
    """The (event, data) of each event in an SSE stream, skipping comments."""
    name, data = None, []
    for line in lines:
        if line.startswith(":"):
            continue
        if line.startswith("event: "):
            name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            data.append(line.removeprefix("data: "))
        elif not line and name:
            yield name, json.loads("\n".join(data))
            name, data = None, []


def stream(client, job_id: str) -> Iterator[tuple[str, object]]:
    with client.stream("GET", f"/api/jobs/{job_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        yield from events(response.iter_lines())


def statuses(received: list[tuple[str, object]]) -> list[str]:
    """The Job statuses the events went through, each once per stretch."""
    seen: list[str] = []
    for name, data in received:
        if name == "job" and (not seen or seen[-1] != data["status"]):
            seen.append(data["status"])
    return seen


def wait_until(client, job_id: str, status: str) -> None:
    deadline = time.monotonic() + 5
    while client.get(f"/api/jobs/{job_id}").json()["status"] != status:
        assert time.monotonic() < deadline, f"Job never reached {status}"
        time.sleep(0.01)


def test_events_follow_a_job_live_through_every_stage_to_review(server, video_source):
    video_source.hold()
    job = create_job(server)
    wait_until(server, job["id"], "downloading")

    received = []
    for event in stream(server, job["id"]):
        received.append(event)
        if len(received) == 1:
            # Connected while the download is held: the rest happens while the stream is open.
            assert event == ("job", {
                "status": "downloading", "stage": "downloading", "progress": None, "message": None,
                "error": None, "warnings": [], "retry_at": None,
            })
            video_source.release()

    assert statuses(received) == ["downloading", "transcribing", "analyzing", "review"]
    assert received[-1] == ("end", "review")
    final = received[-2][1]
    assert (final["status"], final["stage"], final["progress"], final["message"]) == ("review", None, None, None)
    analyzing = [data for name, data in received if name == "job" and data["status"] == "analyzing"]
    percents = [data["progress"] for data in analyzing if data["progress"] is not None]
    assert percents and percents == sorted(percents)
    assert any(data["message"] and data["message"].startswith("Scoring") for data in analyzing)
    # Each event says something new: changes that leave the progress alone send nothing.
    payloads = [json.dumps(data) for name, data in received if name == "job"]
    assert all(a != b for a, b in zip(payloads, payloads[1:]))


def test_events_show_a_quota_wait_with_its_retry_time_then_the_job_carrying_on(server, video_source, llm):
    llm.fail_with(QUOTA)
    video_source.hold()
    job = create_job(server)
    wait_until(server, job["id"], "downloading")

    received = []
    for event in stream(server, job["id"]):
        received.append(event)
        if len(received) == 1:
            video_source.release()

    assert statuses(received) == [
        "downloading", "transcribing", "analyzing", "waiting_quota", "queued", "analyzing", "review",
    ]
    waiting = next(data for name, data in received if name == "job" and data["status"] == "waiting_quota")
    assert waiting["stage"] == "analyzing"
    assert waiting["message"].startswith("Trying again at ") and str(QUOTA) in waiting["message"]
    assert waiting["retry_at"] is not None
    assert received[-1] == ("end", "review")


def test_a_job_deleted_while_queued_ends_its_stream(server, video_source):
    video_source.hold()
    running = create_job(server)
    wait_until(server, running["id"], "downloading")
    queued = create_job(server, url=f"{URL}2")

    received = []
    for event in stream(server, queued["id"]):
        received.append(event)
        if len(received) == 1:
            assert event[1]["status"] == "queued"
            assert server.delete(f"/api/jobs/{queued['id']}").status_code == 204

    assert received[-1] == ("end", "deleted")


def test_a_job_already_in_review_sends_its_state_and_ends(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert list(stream(client, job["id"])) == [
        ("job", {
            "status": "review", "stage": None, "progress": None, "message": None,
            "error": None, "warnings": [], "retry_at": None,
        }),
        ("end", "review"),
    ]


def test_a_failed_job_sends_its_stage_and_error_and_ends(client, video_source, wait_for_status):
    video_source.fail_with(RuntimeError("Video unavailable"))
    job = wait_for_status(create_job(client)["id"], "error")

    (name, data), end = stream(client, job["id"])

    assert name == "job"
    assert (data["status"], data["stage"]) == ("error", "downloading")
    assert data["error"].startswith("Video unavailable. If YouTube changed something")
    assert end == ("end", "error")


def test_events_of_an_unknown_job_are_404(client):
    assert client.get("/api/jobs/000000000000/events").status_code == 404


def test_the_app_serves_the_built_frontend_with_index_html_for_client_routes(
    settings, video_source, transcriber, llm, tmp_path
):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>AI Clipper</title>")
    (dist / "assets" / "app.js").write_text("console.log('app')")
    settings = replace(settings, frontend_dir=dist)

    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        for path in ["/", "/jobs/0123456789ab"]:
            response = client.get(path)
            assert response.status_code == 200
            assert "<title>AI Clipper</title>" in response.text
        assert client.get("/assets/app.js").text == "console.log('app')"
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/nothing").status_code == 404
        assert client.get("/media/nothing").status_code == 404


def test_without_a_build_the_app_serves_only_the_api(settings, video_source, transcriber, llm, tmp_path):
    settings = replace(settings, frontend_dir=tmp_path / "missing")

    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").status_code == 200
