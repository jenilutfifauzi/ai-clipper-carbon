"""Seam A: rendering Candidates into Clips through the HTTP API, with fakes at the ports and the real ffmpeg.

The Source is a 6-second 640x360 test pattern with a tone, captioned by the fixture json3 track:
halo 0.1–0.5, semua –1.0, apa –1.3, kabar –1.6, kita –1.9, ngobrol –2.3, soal –2.6, then Podcast
4.0–4.5 and ya –6.0. Its Candidates are added by hand, since Selection needs a longer episode.
"""

import json
import re
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.clips import Clip, ClipStatus
from app.config import RenderTuning, load_settings
from app.jobs import JobStatus, JobStore
from app.main import create_app
from app.ports import Ports
from app.rendering import Renders
from conftest import wait_for
from test_jobs_api import create_job, statuses
from test_review import patch

SOURCE_SECS = 6


@pytest.fixture(scope="session")
def render_video(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("render") / "source.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(path),
    ]
    subprocess.run(command, check=True)
    return path


@pytest.fixture(autouse=True)
def from_render_video(video_source, render_video) -> None:
    video_source.video = render_video


def reviewed(client) -> dict:
    job = wait_for(client, create_job(client)["id"], "review", "error")
    assert job["status"] == "review", job["error"]
    return job


def add(client, job: dict, first: str, last: str, *, selected: bool = True) -> dict:
    """A manual Candidate from Word `first` to Word `last`."""
    words = {word["text"]: word for word in job["transcript"]["words"]}
    response = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": words[first]["start"], "end": words[last]["end"]})
    assert response.status_code == 201, response.text
    candidate = response.json()
    return patch(client, job, candidate, selected=True) if selected else candidate


def render(client, job: dict, candidate_ids: list[str] | None = None) -> list[dict]:
    body = None if candidate_ids is None else {"candidate_ids": candidate_ids}
    response = client.post(f"/api/jobs/{job['id']}/render", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def rendered(client, job: dict) -> dict:
    """The Job, once its renders are done."""
    return wait_for(client, job["id"], "review", timeout=30)


def probe(settings, path: Path) -> dict:
    command = [str(settings.ffprobe_bin), "-v", "error", "-of", "json", "-show_streams", "-show_format", str(path)]
    return json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)


def loudness(settings, path: Path) -> float:
    """Integrated loudness in LUFS (EBU R128), as ffmpeg measures it."""
    command = [str(settings.ffmpeg_bin), "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"]
    output = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", output)[-1])


def check_clip(settings, job_dir: Path, clip: dict, candidate: dict) -> None:
    """The Clip is a 1080x1920 H.264 + AAC fast-start MP4 as long as the Candidate, with a poster."""
    assert clip["status"] == "done", clip["error"]
    output = clip["output"]
    assert (output["start"], output["end"]) == (candidate["start"], candidate["end"])
    video = job_dir / output["video"]
    info = probe(settings, video)
    [picture] = [s for s in info["streams"] if s["codec_type"] == "video"]
    [sound] = [s for s in info["streams"] if s["codec_type"] == "audio"]
    assert (picture["codec_name"], picture["width"], picture["height"]) == ("h264", 1080, 1920)
    assert sound["codec_name"] == "aac"
    length = candidate["end"] - candidate["start"]
    assert float(info["format"]["duration"]) == pytest.approx(length, abs=0.1)
    assert output["duration"] == pytest.approx(length, abs=0.1)
    assert output["size_bytes"] == video.stat().st_size
    data = video.read_bytes()
    assert data.index(b"moov") < data.index(b"mdat"), "not fast-start"
    assert loudness(settings, video) == pytest.approx(-14, abs=1)

    [poster] = probe(settings, job_dir / output["poster"])["streams"]
    assert (poster["codec_name"], poster["width"], poster["height"]) == ("mjpeg", 1080, 1920)


