"""Seam A: Jobs that fail, are interrupted, run out of Gemini quota or are deleted, through the HTTP
API with call-counting fakes at the ports; and the disk endpoint."""

import re
import shutil
import time
from contextlib import ExitStack
from dataclasses import replace
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.jobs import JobOptions, JobStatus, JobStore
from app.llm import LlmError, Overloaded, QuotaExceeded
from app.main import create_app
from app.pipeline import Pipeline
from app.ports import Ports
from app.profile import ChannelProfile
from conftest import caption_track, wait_for
from fakes import windows_in
from test_evaluation import entry
from test_jobs_api import URL, create_job, statuses

REJECTED = LlmError("Gemini rejected the request. 400 INVALID_ARGUMENT: Request contains an invalid argument.")
QUOTA = QuotaExceeded("Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: Quota exceeded.")
BUSY = Overloaded("Gemini is busy. 503 UNAVAILABLE: This model is currently experiencing high demand.")
G = "https://www.youtube.com/watch?v=GGGGGGGGGGG"


def retry(client, job_id: str) -> dict:
    response = client.post(f"/api/jobs/{job_id}/retry")
    assert response.status_code == 200, response.text
    return response.json()


def times(job: dict, status: str) -> list[datetime]:
    return [datetime.fromisoformat(change["at"]) for change in job["history"] if change["status"] == status]


def waits(job: dict) -> list[float]:
    """How long each quota wait lasted: from entering `waiting_quota` to being queued again."""
    return [(queued - wait).total_seconds() for wait, queued in zip(times(job, "waiting_quota"), times(job, "queued")[1:])]


def window_ids(prompts: list[str]) -> list[str]:
    return [id for prompt in prompts for id, *_ in windows_in(prompt)]


def test_a_retry_after_an_analyzing_failure_resumes_there_without_fetching_or_transcribing_again(
    client, video_source, speech, transcriber, llm, wait_for_status
):
    video_source.video, video_source.caption_track = speech.video, None
    llm.fail_with(REJECTED)
    failed = wait_for_status(create_job(client)["id"], "review", "error")
    assert (failed["status"], failed["stage"], failed["error"]) == ("error", "analyzing", str(REJECTED))
    transcribed = list(transcriber.calls)
    assert transcribed

    queued = retry(client, failed["id"])
    assert (queued["status"], queued["stage"], queued["error"]) == ("queued", None, None)
    job = wait_for_status(failed["id"], "review", "error")

    assert statuses(job) == [
        "queued", "downloading", "transcribing", "analyzing", "error", "queued", "analyzing", "review",
    ]
    assert len(video_source.calls) == 1
    assert transcriber.calls == transcribed
    assert job["transcript"] == failed["transcript"]
    assert job["candidates"] is not None


def test_a_download_failure_hints_at_updating_the_downloader_and_a_retry_downloads_again(
    client, video_source, wait_for_status
):
    video_source.fail_with(RuntimeError("ERROR: [youtube] fixture: Sign in to confirm you're not a bot."))
    failed = wait_for_status(create_job(client)["id"], "review", "error")
    assert (failed["status"], failed["stage"]) == ("error", "downloading")
    assert failed["error"] == (
        "ERROR: [youtube] fixture: Sign in to confirm you're not a bot. If YouTube changed something, "
        "updating the downloader may fix it: run `make update-ytdlp`, then retry."
    )

    video_source.fail_with(None)
    retry(client, failed["id"])
    job = wait_for_status(failed["id"], "review", "error")
    assert statuses(job) == [
        "queued", "downloading", "error", "queued", "downloading", "transcribing", "analyzing", "review",
    ]
    assert len(video_source.calls) == 2


def test_only_a_job_in_error_can_be_retried(client, wait_for_status):
    job = wait_for_status(create_job(client)["id"], "review", "error")

    response = client.post(f"/api/jobs/{job['id']}/retry")
    assert response.status_code == 409
    assert response.json()["detail"] == f"Job {job['id']} is review: only a Job in error can be retried"
    assert client.get(f"/api/jobs/{job['id']}").json()["history"] == job["history"]
    assert client.post("/api/jobs/0123456789ab/retry").status_code == 404
    assert client.post("/api/jobs/not-a-job/retry").status_code == 404


