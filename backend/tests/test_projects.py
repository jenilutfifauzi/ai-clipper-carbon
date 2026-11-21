"""Projects: an uploaded master file and Media Library videos, opened straight for the Advanced Edit,
never transcribed nor analyzed, through the HTTP API with call-counting fakes at the ports."""

import json
import subprocess
from pathlib import Path

import pytest

from app.config import load_settings

OPTIONS = {"language": "id", "captions": False, "min_secs": 1, "max_secs": 600}


@pytest.fixture(scope="session")
def clip(tmp_path_factory) -> bytes:
    """A 2 s 320x240 video with a tone."""
    path = tmp_path_factory.mktemp("projects") / "clip.mp4"
    lavfi = ("-f", "lavfi", "-i")
    subprocess.run(
        [str(load_settings().ffmpeg_bin), "-v", "error", "-y", *lavfi, "testsrc=size=320x240:rate=25:duration=2", *lavfi,
         "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path)],
        check=True,
    )
    return path.read_bytes()


def add_media(client, data: bytes) -> str:
    response = client.post("/api/media", files={"file": ("clip.mp4", data, "application/octet-stream")})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def open_project(client, video: Path, media: list[str], options: dict = OPTIONS):
    with video.open("rb") as file:
        return client.post(
            "/api/jobs/upload",
            data={"options": json.dumps(options), "project": json.dumps({"media": media})},
            files={"file": ("main.mp4", file, "video/mp4")},
        )


def test_a_project_opens_its_videos_in_one_candidate_without_transcribing_or_analyzing(
    client, speech, clip, transcriber, llm, wait_for_status
):
    media = [add_media(client, clip), add_media(client, clip)]
    response = open_project(client, speech.video, media)
    assert response.status_code == 201, response.text
    assert response.json()["project"] == {"media": media}

    job = wait_for_status(response.json()["id"], "review", "error")
    assert job["status"] == "review", job["error"]
    assert transcriber.calls == [] and llm.score_requests == [] and llm.detail_requests == []
    assert job["transcript"]["words"] == []
    [candidate] = job["candidates"]
    segments = candidate["segments"]
    assert [segment["media"] for segment in segments] == [None, *media]
    assert (segments[0]["start"], segments[0]["end"]) == (0, job["source"]["metadata"]["duration"])
    assert all(segment["captions"] is False and segment["framing"] for segment in segments[1:])


def test_a_projects_ranges_are_kept_as_given_not_snapped_to_words(client, speech, clip, wait_for_status):
    media = add_media(client, clip)
    job = wait_for_status(open_project(client, speech.video, [media]).json()["id"], "review", "error")
    [candidate] = job["candidates"]
    video = candidate["segments"][1]

    # 1.6–2.7 s lies in the pause after "halo semua": a Job would refuse it, finding no Words there.
    response = client.patch(
        f"/api/jobs/{job['id']}/candidates/{candidate['id']}",
        json={"segments": [{"id": "s0", "start": 1.6, "end": 2.7}, video]},
    )
    assert response.status_code == 200, response.text
    assert [(s["start"], s["end"]) for s in response.json()["segments"]][0] == (1.6, 2.7)


def test_projects_and_clipper_jobs_are_listed_apart(client, speech, wait_for_status):
    project = open_project(client, speech.video, []).json()
    with speech.video.open("rb") as file:
        clipper = client.post("/api/jobs/upload", data={"options": json.dumps(OPTIONS)}, files={"file": ("a.mp4", file, "video/mp4")}).json()

    assert [job["id"] for job in client.get("/api/jobs", params={"project": "true"}).json()] == [project["id"]]
    assert [job["id"] for job in client.get("/api/jobs", params={"project": "false"}).json()] == [clipper["id"]]
    assert {job["id"] for job in client.get("/api/jobs").json()} == {project["id"], clipper["id"]}
    wait_for_status(project["id"], "review", "error")
    wait_for_status(clipper["id"], "review", "error")


def test_a_project_of_a_video_not_in_the_media_library_is_refused(client, speech):
    response = open_project(client, speech.video, ["0" * 32])
    assert response.status_code == 422
    assert response.json()["detail"] == f"No video {'0' * 32} in the Media Library"
    assert client.get("/api/jobs").json() == []