def test_selected_candidates_render_into_clips_ranked_like_their_candidates(client, settings):
    job = reviewed(client)
    first = add(client, job, "halo", "kabar")
    second = add(client, job, "kita", "Podcast")
    add(client, job, "ya", "ya", selected=False)

    queued = render(client, job)
    assert [clip["candidate_id"] for clip in queued] == [first["id"], second["id"]]
    done = rendered(client, job)
    assert statuses(done)[-3:] == ["review", "rendering", "review"]
    assert (done["stage"], done["progress"], done["message"]) == (None, None, None)

    job_dir = settings.data_dir / "jobs" / job["id"]
    assert [clip["candidate_id"] for clip in done["clips"]] == [first["id"], second["id"]]
    for clip, candidate in zip(done["clips"], [first, second]):
        check_clip(settings, job_dir, clip, candidate)
        assert clip["output"]["encoder"] == "h264_videotoolbox"
        # The Render Plan is kept with the Job: one scene, a full-height 9:16 crop from the middle.
        plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
        [scene] = plan["scenes"]
        [panel] = scene["panels"]
        assert (scene["layout"], panel["crop_width"], panel["crop_height"], panel["path"]) == (
            "track", 202, 360, [{"at": 0.0, "x": 220, "y": 0}]
        )
    assert client.get(f"/api/jobs/{job['id']}/clips").json() == done["clips"]

    # The browser plays and downloads them through /media.
    clip = done["clips"][0]["output"]
    response = client.get(f"/media/{job['id']}/{clip['video']}", headers={"Range": "bytes=0-99"})
    assert (response.status_code, response.headers["content-type"]) == (206, "video/mp4")
    assert client.get(f"/media/{job['id']}/{clip['poster']}").headers["content-type"] == "image/jpeg"
    # Only the finished files are left.
    assert sorted(path.name for path in (job_dir / "clips").iterdir()) == sorted(
        f"{c['id']}{suffix}" for c in (first, second) for suffix in (".mp4", ".jpg", ".plan.json")
    )