def test_score_batches_answered_before_a_failure_are_not_sent_again(
    client, settings, video_source, transcriber, from_episode, llm, wait_for_status
):
    llm.fail_with(REJECTED, after=2)
    failed = wait_for_status(create_job(client)["id"], "review", "error")
    assert (failed["status"], failed["stage"]) == ("error", "analyzing")
    *answered, failing = [request.prompt for request in llm.score_requests]
    assert len(answered) == 2

    retry(client, failed["id"])
    job = wait_for_status(failed["id"], "review", "error")
    assert job["status"] == "review"
    resent = [request.prompt for request in llm.score_requests[3:]]
    assert resent[0] == failing
    assert not set(answered) & set(resent)
    # Between them, the two runs scored every Window once, in order.
    batches = answered + resent
    assert len(batches) > 3
    assert window_ids(batches) == [f"w{i:03}" for i in range(1, len(window_ids(batches)) + 1)]

    # Once the stage is done, its answers aren't kept: analyzing again (`make reanalyze`) asks anew.
    before = len(llm.score_requests)
    Pipeline(JobStore(settings.data_dir / "jobs"), Ports(video_source, transcriber, llm), settings).run(job["id"])
    assert [request.prompt for request in llm.score_requests[before:]] == batches


def test_kept_score_answers_are_not_used_once_the_profile_snapshot_changes(
    client, settings, from_episode, llm, wait_for_status
):
    llm.fail_with(REJECTED, after=2)
    failed = wait_for_status(create_job(client)["id"], "review", "error")
    # The eval gives a Job it reuses the current profile like this.
    JobStore(settings.data_dir / "jobs").update(failed["id"], profile=ChannelProfile(niche="Podcast horor"))
    before = len(llm.score_requests)

    retry(client, failed["id"])
    assert wait_for_status(failed["id"], "review", "error")["status"] == "review"
    resent = [request.prompt for request in llm.score_requests[before:]]
    assert all("Niche: Podcast horor." in prompt for prompt in resent)
    assert window_ids(resent)[0] == "w001"


@pytest.mark.parametrize(
    ("first", "then"),
    [
        # The same model, at a host that isn't sent DeepSeek's thinking parameter: only the provider differs.
        ({"llm_provider": "gemini"}, {"llm_provider": "openai", "llm_base_url": "https://api.openai.com/v1"}),
        ({"llm_thinking": False}, {"llm_thinking": True}),
    ],
    ids=["provider", "thinking"],
)
def test_kept_score_answers_are_not_used_by_another_llm(
    settings, video_source, transcriber, from_episode, llm, first, then
):
    store = JobStore(settings.data_dir / "jobs")
    ports = Ports(video_source, transcriber, llm)
    deepseek = replace(
        settings, llm_provider="openai", llm_base_url="https://api.deepseek.com", llm_model=settings.gemini_model
    )
    job = store.create(URL, JobOptions(), ChannelProfile())
    llm.fail_with(REJECTED, after=2)
    assert Pipeline(store, ports, replace(deepseek, **first)).run(job.id).status is JobStatus.ERROR
    before = len(llm.score_requests)

    assert Pipeline(store, ports, replace(deepseek, **then)).run(job.id).status is JobStatus.REVIEW
    assert window_ids([request.prompt for request in llm.score_requests[before:]])[0] == "w001"


