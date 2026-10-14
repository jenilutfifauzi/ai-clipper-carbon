"""Seam A: the Job lifecycle through the HTTP API, with a fake Video Source."""

import json
from itertools import groupby

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


def test_job_moves_from_queued_through_downloading_transcribing_and_analyzing_to_review(
    client, video_source, wait_for_status
):
    video_source.hold()
    job = create_job(client)
    assert job["status"] == "queued"

    assert wait_for_status(job["id"], "downloading")["stage"] == "downloading"
    video_source.release()
    job = wait_for_status(job["id"], "review", "error")

    assert statuses(job) == ["queued", "downloading", "transcribing", "analyzing", "review"]
    assert job["stage"] is None
    assert job["error"] is None


def test_the_download_reports_its_progress_in_whole_percents(client, video_source, wait_for_status):
    video_source.progress_steps = [0.0, 0.004, 0.25, 0.251, 0.5, 1.0]
    seen = []
    with client.app.state.store.watch(lambda job_id, job: job and seen.append((job.status, job.progress))):
        job = wait_for_status(create_job(client)["id"], "review", "error")

    assert job["status"] == "review" and job["progress"] is None
    downloading = [progress for status, progress in seen if status == "downloading" and progress is not None]
    assert [progress for progress, _ in groupby(downloading)] == [0, 25, 50, 100]  # each change once


def test_job_returns_source_metadata_and_transcript_words(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "review", "error")

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
    assert wait_for_status(english["id"], "review", "error")["transcript"]["language"] == "en"
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
    first = wait_for_status(first["id"], "review", "error")
    second = wait_for_status(second["id"], "review", "error")
    assert statuses(second) == ["queued", "downloading", "transcribing", "analyzing", "review"]
    assert at(second, "downloading") >= at(first, "review")
    assert [url for url, _ in video_source.calls] == ["https://youtu.be/first", "https://youtu.be/second"]


def test_listing_jobs_leaves_out_transcripts_and_candidates(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "review", "error")

    [listed] = client.get("/api/jobs").json()
    assert listed["id"] == job["id"]
    assert listed["status"] == "review"
    assert "transcript" not in listed
    assert "candidates" not in listed


def test_jobs_are_listed_a_page_at_a_time_before_the_last_one_listed(client, video_source):
    video_source.hold()
    ids = [create_job(client, f"https://youtu.be/job{n}")["id"] for n in range(5)]
    newest_first = ids[::-1]

    first = client.get("/api/jobs", params={"limit": 2}).json()
    assert [job["id"] for job in first] == newest_first[:2]
    second = client.get("/api/jobs", params={"limit": 2, "before": first[-1]["created_at"]}).json()
    assert [job["id"] for job in second] == newest_first[2:4]
    last = client.get("/api/jobs", params={"limit": 2, "before": second[-1]["created_at"]}).json()
    assert [job["id"] for job in last] == newest_first[4:]
    assert [job["id"] for job in client.get("/api/jobs").json()] == newest_first


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"before": "2026-01-01T00:00:00"}])
def test_a_page_of_jobs_needs_a_sensible_limit_and_a_cursor_with_a_timezone(client, params):
    assert client.get("/api/jobs", params=params).status_code == 422


def test_failing_source_puts_the_job_in_error_and_the_next_job_still_runs(client, video_source, wait_for_status):
    video_source.fail_with(RuntimeError("Video unavailable"))
    failed = wait_for_status(create_job(client)["id"], "review", "error")

    assert failed["status"] == "error"
    assert failed["stage"] == "downloading"
    assert failed["error"].startswith("Video unavailable. ")
    assert statuses(failed) == ["queued", "downloading", "error"]
    assert failed["transcript"] is None
    assert failed["candidates"] is None

    video_source.fail_with(None)
    assert wait_for_status(create_job(client)["id"], "review", "error")["status"] == "review"


def test_job_saved_before_selection_existed_reads_as_stopped_before_analyzing(client, settings):
    stamp = "2026-10-13T12:00:00Z"
    history = [{"status": status, "at": stamp} for status in ("queued", "downloading", "transcribing", "transcribed")]
    job_dir = settings.data_dir / "jobs" / "0123456789ab"
    job_dir.mkdir(parents=True)
    state = {"id": "0123456789ab", "url": URL, "options": {}, "created_at": stamp, "updated_at": stamp}
    (job_dir / "job.json").write_text(json.dumps(state | {"status": "transcribed", "history": history}))

    job = client.get("/api/jobs/0123456789ab").json()
    assert (job["status"], job["stage"]) == ("error", "analyzing")
    assert job["error"] == "Not analyzed yet: run `make reanalyze JOB=0123456789ab`"
    assert statuses(job) == ["queued", "downloading", "transcribing", "error"]
    assert [listed["status"] for listed in client.get("/api/jobs").json()] == ["error"]


def test_unknown_job_is_not_found(client):
    assert client.get("/api/jobs/0123456789ab").status_code == 404
    assert client.get("/api/jobs/not-a-job").status_code == 404


def test_caption_events_without_a_duration_end_at_the_next_event(client, video_source, tmp_path, wait_for_status):
    track = tmp_path / "no-duration.json3"
    track.write_text(
        '{"events": ['
        '{"tStartMs": 0, "segs": [{"utf8": "halo"}, {"utf8": " semua", "tOffsetMs": 400}]},'
        '{"tStartMs": 1000, "dDurationMs": 500, "segs": [{"utf8": "apa"}]},'
        '{"tStartMs": 1600, "segs": [{"utf8": "kabar"}]}'
        "]}"
    )
    video_source.caption_track = track

    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert [(w["text"], w["start"], w["end"]) for w in job["transcript"]["words"]] == [
        ("halo", 0, 0.4),
        ("semua", 0.4, 1.0),
        ("apa", 1.0, 1.5),
        ("kabar", 1.6, 1.6),
    ]
