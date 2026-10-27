"""Seam A: uploading a master file through the API, with the fake Transcriber and LLM. The upload's
Video Source and the preview proxy are the real ones (ffprobe and ffmpeg on the stored file)."""

import asyncio
import hashlib
import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import uploads
from app.config import load_settings
from app.main import create_app
from app.ports import Ports
from app.preview import unplayable


FFMPEG = load_settings().ffmpeg_bin
FFPROBE = load_settings().ffprobe_bin
OPTIONS = {"language": "id", "min_secs": 2, "max_secs": 6, "captions": False, "brief": "cari momen lucu"}


def encode(source: Path, output: Path, *args: str) -> Path:
    subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(source), *args, str(output)], check=True)
    return output


def streams(path: Path) -> dict:
    command = [
        str(FFPROBE), "-v", "error", "-of", "json",
        "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt:format=duration", str(path),
    ]
    return json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)


def upload(client: TestClient, video: Path, name: str, options: dict = OPTIONS):
    with video.open("rb") as file:
        return client.post(
            "/api/jobs/upload", data={"options": json.dumps(options)}, files={"file": (name, file, "video/mp4")}
        )


def leftovers(settings) -> list[Path]:
    folder = settings.data_dir / uploads.UPLOADS_DIR
    return list(folder.iterdir()) if folder.is_dir() else []


@pytest.fixture(scope="session")
def hevc_master(speech, tmp_path_factory) -> Path:
    """The speech fixture as a QuickTime master the browser can't play: HEVC at 1440x810 with PCM audio."""
    output = tmp_path_factory.mktemp("masters") / "master.mov"
    return encode(
        speech.video, output, "-vf", "scale=1440:810", "-c:v", "libx265", "-preset", "ultrafast",
        "-x265-params", "log-level=error", "-tag:v", "hvc1", "-c:a", "pcm_s16le",
    )


def test_an_uploaded_file_is_transcribed_locally_and_reaches_review(
    client, settings, speech, video_source, transcriber, wait_for_status
):
    response = upload(client, speech.video, "Episode 12 (final).mp4")
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["url"] == ""
    assert created["upload"] == {"name": "Episode 12 (final).mp4", "size": speech.video.stat().st_size, "file": "master.mp4"}
    assert created["options"] == OPTIONS | {"transcribe_locally": False, "aspect": "9:16", "template": None}

    job = wait_for_status(created["id"], "review", "error")
    assert job["status"] == "review", job["error"]
    assert [change["status"] for change in job["history"]] == ["queued", "downloading", "transcribing", "analyzing", "review"]
    # The file stored whole, probed, with no captions and no proxy (H.264 and AAC in an MP4 play as they are).
    stored = settings.data_dir / "jobs" / job["id"] / "master.mp4"
    assert hashlib.sha256(stored.read_bytes()).digest() == hashlib.sha256(speech.video.read_bytes()).digest()
    assert job["source"]["video"] == "master.mp4"
    assert job["source"]["caption_track"] is None and job["source"]["preview"] is None
    assert job["source"]["metadata"]["codec"] == "h264"
    assert job["source"]["metadata"]["duration"] == pytest.approx(8, abs=0.1)
    # The whole episode went through the Transcriber; YouTube was never asked.
    assert job["transcript"]["source"] == "whisper"
    assert [word["text"] for word in job["transcript"]["words"]] == [word.text for word in speech.words]
    assert transcriber.calls and video_source.calls == [] and video_source.caption_calls == []
    assert not any(warning["stage"] == "downloading" for warning in job["warnings"])
    assert leftovers(settings) == []
    assert client.get(f"/media/{job['id']}/master.mp4", headers={"Range": "bytes=0-99"}).status_code == 206