def test_a_job_out_of_quota_waits_ever_longer_then_reaches_review(client, llm, wait_for_status):
    llm.fail_with(QUOTA, times=3)
    job_id = create_job(client)["id"]

    waiting = wait_for_status(job_id, "waiting_quota", "review", "error")
    assert (waiting["status"], waiting["stage"]) == ("waiting_quota", "analyzing")
    expected = rf"Trying again at \d\d:\d\d:\d\d \(in 0\.\d+ s\)\. {re.escape(str(QUOTA))}"
    assert re.fullmatch(expected, waiting["message"])
    assert waiting["quota"]["errors"] >= 1

    job = wait_for_status(job_id, "review", "error")
    assert statuses(job) == [
        "queued", "downloading", "transcribing", "analyzing",
        *["waiting_quota", "queued", "analyzing"] * 3,
        "review",
    ]
    # 0.05 s, then twice as long each time, up to 0.2 s.
    assert [round(wait, 2) >= expected for wait, expected in zip(waits(job), [0.05, 0.1, 0.2])] == [True] * 3
    assert (job["quota"], job["message"]) == (None, None)
    assert (len(llm.score_requests), len(llm.detail_requests)) == (4, 1)


def test_a_quota_error_after_another_batch_was_answered_waits_the_first_wait_again(
    client, from_episode, llm, wait_for_status
):
    llm.fail_with(QUOTA, after=2)
    llm.fail_with(QUOTA, after=1)  # the third batch is answered on the second try, the fourth isn't
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert statuses(job).count("waiting_quota") == 2
    first, second = waits(job)
    assert round(first, 2) >= 0.05 and round(second, 2) >= 0.05
    assert second < 0.09


@pytest.mark.quota(wait_secs=60)
def test_other_jobs_run_while_a_job_waits_for_quota(client, llm, wait_for_status):
    llm.fail_with(QUOTA)
    waiting = create_job(client, "https://youtu.be/first")
    other = create_job(client, "https://youtu.be/second")

    other = wait_for_status(other["id"], "review", "error")
    waiting = client.get(f"/api/jobs/{waiting['id']}").json()
    assert (other["status"], waiting["status"]) == ("review", "waiting_quota")
    assert times(other, "downloading")[0] > times(waiting, "waiting_quota")[0]

    # A Job waiting for quota can be deleted: it stops waiting.
    assert client.delete(f"/api/jobs/{waiting['id']}").status_code == 204
    assert [job["id"] for job in client.get("/api/jobs").json()] == [other["id"]]


@pytest.mark.quota(give_up_secs=0.25)
def test_quota_errors_that_go_on_too_long_put_the_job_in_error(client, llm, wait_for_status):
    llm.fail_with(QUOTA, times=100)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"], job["quota"]) == ("error", "analyzing", None)
    assert job["error"] == f"Gave up after waiting 0.25 s for Gemini's quota. {QUOTA}"
    # Waits of 0.05, 0.1 and 0.2 s: the error after the third comes 0.35 s after the first.
    assert statuses(job).count("waiting_quota") == 3
    assert len(llm.score_requests) == 4


def test_a_quota_error_that_suggests_a_wait_waits_that_long_instead(client, llm, wait_for_status):
    llm.fail_with(QuotaExceeded(str(QUOTA), retry_after=0.25))
    llm.fail_with(QUOTA)
    job_id = create_job(client)["id"]

    waiting = wait_for_status(job_id, "waiting_quota", "review", "error")
    # The suggested 0.25 s and the margin of 0.01 s, not the first wait of 0.05 s.
    expected = rf"Trying again at \d\d:\d\d:\d\d \(in 0\.26 s\)\. {re.escape(str(QUOTA))}"
    assert re.fullmatch(expected, waiting["message"])

    job = wait_for_status(job_id, "review", "error")
    assert job["status"] == "review"
    first, second = waits(job)
    assert round(first, 2) >= 0.26
    # The second error suggests nothing: the second wait of the schedule, 0.1 s.
    assert 0.1 <= round(second, 2) < 0.25