def test_rendering_again_after_an_edit_replaces_the_clip(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    render(client, job)
    [before] = rendered(client, job)["clips"]

    shorter = patch(client, job, candidate, end=1.6, hook_text="Hook baru")  # now ends with "kabar"
    render(client, job, [candidate["id"]])
    after = rendered(client, job)
    [clip] = after["clips"]
    check_clip(settings, settings.data_dir / "jobs" / job["id"], clip, shorter)
    assert clip["output"]["hook_text"] == "Hook baru"
    assert clip["output"]["video"] == before["output"]["video"]
    assert clip["output"]["at"] > before["output"]["at"]
    assert statuses(after)[-5:] == ["review", "rendering", "review", "rendering", "review"]


def test_review_goes_on_while_clips_wait_to_render(client, video_source, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    # Another Job's download holds the worker, so the render waits its turn.
    video_source.hold()
    other = create_job(client)
    wait_for(client, other["id"], "downloading")

    [queued] = render(client, job)
    assert queued["status"] == "queued"
    waiting = client.get(f"/api/jobs/{job['id']}").json()
    assert (waiting["status"], waiting["stage"]) == ("rendering", "rendering")
    # Edits are saved meanwhile, and the render takes the Candidate as it is when it starts.
    edited = patch(client, job, candidate, start=1.0, layout="split")
    # Asking again leaves it queued once.
    assert [clip["status"] for clip in render(client, job)] == ["queued"]
    added = add(client, job, "ya", "ya")
    render(client, job, [added["id"]])

    video_source.release()
    assert wait_for(client, other["id"], "review")["status"] == "review"
    done = rendered(client, job)
    first, second = done["clips"]
    assert (first["candidate_id"], second["candidate_id"]) == (candidate["id"], added["id"])
    check_clip(settings, settings.data_dir / "jobs" / job["id"], first, edited)
    assert first["output"]["layout"] == "split"
    assert second["status"] == "done"
    assert statuses(done)[-3:] == ["review", "rendering", "review"]


def test_render_requests_need_a_job_in_review_and_known_selected_candidates(client, video_source):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar", selected=False)

    response = client.post(f"/api/jobs/{job['id']}/render")
    assert response.status_code == 422
    assert "Select at least one Candidate" in response.json()["detail"]
    response = client.post(f"/api/jobs/{job['id']}/render", json={"candidate_ids": [candidate["id"], "00000000"]})
    assert response.status_code == 404
    assert client.post("/api/jobs/0123456789ab/render").status_code == 404
    assert client.get("/api/jobs/0123456789ab/clips").status_code == 404
    assert client.post(f"/api/jobs/{job['id']}/render", json={"ids": []}).status_code == 422
    assert client.get(f"/api/jobs/{job['id']}").json()["clips"] == []

    video_source.hold()
    running = create_job(client)
    wait_for(client, running["id"], "downloading")
    response = client.post(f"/api/jobs/{running['id']}/render", json={"candidate_ids": ["00000000"]})
    assert response.status_code == 409
    assert "once it is in review" in response.json()["detail"]


def test_a_failed_encode_falls_back_to_libx264_and_a_failed_render_is_reported(
    settings, video_source, transcriber, llm
):
    def app(encoders: tuple[str, ...]) -> TestClient:
        tuned = replace(settings, render=RenderTuning(encoders=encoders))
        return TestClient(create_app(tuned, Ports(video_source, transcriber, llm)))

    with app(("no_such_encoder",)) as client:
        job = reviewed(client)
        candidate = add(client, job, "halo", "kabar")
        render(client, job)
        [failed] = rendered(client, job)["clips"]
    assert failed["status"] == "error"
    assert "no_such_encoder" in failed["error"]
    assert failed["output"] is None
    # Nothing half-written is left; the plan stays for inspection.
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert [path.name for path in (job_dir / "clips").iterdir()] == [f"{candidate['id']}.plan.json"]

    with app(("no_such_encoder", "libx264")) as client:
        render(client, job)
        [clip] = rendered(client, job)["clips"]
    check_clip(settings, job_dir, clip, candidate)
    assert (clip["output"]["encoder"], clip["error"]) == ("libx264", None)


def test_renders_left_unfinished_resume_at_the_next_start(settings, video_source, transcriber, llm):
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        job = reviewed(client)
        first = add(client, job, "halo", "kabar")
        second = add(client, job, "kita", "Podcast")

    # The app stopped while rendering the first Clip, with the second queued.
    store = JobStore(settings.data_dir / "jobs")
    assert Renders(store, settings).request(job["id"])

    def interrupted(_, clips: list[Clip]) -> tuple[list[Clip], dict, None]:
        return [replace(clips[0], status=ClipStatus.RENDERING), *clips[1:]], {}, None

    store.change_clips(job["id"], interrupted)
    assert store.get(job["id"]).status is JobStatus.RENDERING

    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        done = rendered(restarted, job)
    assert [clip["status"] for clip in done["clips"]] == ["done", "done"]
    for clip, candidate in zip(done["clips"], [first, second]):
        check_clip(settings, settings.data_dir / "jobs" / job["id"], clip, candidate)


def test_the_cli_renders_the_named_candidates(settings, video_source, transcriber, llm, monkeypatch, capsys):
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        job = reviewed(client)
        chosen = add(client, job, "kita", "Podcast", selected=False)
        add(client, job, "halo", "kabar")
    monkeypatch.setattr(cli, "load_settings", lambda: settings)

    assert cli.main(["render", job["id"], chosen["id"]]) == 0
    output = capsys.readouterr().out
    assert re.search(rf"^{chosen['id']} 2\.\d s Clip in [\d.]+ s with h264_videotoolbox, [\d.]+ MB: .*\.mp4", output, re.M)
    store = JobStore(settings.data_dir / "jobs")
    [clip] = store.load_clips(job["id"])
    assert (clip.candidate_id, clip.status) == (chosen["id"], ClipStatus.DONE)
    assert store.get(job["id"]).status is JobStatus.REVIEW

    assert cli.main(["render", job["id"], "00000000"]) == 1
    assert "has no Candidate 00000000" in capsys.readouterr().out


def test_a_portrait_source_is_passed_through_into_the_vertical_frame(client, settings, video_source, tmp_path):
    # 3:4, so it is shown whole between black bars, not cropped.
    video_source.video = tmp_path / "portrait.mp4"
    command = [
        str(settings.ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=360x480:rate=30", "-f", "lavfi", "-i", "sine=frequency=220",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(video_source.video),
    ]
    subprocess.run(command, check=True)
    job = reviewed(client)
    candidate = add(client, job, "kita", "Podcast")
    render(client, job)
    [clip] = rendered(client, job)["clips"]

    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    [scene] = json.loads((job_dir / clip["output"]["plan"]).read_text())["scenes"]
    assert (scene["layout"], scene["panels"][0]["area"]) == ("passthrough", {"x": 0, "y": 240, "width": 1080, "height": 1440})