def test_a_master_the_browser_cant_play_gets_a_720p_h264_preview_proxy(client, settings, hevc_master, wait_for_status):
    seen = []
    store = client.app.state.store
    with store.watch(lambda job_id, job: job and seen.append((job.status, job.message, job.progress))):
        response = upload(client, hevc_master, "Master.MOV")
        job = wait_for_status(response.json()["id"], "review", "error")
    assert job["status"] == "review", job["error"]

    source = job["source"]
    assert source["video"] == "master.mov" and source["preview"] == "preview.mp4"
    # The Source is still the master: its metadata, and so the Render Plans, are the master's.
    assert (source["metadata"]["codec"], source["metadata"]["width"], source["metadata"]["height"]) == ("hevc", 1440, 810)
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert sorted(path.name for path in job_dir.glob("*.mp4")) == ["preview.mp4"]

    proxy = streams(job_dir / "preview.mp4")
    video, audio = (next(s for s in proxy["streams"] if s["codec_type"] == kind) for kind in ("video", "audio"))
    assert (video["codec_name"], video["width"], video["height"], video["pix_fmt"]) == ("h264", 1280, 720, "yuv420p")
    assert audio["codec_name"] == "aac"
    assert float(proxy["format"]["duration"]) == pytest.approx(8, abs=0.1)
    head = (job_dir / "preview.mp4").read_bytes()
    assert head.index(b"moov") < head.index(b"mdat")  # fast start, for seeking before it has loaded
    assert unplayable(FFPROBE, job_dir / "preview.mp4") is None

    # Its progress was reported while the Job was downloading.
    making = [(message, progress) for status, message, progress in seen if status == "downloading" and message]
    assert making and all("preview copy" in message and "hevc video" in message for message, _ in making)
    assert [progress for _, progress in making][-1] == 100
    response = client.get(f"/media/{job['id']}/preview.mp4", headers={"Range": "bytes=0-99"})
    assert response.status_code == 206 and response.headers["content-type"] == "video/mp4"


def test_an_uploads_thumbnail_is_a_still_of_its_master_taken_once_and_kept(
    client, settings, hevc_master, video_source, wait_for_status
):
    video_source.hold()
    waiting = client.post("/api/jobs", json={"url": "https://youtu.be/dQw4w9WgXcQ"}).json()
    wait_for_status(waiting["id"], "downloading")
    # No Source yet, so nothing to take a still of.
    assert client.get(f"/api/jobs/{waiting['id']}/thumbnail").status_code == 404
    video_source.release()

    job = wait_for_status(upload(client, hevc_master, "Master.MOV").json()["id"], "review", "error")
    response = client.get(f"/api/jobs/{job['id']}/thumbnail")
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    still = settings.data_dir / "jobs" / job["id"] / "thumb.jpg"
    assert still.read_bytes() == response.content
    picture = streams(still)["streams"][0]
    assert (picture["codec_name"], picture["width"], picture["height"]) == ("mjpeg", 480, 270)

    # Asked again, it's the same file, not taken again.
    taken = still.stat().st_mtime_ns
    assert client.get(f"/api/jobs/{job['id']}/thumbnail").content == response.content
    assert still.stat().st_mtime_ns == taken
    assert client.get("/api/jobs/0123456789ab/thumbnail").status_code == 404


def test_a_candidates_thumbnail_is_a_still_of_where_it_starts_kept_under_its_time(
    client, settings, speech, wait_for_status
):
    job = wait_for_status(upload(client, speech.video, "episode.mp4").json()["id"], "review", "error")
    candidate = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": 1.0, "end": 6.0}).json()
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/thumbnail"
    response = client.get(url)
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    stills = settings.data_dir / "jobs" / job["id"] / "stills"
    [still] = stills.iterdir()
    at = candidate["start"] + min(settings.render.poster_secs, (candidate["end"] - candidate["start"]) / 2)
    assert still.name == f"{round(at * 1000)}.jpg" and still.read_bytes() == response.content
    assert streams(still)["streams"][0]["width"] == 320

    # Asked again, it's the same file, not taken again.
    taken = still.stat().st_mtime_ns
    assert client.get(url).content == response.content
    assert still.stat().st_mtime_ns == taken
    assert client.get(f"/api/jobs/{job['id']}/candidates/nope/thumbnail").status_code == 404