@pytest.mark.quota(wait_secs=0.2)
def test_gemini_busy_past_the_retries_puts_the_job_in_a_wait_that_keeps_its_answered_batches(
    client, settings, from_episode, llm, wait_for_status
):
    llm.fail_with(BUSY, times=settings.selection.llm_attempts, after=2)
    job_id = create_job(client)["id"]

    waiting = wait_for_status(job_id, "waiting_quota", "review", "error")
    assert (waiting["status"], waiting["stage"], waiting["quota"]["errors"]) == ("waiting_quota", "analyzing", 1)
    expected = rf"Trying again at \d\d:\d\d:\d\d \(in 0\.2 s\)\. {re.escape(str(BUSY))}"
    assert re.fullmatch(expected, waiting["message"])

    job = wait_for_status(job_id, "review", "error")
    assert statuses(job) == [
        "queued", "downloading", "transcribing", "analyzing", "waiting_quota", "queued", "analyzing", "review",
    ]
    prompts = [request.prompt for request in llm.score_requests]
    answered, busy, resent = prompts[:2], prompts[2:7], prompts[7:]
    assert busy == [busy[0]] * settings.selection.llm_attempts
    assert resent[0] == busy[0]
    assert not set(answered) & set(resent)
    batches = answered + resent
    assert window_ids(batches) == [f"w{i:03}" for i in range(1, len(window_ids(batches)) + 1)]


@pytest.mark.quota(request_interval_secs=0.05)
def test_llm_requests_are_paced(client, from_episode, llm, wait_for_status):
    assert wait_for_status(create_job(client)["id"], "review", "error")["status"] == "review"

    assert len(llm.sent) > 3
    assert min(later - earlier for earlier, later in zip(llm.sent, llm.sent[1:])) >= 0.045


def test_jobs_left_unfinished_by_a_previous_process_resume_from_their_last_completed_stage(
    settings, video_source, transcriber, llm
):
    store = JobStore(settings.data_dir / "jobs")
    ports = Ports(video_source, transcriber, llm)

    def job(name: str):
        return store.create(f"https://youtu.be/{name}", JobOptions(), ChannelProfile())

    # Each Job is left as a process that stopped in the middle of it leaves it.
    analyzing = job("analyzing")
    llm.fail_with(REJECTED)
    Pipeline(store, ports, settings).run(analyzing.id)
    store.update(analyzing.id, status=JobStatus.ANALYZING)
    transcribing = job("transcribing")
    source = video_source.fetch(transcribing.url, "id", store.job_dir(transcribing.id))
    store.update(transcribing.id, status=JobStatus.TRANSCRIBING, stage=JobStatus.TRANSCRIBING, source=source)
    downloading = job("downloading")
    store.update(downloading.id, status=JobStatus.DOWNLOADING, stage=JobStatus.DOWNLOADING)
    (store.job_dir(downloading.id) / "source.f137.mp4.part").write_bytes(bytes(1000))
    queued = job("queued")
    fetched = len(video_source.calls)
    transcript = store.load_transcript(analyzing.id)

    with TestClient(create_app(settings, ports)) as client:
        left = (analyzing, transcribing, downloading, queued)
        jobs = {job.id: wait_for(client, job.id, "review", "error") for job in left}

    assert [job["status"] for job in jobs.values()] == ["review"] * 4
    # Only the Jobs whose download hadn't completed are fetched, oldest first.
    assert [url for url, _ in video_source.calls[fetched:]] == ["https://youtu.be/downloading", "https://youtu.be/queued"]
    assert statuses(jobs[analyzing.id])[-3:] == ["queued", "analyzing", "review"]
    assert store.load_transcript(analyzing.id) == transcript
    assert statuses(jobs[transcribing.id]) == ["queued", "transcribing", "queued", "transcribing", "analyzing", "review"]
    assert statuses(jobs[downloading.id])[-5:] == ["queued", "downloading", "transcribing", "analyzing", "review"]
    assert transcriber.calls == []


@pytest.mark.quota(wait_secs=0.3)
def test_a_job_waiting_for_quota_waits_out_the_rest_of_its_wait_after_a_restart(
    settings, video_source, transcriber, llm
):
    store = JobStore(settings.data_dir / "jobs")
    ports = Ports(video_source, transcriber, llm)
    job = store.create(URL, JobOptions(), ChannelProfile())
    llm.fail_with(QUOTA)
    left = Pipeline(store, ports, settings).run(job.id)
    assert left.status is JobStatus.WAITING_QUOTA

    with TestClient(create_app(settings, ports)) as client:
        done = wait_for(client, job.id, "review", "error")

    assert statuses(done)[-5:] == ["analyzing", "waiting_quota", "queued", "analyzing", "review"]
    assert times(done, "queued")[-1] >= left.quota.retry_at
    assert len(video_source.calls) == 1


