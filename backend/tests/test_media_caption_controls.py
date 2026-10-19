"""Media caption controls: a media Segment's Captions switch, its item's language, and a failed
transcription remembered until Retry (.scratch/captions-advanced/issues/05-media-caption-controls.md,
ADR 0020).

Seam A: through the API, the FakeTranscriber and the real ffmpeg.
"""

from app.transcript import Word
from conftest import cue_text, wait_for
from test_jobs_api import create_job
from test_media_library import upload
from test_media_segments import clips  # noqa: F401
from test_media_words import SAID, prepare, talking_candidate
from test_render import preview, render, rendered, reviewed
# The Source Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch


def with_captions(client, job: dict, candidate: dict, captions: bool | None) -> dict:
    """The Candidate with its video's Segment ("i") switched."""
    intro, episode = candidate["segments"]
    return patch(client, job, candidate, segments=[{**intro, "captions": captions}, episode])


def test_a_media_segment_with_its_captions_off_has_no_cues_and_causes_no_transcription(client, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = with_captions(client, job, talking_candidate(client, job, red["id"]), False)
    assert candidate["segments"][0]["captions"] is False

    prepare(client, job, candidate)
    rendered(client, job)
    shown = preview(client, job, candidate)
    assert shown["words_status"] == {"i": "off", "e": "clip"}
    assert not [cue for cue in shown["plan"]["captions"] if cue["key"]["media"]]
    assert transcriber.calls_for(red["id"]) == 0

    # Its render doesn't transcribe it either.
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert transcriber.calls_for(red["id"]) == 0

    # On again (empty means on): queued and captioned.
    on = with_captions(client, job, candidate, None)
    prepare(client, job, on)
    rendered(client, job)
    assert preview(client, job, on)["words_status"]["i"] == "media"
    assert transcriber.calls_for(red["id"]) == 1


def test_captions_on_a_source_segment_are_refused(client, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    intro, episode = candidate["segments"]
    response = client.patch(
        f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"segments": [intro, {**episode, "captions": False}]}
    )
    assert response.status_code == 422
    assert "Captions" in response.text


def set_language(client, media_id: str, language: str | None) -> dict:
    response = client.patch(f"/api/media/{media_id}", json={"language": language})
    assert response.status_code == 200, response.text
    return response.json()


def test_an_items_language_transcribes_it_in_that_language_for_every_job_and_clearing_it_reuses_the_earlier_file(
    client, settings, transcriber, clips,
):
    red = upload(client, clips["red"], "red.mp4").json()
    assert red["language"] is None
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    prepare(client, job, candidate)
    rendered(client, job)
    assert [call[0] for call in transcriber.calls if call[2] == red["duration"]] == ["id"]

    # Set to English: transcribed again, in English, once for both Jobs that show it; the Indonesian file is kept.
    assert set_language(client, red["id"], "en")["language"] == "en"
    assert [item["language"] for item in client.get("/api/media").json()] == ["en"]
    assert preview(client, job, candidate)["words_status"]["i"] == "none"
    other_job = reviewed(client)
    other = talking_candidate(client, other_job, red["id"])
    for job_of, placed in ((job, candidate), (other_job, other)):
        prepare(client, job_of, placed)
        rendered(client, job_of)
        assert preview(client, job_of, placed)["words_status"]["i"] == "media"
    assert [call[0] for call in transcriber.calls if call[2] == red["duration"]] == ["id", "en"]
    folder = settings.data_dir / "media" / f"{red['id']}.words"
    assert sorted(path.name[:3] for path in folder.iterdir()) == ["en-", "id-"]

    # Cleared: each Job's language again, from the earlier file, with nothing to transcribe.
    assert set_language(client, red["id"], None)["language"] is None
    assert prepare(client, job, candidate)["status"] == "review"
    assert preview(client, job, candidate)["words_status"]["i"] == "media"
    assert transcriber.calls_for(red["id"]) == 2


def test_an_items_language_is_checked(client, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    assert client.patch(f"/api/media/{red['id']}", json={"language": "english!"}).status_code == 422
    assert client.patch("/api/media/nope", json={"language": "en"}).status_code == 404


def media_words(client, job: dict, media_id: str, again: bool | None = None) -> dict:
    """Retry (or, with `again`, Transcribe again) the item's Media Words for the Job."""
    response = client.post(f"/api/jobs/{job['id']}/media/{media_id}/words", json=None if again is None else {"again": again})
    assert response.status_code == 202, response.text
    return response.json()


def words_of(client, job: dict, media_id: str) -> dict:
    response = client.get(f"/api/jobs/{job['id']}/media/{media_id}/words")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_failed_transcription_is_remembered_until_retry_and_transcribe_again_replaces_a_ready_file(client, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.fails[red["id"]] = "Whisper fell over"
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    prepare(client, job, candidate)
    rendered(client, job)

    # Failed, with its error, for the Segment and for the item.
    shown = preview(client, job, candidate)
    assert shown["words_status"] == {"i": "failed", "e": "clip"}
    assert "Whisper fell over" in shown["words_errors"]["i"]
    status = words_of(client, job, red["id"])
    assert (status["status"], status["language"], status["words"]) == ("failed", "id", None)
    assert "Whisper fell over" in status["error"]
    # Remembered: preparing again doesn't run it again.
    calls = transcriber.calls_for(red["id"])
    prepare(client, job, candidate)
    rendered(client, job)
    assert preview(client, job, candidate)["words_status"]["i"] == "failed"
    assert transcriber.calls_for(red["id"]) == calls

    # Retry: cleared, run again, and captioned.
    del transcriber.fails[red["id"]]
    transcriber.heard[red["id"]] = SAID
    transcriber.hold()
    assert media_words(client, job, red["id"])["status"] == "pending"
    assert preview(client, job, candidate)["words_status"]["i"] == "pending"
    transcriber.release()
    rendered(client, job)
    ready = words_of(client, job, red["id"])
    assert (ready["status"], ready["error"], [w["text"] for w in ready["words"]]) == ("ready", None, ["halo", "semua"])
    assert preview(client, job, candidate)["words_status"]["i"] == "media"
    assert transcriber.calls_for(red["id"]) == calls + 1

    # Ready: asking again without `again` does nothing; Transcribe again re-runs it and replaces the file.
    assert media_words(client, job, red["id"])["status"] == "ready"
    transcriber.heard[red["id"]] = [Word("hai", 0.5, 1.3)]
    media_words(client, job, red["id"], again=True)
    rendered(client, job)
    assert transcriber.calls_for(red["id"]) == calls + 2
    assert [w["text"] for w in words_of(client, job, red["id"])["words"]] == ["hai"]
    assert [cue_text(cue) for cue in preview(client, job, candidate)["plan"]["captions"] if cue["key"]["media"]] == ["HAI"]


def test_a_failed_transcription_fails_that_clips_render_naming_the_item_until_its_captions_are_off(client, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.fails[red["id"]] = "Whisper fell over"
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "error"
    assert "red" in clip["error"] and "Whisper fell over" in clip["error"]
    # Remembered: rendering again fails without transcribing again.
    calls = transcriber.calls_for(red["id"])
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "error" and "red" in clip["error"]
    assert transcriber.calls_for(red["id"]) == calls

    # The Segment's captions off: it renders.
    with_captions(client, job, candidate, False)
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]


def test_a_job_with_captions_off_queues_nothing_for_its_media_segments(client, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = wait_for(client, create_job(client, captions=False)["id"], "review", "error")
    candidate = talking_candidate(client, job, red["id"])
    prepare(client, job, candidate)
    rendered(client, job)
    shown = preview(client, job, candidate)
    assert shown["words_status"]["i"] == "none" and not shown["plan"]["captions"]
    assert client.post(f"/api/jobs/{job['id']}/media/{red['id']}/words").status_code == 409
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert transcriber.calls_for(red["id"]) == 0
