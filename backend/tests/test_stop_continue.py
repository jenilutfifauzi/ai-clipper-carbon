"""Stopping a Job on its way to review, and continuing it, through the HTTP API with call-counting
fakes at the ports."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.llm import QuotaExceeded
from app.main import create_app
from app.ports import Ports
from conftest import wait_for
from test_jobs_api import create_job, statuses
from test_resilience import BUSY


def stop(client, job_id: str) -> dict:
    response = client.post(f"/api/jobs/{job_id}/stop")
    assert response.status_code == 200, response.text
    return response.json()


def resume(client, job_id: str) -> dict:
    response = client.post(f"/api/jobs/{job_id}/continue")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_job_stopped_while_downloading_stops_there_and_continues_from_its_download(
    client, video_source, wait_for_status
):
    video_source.progress_steps = [0.5, 1.0]
    video_source.hold()
    job_id = create_job(client)["id"]
    wait_for_status(job_id, "downloading")

    stopping = stop(client, job_id)
    assert (stopping["status"], stopping["message"]) == ("downloading", "Stopping…")
    video_source.release()
    stopped = wait_for_status(job_id, "stopped", "review", "error")
    assert (stopped["status"], stopped["stage"], stopped["message"], stopped["error"]) == (
        "stopped", "downloading", None, None,
    )

    queued = resume(client, job_id)
    assert (queued["status"], queued["stage"]) == ("queued", None)
    job = wait_for_status(job_id, "review", "error")
    assert statuses(job) == [
        "queued", "downloading", "stopped", "queued", "downloading", "transcribing", "analyzing", "review",
    ]


def test_a_stopped_transcription_ends_at_once_and_continues_by_transcribing_again(
    client, video_source, speech, transcriber, wait_for_status
):
    video_source.video, video_source.caption_track = speech.video, None
    transcriber.stall(1)
    job_id = create_job(client)["id"]
    wait_for(client, job_id, "transcribing")
    while not transcriber.calls:
        pass

    stop(client, job_id)
    # Whisper is stopped well within the watchdog's 5 s budget, so it never retries the range.
    stopped = wait_for_status(job_id, "stopped", "review", "error", timeout=3)
    assert (stopped["status"], stopped["stage"], stopped["warnings"]) == ("stopped", "transcribing", [])
    assert len(transcriber.calls) == 1

    resume(client, job_id)
    job = wait_for_status(job_id, "review", "error")
    assert job["status"] == "review"
    assert statuses(job)[-4:] == ["queued", "transcribing", "analyzing", "review"]


def test_a_job_waiting_for_quota_is_stopped_at_once_and_continues_without_waiting(
    client, llm, wait_for_status
):
    llm.fail_with(QuotaExceeded("Gemini's quota is used up.", retry_after=60))
    job_id = create_job(client)["id"]
    wait_for_status(job_id, "waiting_quota")

    stopped = stop(client, job_id)
    assert (stopped["status"], stopped["stage"], stopped["quota"]) == ("stopped", "analyzing", None)

    resume(client, job_id)
    job = wait_for_status(job_id, "review", "error", timeout=3)
    assert statuses(job)[-5:] == ["waiting_quota", "stopped", "queued", "analyzing", "review"]


def test_a_queued_job_is_stopped_before_it_runs(client, video_source, wait_for_status):
    video_source.hold()
    first = create_job(client)["id"]
    wait_for_status(first, "downloading")
    second = create_job(client)["id"]

    assert stop(client, second)["status"] == "stopped"
    video_source.release()
    wait_for_status(first, "review", "error")
    assert client.get(f"/api/jobs/{second}").json()["status"] == "stopped"
    assert len(video_source.calls) == 1

    resume(client, second)
    assert wait_for_status(second, "review", "error")["status"] == "review"


def test_a_stop_cuts_a_retry_pause_short(settings, video_source, transcriber, llm):
    # Gemini busy, with the 30 s pause before the retry that the Job page shows as "Retrying in 30 s".
    patient = replace(settings, selection=replace(settings.selection, llm_retry_secs=30))
    llm.fail_with(BUSY)
    with TestClient(create_app(patient, Ports(video_source, transcriber, llm))) as client:
        job_id = create_job(client)["id"]
        while not (job := client.get(f"/api/jobs/{job_id}").json())["message"] or not job["message"].startswith("Retrying"):
            assert job["status"] not in ("review", "error"), job
        stop(client, job_id)
        stopped = wait_for(client, job_id, "stopped", "review", "error", timeout=3)
        assert (stopped["status"], stopped["stage"]) == ("stopped", "analyzing")
        assert len(llm.score_requests) == 1

        resume(client, job_id)
        assert wait_for(client, job_id, "review", "error")["status"] == "review"


def test_only_a_job_on_its_way_to_review_can_be_stopped_and_only_a_stopped_one_continued(
    client, wait_for_status
):
    job = wait_for_status(create_job(client)["id"], "review", "error")

    response = client.post(f"/api/jobs/{job['id']}/stop")
    assert response.status_code == 409
    assert response.json()["detail"] == f"Job {job['id']} is review: only a Job on its way to review can be stopped"
    response = client.post(f"/api/jobs/{job['id']}/continue")
    assert response.status_code == 409
    assert response.json()["detail"] == f"Job {job['id']} is review: only a stopped Job can be continued"
    assert client.get(f"/api/jobs/{job['id']}").json()["history"] == job["history"]
    assert client.post("/api/jobs/0123456789ab/stop").status_code == 404
    assert client.post("/api/jobs/0123456789ab/continue").status_code == 404