def test_a_job_another_process_is_running_is_left_to_it_on_start_up(settings, video_source, transcriber, llm):
    store = JobStore(settings.data_dir / "jobs")
    job = store.create(URL, JobOptions(), ChannelProfile())
    store.update(job.id, status=JobStatus.DOWNLOADING, stage=JobStatus.DOWNLOADING)

    with store.running(job.id), TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        assert statuses(client.get(f"/api/jobs/{job.id}").json()) == ["queued", "downloading"]
    assert video_source.calls == []


def test_a_job_the_other_process_leaves_unfinished_is_taken_back_when_it_lets_go(settings, video_source, transcriber, llm):
    # As a server still shutting down at a restart leaves a Job when it dies mid-download.
    store = JobStore(settings.data_dir / "jobs")
    job = store.create(URL, JobOptions(), ChannelProfile())
    store.update(job.id, status=JobStatus.DOWNLOADING, stage=JobStatus.DOWNLOADING)

    other = ExitStack()
    other.enter_context(store.running(job.id))
    with other, TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        assert client.get(f"/api/jobs/{job.id}").json()["status"] == "downloading"
        other.close()
        done = wait_for(client, job.id, "review", "error")

    assert statuses(done)[-5:] == ["queued", "downloading", "transcribing", "analyzing", "review"]
    assert [url for url, _ in video_source.calls] == [URL]


def test_a_job_the_other_process_finishes_is_not_run_again_when_it_lets_go(settings, video_source, transcriber, llm):
    store = JobStore(settings.data_dir / "jobs")
    job = store.create(URL, JobOptions(), ChannelProfile())
    store.update(job.id, status=JobStatus.DOWNLOADING, stage=JobStatus.DOWNLOADING)

    other = ExitStack()
    other.enter_context(store.running(job.id))
    with other, TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        store.update(job.id, status=JobStatus.ERROR, stage=JobStatus.DOWNLOADING, error="Download failed")
        other.close()
        time.sleep(0.3)
        assert client.get(f"/api/jobs/{job.id}").json()["status"] == "error"
    assert video_source.calls == []


def test_deleting_a_job_removes_its_files_and_its_listing(client, settings, wait_for_status):
    kept = wait_for_status(create_job(client, "https://youtu.be/kept")["id"], "review", "error")
    job = wait_for_status(create_job(client)["id"], "review", "error")
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert {"job.json", "source.mp4", "transcript.json", "candidates.json"} <= {path.name for path in job_dir.iterdir()}

    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert not job_dir.exists()
    assert client.get(f"/api/jobs/{job['id']}").status_code == 404
    assert [listed["id"] for listed in client.get("/api/jobs").json()] == [kept["id"]]
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 404
    assert client.delete("/api/jobs/not-a-job").status_code == 404


def test_a_job_cannot_be_deleted_while_a_stage_runs_but_can_while_queued(
    client, settings, video_source, wait_for_status
):
    video_source.hold()
    running = create_job(client, "https://youtu.be/first")
    wait_for_status(running["id"], "downloading")
    queued = create_job(client, "https://youtu.be/second")

    response = client.delete(f"/api/jobs/{running['id']}")
    assert response.status_code == 409
    assert response.json()["detail"] == (
        f"Job {running['id']} is downloading: wait until its stage ends or fails, then delete it"
    )
    assert (settings.data_dir / "jobs" / running["id"]).is_dir()
    assert client.delete(f"/api/jobs/{queued['id']}").status_code == 204

    video_source.release()
    assert wait_for_status(running["id"], "review", "error")["status"] == "review"
    third = wait_for_status(create_job(client, "https://youtu.be/third")["id"], "review", "error")
    # The deleted Job never ran.
    assert [url for url, _ in video_source.calls] == ["https://youtu.be/first", "https://youtu.be/third"]
    assert client.delete(f"/api/jobs/{running['id']}").status_code == 204
    assert [listed["id"] for listed in client.get("/api/jobs").json()] == [third["id"]]


