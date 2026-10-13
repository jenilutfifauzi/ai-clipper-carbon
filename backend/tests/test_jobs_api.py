"""Seam A: the Job lifecycle through the HTTP API, with a fake Video Source."""

import pytest

URL = "https://www.youtube.com/watch?v=fixture"

# tests/fixtures/captions.json3, parsed: start = event start + offset; end = next word's start,
# capped at the event's end ("soal", "ya"); line breaks and the whitespace-only seg are skipped.
WORDS = [
    {"text": "halo", "start": 0.1, "end": 0.5},
    {"text": "semua", "start": 0.5, "end": 1.0},
    {"text": "apa", "start": 1.0, "end": 1.3},
    {"text": "kabar", "start": 1.3, "end": 1.6},
    {"text": "kita", "start": 1.6, "end": 1.9},
    {"text": "ngobrol", "start": 1.9, "end": 2.3},
    {"text": "soal", "start": 2.3, "end": 2.6},
    {"text": "Podcast", "start": 4.0, "end": 4.5},
    {"text": "ya", "start": 4.5, "end": 6.0},
]
SEGMENTS = [
    {"text": "halo semua apa kabar", "start": 0.1, "end": 1.6},
    {"text": "kita ngobrol soal", "start": 1.6, "end": 2.6},
    {"text": "Podcast ya", "start": 4.0, "end": 6.0},
]


def create_job(client, url: str = URL, **options) -> dict:
    response = client.post("/api/jobs", json={"url": url, "options": options})
    assert response.status_code == 201, response.text
    return response.json()


def statuses(job: dict) -> list[str]:
    return [change["status"] for change in job["history"]]


def at(job: dict, status: str) -> str:
    return next(change["at"] for change in job["history"] if change["status"] == status)


def test_job_moves_from_queued_through_downloading_and_transcribing(client, video_source, wait_for_status):
    video_source.hold()
    job = create_job(client)
    assert job["status"] == "queued"

    assert wait_for_status(job["id"], "downloading")["stage"] == "downloading"
    video_source.release()
    job = wait_for_status(job["id"], "transcribed", "error")

    assert statuses(job) == ["queued", "downloading", "transcribing", "transcribed"]
    assert job["stage"] is None
    assert job["error"] is None


def test_job_returns_source_metadata_and_transcript_words(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "transcribed", "error")

    assert job["source"]["metadata"] == {
        "duration": pytest.approx(2, abs=0.1),
        "fps": 25,
        "width": 320,
        "height": 180,
        "codec": "h264",
    }
    transcript = job["transcript"]
    assert (transcript["language"], transcript["source"]) == ("id", "youtube")
    assert transcript["words"] == WORDS
    assert transcript["segments"] == SEGMENTS


def test_language_defaults_to_indonesian_and_can_be_overridden(client, video_source, wait_for_status):
    default = create_job(client)
    english = create_job(client, language="en")

    assert default["options"]["language"] == "id"
    assert english["options"]["language"] == "en"
    assert wait_for_status(english["id"], "transcribed", "error")["transcript"]["language"] == "en"
    assert [language for _, language in video_source.calls] == ["id", "en"]


def test_job_stores_the_options_it_was_created_with(client):
    options = {
        "language": "id",
        "min_secs": 30,
        "max_secs": 60,
        "captions": False,
        "brief": "find the funny moments",
        "transcribe_locally": True,
    }
    job = create_job(client, **options)

    assert job["options"] == options
    assert client.get(f"/api/jobs/{job['id']}").json()["options"] == options


@pytest.mark.parametrize(
    "body",
    [
        {"url": " "},
        {"url": URL, "options": {"min_secs": 60, "max_secs": 30}},
        {"url": URL, "options": {"min_secs": 0}},
        {"url": URL, "options": {"language": "id.*"}},
    ],
)
def test_invalid_job_requests_are_rejected(client, body):
    assert client.post("/api/jobs", json=body).status_code == 422
    assert client.get("/api/jobs").json() == []


def test_second_job_stays_queued_until_the_first_finishes(client, video_source, wait_for_status):
    video_source.hold()
    first = create_job(client, "https://youtu.be/first")
    wait_for_status(first["id"], "downloading")
    second = create_job(client, "https://youtu.be/second")

    jobs = client.get("/api/jobs").json()
    assert [(job["id"], job["status"]) for job in jobs] == [(second["id"], "queued"), (first["id"], "downloading")]

    video_source.release()
    first = wait_for_status(first["id"], "transcribed", "error")
    second = wait_for_status(second["id"], "transcribed", "error")
    assert statuses(second) == ["queued", "downloading", "transcribing", "transcribed"]
    assert at(second, "downloading") >= at(first, "transcribed")
    assert [url for url, _ in video_source.calls] == ["https://youtu.be/first", "https://youtu.be/second"]


def test_listing_jobs_leaves_out_transcripts(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "transcribed", "error")

    [listed] = client.get("/api/jobs").json()
    assert listed["id"] == job["id"]
    assert listed["status"] == "transcribed"
    assert "transcript" not in listed


def test_failing_source_puts_the_job_in_error_and_the_next_job_still_runs(client, video_source, wait_for_status):
    video_source.fail_with(RuntimeError("Video unavailable"))
    failed = wait_for_status(create_job(client)["id"], "transcribed", "error")

    assert failed["status"] == "error"
    assert (failed["stage"], failed["error"]) == ("downloading", "Video unavailable")
    assert statuses(failed) == ["queued", "downloading", "error"]
    assert failed["transcript"] is None

    video_source.fail_with(None)
    assert wait_for_status(create_job(client)["id"], "transcribed", "error")["status"] == "transcribed"


def test_unknown_job_is_not_found(client):
    assert client.get("/api/jobs/0123456789ab").status_code == 404
    assert client.get("/api/jobs/not-a-job").status_code == 404
