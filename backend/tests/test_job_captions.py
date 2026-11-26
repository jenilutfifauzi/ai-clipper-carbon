"""Turning a Job's captions on or off after it is made (Auto captions), through the HTTP API."""

from conftest import wait_for
from test_jobs_api import create_job


def change(client, job_id: str, captions: bool):
    return client.patch(f"/api/jobs/{job_id}", json={"captions": captions})


def test_a_jobs_captions_are_turned_on_and_off_and_its_captions_follow(client):
    job = create_job(client, captions=False)
    wait_for(client, job["id"], "review")
    candidate = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": 0.1, "end": 1.6}).json()
    captions = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/captions/srt"
    assert client.get(captions).status_code == 409

    turned_on = change(client, job["id"], True)
    assert turned_on.status_code == 200, turned_on.text
    assert turned_on.json()["options"]["captions"] is True
    assert client.get(f"/api/jobs/{job['id']}").json()["options"]["captions"] is True
    assert client.get(captions).status_code == 200

    assert change(client, job["id"], False).json()["options"]["captions"] is False
    assert client.get(captions).status_code == 409


def test_captions_of_a_missing_job_or_a_running_one_are_not_changed(client, video_source, wait_for_status):
    assert change(client, "nope", True).status_code == 404

    video_source.hold()
    job = create_job(client)
    wait_for_status(job["id"], "downloading")
    refused = change(client, job["id"], False)
    assert refused.status_code == 409 and "once its stage is done" in refused.json()["detail"]
    video_source.release()
    wait_for(client, job["id"], "review")
    assert client.get(f"/api/jobs/{job['id']}").json()["options"]["captions"] is True


def test_only_captions_are_changed(client):
    job = create_job(client)
    wait_for(client, job["id"], "review")
    assert client.patch(f"/api/jobs/{job['id']}", json={"captions": True, "language": "en"}).status_code == 422