def test_disk_endpoint_reports_the_data_directory_usage_the_free_space_and_a_low_space_warning(
    client, settings, video_source, transcriber, llm, wait_for_status
):
    wait_for_status(create_job(client)["id"], "review", "error")

    disk = client.get("/api/system/disk").json()
    volume = shutil.disk_usage(settings.data_dir)
    files = [path for path in settings.data_dir.rglob("*") if path.is_file()]
    assert disk["used_bytes"] == sum(path.stat().st_size for path in files) > 0
    assert disk["total_bytes"] == volume.total
    assert abs(disk["free_bytes"] - volume.free) < 10**9
    assert disk["warning_below_bytes"] == 10 * 10**9
    assert disk["warning"] is (disk["free_bytes"] < 10 * 10**9)

    for threshold, warning in [(volume.total + 1, True), (0, False)]:
        app = create_app(replace(settings, low_disk_bytes=threshold), Ports(video_source, transcriber, llm))
        with TestClient(app) as other:
            assert other.get("/api/system/disk").json()["warning"] is warning


@pytest.mark.tuning(budget_secs=0.3)
def test_a_stage_that_runs_again_replaces_its_own_warnings_only(
    client, settings, video_source, speech, transcriber, llm, tmp_path, wait_for_status
):
    video_source.video, video_source.caption_track = speech.video, None
    transcriber.stall(2)
    video_source.captions[G] = None
    settings.reference_set.write_text(entry(G, "0:10", "0:18", "contoh", "fewshot"))
    llm.fail_with(REJECTED)
    failed = wait_for_status(create_job(client)["id"], "review", "error")
    assert [warning["stage"] for warning in failed["warnings"]] == ["transcribing", "analyzing"]

    # The few-shot episode has captions by the time the Job is retried.
    video_source.captions[G] = caption_track(tmp_path / "fewshot.json3", [(10, "ini contoh lucu banget")])
    retry(client, failed["id"])
    job = wait_for_status(failed["id"], "review", "error")
    assert job["status"] == "review"
    assert job["warnings"] == failed["warnings"][:1]


def test_the_cli_retries_a_failed_job_from_the_stage_it_failed_in_and_waits_out_quota(
    settings, video_source, transcriber, llm, monkeypatch, capsys
):
    monkeypatch.setattr(cli, "load_settings", lambda: settings)
    monkeypatch.setattr(cli, "real_ports", lambda _: Ports(video_source, transcriber, llm))
    llm.fail_with(REJECTED)
    assert cli.main(["analyze", URL]) == 1
    output = capsys.readouterr().out
    assert f"Error while analyzing: {REJECTED}" in output
    job_id = re.search(r"^Job ([0-9a-f]{12}) in ", output, re.M)[1]

    llm.fail_with(QUOTA)
    assert cli.main(["retry", job_id]) == 0
    assert "Status: review" in capsys.readouterr().out
    job = JobStore(settings.data_dir / "jobs").get(job_id)
    assert [change.status for change in job.history] == [
        "queued", "downloading", "transcribing", "analyzing", "error", "analyzing", "waiting_quota", "analyzing", "review",
    ]
    assert len(video_source.calls) == 1

    assert cli.main(["retry", job_id]) == 1
    assert "nothing to retry" in capsys.readouterr().out


def test_the_cli_waits_while_gemini_is_busy_and_says_so(settings, video_source, transcriber, llm, monkeypatch, capsys):
    monkeypatch.setattr(cli, "load_settings", lambda: settings)
    monkeypatch.setattr(cli, "real_ports", lambda _: Ports(video_source, transcriber, llm))
    llm.fail_with(BUSY, times=settings.selection.llm_attempts)

    assert cli.main(["analyze", URL]) == 0
    output = capsys.readouterr().out
    expected = rf"^Waiting for Gemini: Trying again at \d\d:\d\d:\d\d \(in 0\.05 s\)\. {re.escape(str(BUSY))}$"
    assert re.search(expected, output, re.M)
    assert "Status: review" in output
