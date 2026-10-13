"""Seam A: local transcription through the HTTP API, with a fake Transcriber.

The Source is the speech fixture: real speech and pauses, so chunks are cut by real ffmpeg and
Silero VAD. The fake Transcriber hears the fixture's words that overlap each chunk, so a chunk
that ended inside a word would show up as a duplicated, clipped word.
"""

import time
from dataclasses import asdict

import pytest

from app.transcript import Word
from test_jobs_api import create_job, statuses


def as_json(words: list[Word]) -> list[dict]:
    return [asdict(word) for word in words]


@pytest.fixture
def uncaptioned(video_source, speech) -> None:
    """The Video Source returns the speech fixture, without a caption track."""
    video_source.video = speech.video
    video_source.caption_track = None


def test_source_without_captions_is_transcribed_locally_in_chunks(
    client, uncaptioned, speech, transcriber, wait_for_status
):
    job = wait_for_status(create_job(client)["id"], "transcribed", "error")

    assert statuses(job) == ["queued", "downloading", "transcribing", "transcribed"]
    transcript = job["transcript"]
    assert (transcript["language"], transcript["source"]) == ("id", "whisper")
    assert transcript["words"] == as_json(speech.words)
    assert " ".join(segment["text"] for segment in transcript["segments"]) == " ".join(w.text for w in speech.words)
    assert (job["warnings"], job["progress"], job["message"]) == ([], None, None)

    # Consecutive chunks, in the Job's language, covering the whole Source.
    assert len(transcriber.calls) > 1
    assert {language for language, _, _ in transcriber.calls} == {"id"}
    starts = [start for _, start, _ in transcriber.calls]
    ends = [end for _, _, end in transcriber.calls]
    assert starts[0] == 0
    assert starts[1:] == ends[:-1]
    assert ends[-1] == pytest.approx(job["source"]["metadata"]["duration"])


def test_transcribe_locally_ignores_youtube_captions(client, video_source, speech, wait_for_status):
    video_source.video = speech.video
    job = wait_for_status(create_job(client, transcribe_locally=True, language="en")["id"], "transcribed", "error")

    assert job["source"]["caption_track"] is not None
    assert (job["transcript"]["language"], job["transcript"]["source"]) == ("en", "whisper")
    assert job["transcript"]["words"] == as_json(speech.words)


def test_progress_and_a_hint_to_close_heavy_apps_are_reported(client, uncaptioned, transcriber, wait_for_status):
    transcriber.hold(after=1)
    job_id = create_job(client)["id"]

    deadline = time.monotonic() + 5
    while not (job := client.get(f"/api/jobs/{job_id}").json())["progress"]:
        assert time.monotonic() < deadline, f"No progress reported: {job}"
        time.sleep(0.01)
    assert job["status"] == "transcribing"
    assert 0 < job["progress"] < 100
    assert "close heavy apps" in job["message"].lower()

    transcriber.release()
    job = wait_for_status(job_id, "transcribed", "error")
    assert (job["status"], job["progress"], job["message"]) == ("transcribed", None, None)


@pytest.mark.tuning(budget_secs=0.3)
def test_chunk_that_stalls_once_is_retried(client, uncaptioned, speech, transcriber, wait_for_status):
    transcriber.stall(1)
    job = wait_for_status(create_job(client)["id"], "transcribed", "error")

    assert job["status"] == "transcribed"
    assert transcriber.calls[0] == transcriber.calls[1]
    assert job["transcript"]["words"] == as_json(speech.words)
    assert job["warnings"] == []


@pytest.mark.tuning(budget_secs=0.3)
def test_chunk_that_stalls_twice_is_skipped_with_a_warning(client, uncaptioned, speech, transcriber, wait_for_status):
    transcriber.stall(2)
    job = wait_for_status(create_job(client)["id"], "transcribed", "error")

    assert job["status"] == "transcribed"
    assert transcriber.calls[0] == transcriber.calls[1]
    [warning] = job["warnings"]
    assert warning.startswith("Skipped 0:00:00–") and "stalled" in warning
    _, _, skipped_until = transcriber.calls[0]
    assert job["transcript"]["words"] == as_json([word for word in speech.words if word.start >= skipped_until])
    assert job["transcript"]["words"]