def test_browser_playable_means_iso_bmff_with_h264_vp9_or_av1_video_and_web_audio(speech, tmp_path):
    def made(name: str, *args: str) -> Path:
        return encode(speech.video, tmp_path / name, "-t", "0.5", *args)

    assert unplayable(FFPROBE, made("h264.mov", "-c", "copy")) is None
    assert unplayable(FFPROBE, made("h264.mkv", "-c", "copy")) == "MKV container"
    assert unplayable(FFPROBE, made("prores.mov", "-c:v", "prores_ks", "-c:a", "copy")) == "prores video"
    assert unplayable(FFPROBE, made("pcm.mov", "-c:v", "copy", "-c:a", "pcm_s16le")) == "pcm_s16le audio"
    high10 = made("high10.mp4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-c:a", "copy")
    assert unplayable(FFPROBE, high10) == "h264 video in yuv420p10le"


def test_an_upload_is_refused_before_anything_is_written_when_free_space_is_short(
    settings, speech, video_source, transcriber, llm
):
    tight = replace(settings, upload_reserve_bytes=10**18)
    with TestClient(create_app(tight, Ports(video_source, transcriber, llm))) as client:
        # The browser asks first, with the file's size.
        check = client.get("/api/jobs/upload/check", params={"size": speech.video.stat().st_size})
        assert check.status_code == 507
        assert check.json()["detail"].startswith("Not enough free disk space for this upload: it needs ")
        # And the upload itself is refused before any of it is written.
        response = upload(client, speech.video, "episode.mp4")
        assert response.status_code == 507
        assert response.json()["detail"].startswith("Not enough free disk space for this upload: it needs ")
        assert client.get("/api/jobs").json() == []
    assert leftovers(settings) == []


def test_an_upload_that_fits_passes_the_check(client, speech):
    assert client.get("/api/jobs/upload/check", params={"size": speech.video.stat().st_size}).status_code == 204


def test_an_upload_stops_when_free_space_runs_short_while_it_comes(client, settings, speech, monkeypatch):
    # Room at first; then, as another program fills the disk, none.
    answers = iter([10**15])
    monkeypatch.setattr(uploads, "free_bytes", lambda folder: next(answers, 0))
    monkeypatch.setattr(uploads, "CHECK_BYTES", 1)
    response = upload(client, speech.video, "episode.mp4")
    assert response.status_code == 507
    assert "Not enough free disk space" in response.json()["detail"]
    assert client.get("/api/jobs").json() == []
    assert leftovers(settings) == []


def test_an_upload_cut_short_never_becomes_a_job(client, settings, speech):
    boundary = "cut"
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n{json.dumps(OPTIONS)}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="episode.mp4"\r\n'
        "Content-Type: video/mp4\r\n\r\n"
    ).encode()
    # The body ends inside the file: its closing boundary never comes.
    body = head + speech.video.read_bytes()[:50_000]
    response = client.post(
        "/api/jobs/upload", content=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "The upload was cut short"

    # The browser goes away mid-file (a closed tab, a lost connection).
    messages = [{"type": "http.request", "body": body, "more_body": True}, {"type": "http.disconnect"}]
    sent = []

    async def receive() -> dict:
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)

    headers = [
        (b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
        (b"content-length", str(len(body) + 10**6).encode()),
    ]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": "/api/jobs/upload", "raw_path": b"/api/jobs/upload", "root_path": "", "query_string": b"",
        "headers": headers, "client": ("127.0.0.1", 1), "server": ("testserver", 80), "state": {},
        "app": client.app,
    }
    asyncio.run(client.app(scope, receive, send))
    assert sent[0]["status"] == 400

    assert client.get("/api/jobs").json() == []
    assert leftovers(settings) == []


def test_partial_uploads_left_by_a_crash_are_removed_at_start_and_never_become_jobs(
    settings, video_source, transcriber, llm
):
    folder = settings.data_dir / uploads.UPLOADS_DIR
    folder.mkdir(parents=True)
    (folder / "0123456789abcdef.part").write_bytes(b"\0" * 1000)
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        assert client.get("/api/jobs").json() == []
    assert leftovers(settings) == []


def test_upload_options_are_validated_like_a_url_jobs(client, settings, speech):
    response = upload(client, speech.video, "episode.mp4", OPTIONS | {"min_secs": 60, "max_secs": 30})
    assert response.status_code == 422
    assert client.get("/api/jobs").json() == []
    assert leftovers(settings) == []
