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

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import cli
from app.clips import Clip, ClipStatus
from app.config import RenderTuning, load_settings
from app.jobs import JobStatus, JobStore
from app.main import create_app
from app.planner import font_metrics
from app.ports import Ports
from app.rendering import Renders
from app.transcript import Word
from conftest import FIXTURES, cue_text, cue_words, wait_for
from test_jobs_api import create_job, statuses
from test_review import patch

SOURCE_SECS = 6
# The plain background of the face fixtures, 0x4a5560, and the second one of `face_then_two`, 0x605a4a.
BACKGROUND = np.array([0x4A, 0x55, 0x60])
OTHER_BACKGROUND = np.array([0x60, 0x5A, 0x4A])
# The head from fixtures/portrait.jpg, 400x500 (the face's box is about 176 px).
HEAD = "crop=120:150:43:0,scale=400:500"


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


@pytest.fixture(scope="session")
def moving_face(tmp_path_factory) -> Path:
    """A 1280x720 close-up of a real face (the head from fixtures/portrait.jpg, 400x500) that holds
    still for 0.5 s, glides 600 px to the right over 5 s, then holds again: farther than the 404 px
    wide crop, so only a crop that follows it keeps it in frame. With a tone, 6 s long."""
    path = tmp_path_factory.mktemp("face") / "face.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x4a5560:size=1280x720:rate=25",
        "-loop", "1", "-framerate", "25", "-i", str(FIXTURES / "portrait.jpg"),
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-filter_complex",
        f"[1:v]{HEAD}[head];"
        "[0:v][head]overlay=x='100+600*clip((t-0.5)/5,0,1)':y=110:shortest=1,format=yuv420p[v]",
        "-map", "[v]", "-map", "2:a", "-t", str(SOURCE_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(path),
    ]
    subprocess.run(command, check=True)
    return path


@pytest.fixture(scope="session")
def two_faces(tmp_path_factory) -> Path:
    """A 1280x720 wide shot of two people side by side (the portrait's head twice, still): in colour
    on the left, in grey on the right, so that the output shows which is where. With a tone, 6 s long."""
    path = tmp_path_factory.mktemp("two") / "two.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x4a5560:size=1280x720:rate=25",
        "-loop", "1", "-framerate", "25", "-i", str(FIXTURES / "portrait.jpg"),
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-filter_complex",
        f"[1:v]{HEAD},split=2[left][right];[right]hue=s=0[grey];"
        "[0:v][left]overlay=x=140:y=110:shortest=1[one];[one][grey]overlay=x=740:y=110,format=yuv420p[v]",
        "-map", "[v]", "-map", "2:a", "-t", str(SOURCE_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(path),
    ]
    subprocess.run(command, check=True)
    return path


@pytest.fixture(scope="session")
def face_then_two(tmp_path_factory) -> Path:
    """3 s of a close-up (the portrait's head in the middle), then a cut to 3 s of the two people of
    `two_faces` over another background. With a tone throughout, 6 s long."""
    path = tmp_path_factory.mktemp("mixed") / "mixed.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x4a5560:size=1280x720:rate=25:duration=3",
        "-f", "lavfi", "-i", "color=c=0x605a4a:size=1280x720:rate=25:duration=3",
        "-loop", "1", "-framerate", "25", "-i", str(FIXTURES / "portrait.jpg"),
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-filter_complex",
        f"[0:v][1:v]concat=n=2:v=1:a=0[back];[2:v]{HEAD},split=3[solo][left][right];[right]hue=s=0[grey];"
        "[back][solo]overlay=x=440:y=110:enable='lt(t,3)':shortest=1[a];"
        "[a][left]overlay=x=140:y=110:enable='gte(t,3)'[b];"
        "[b][grey]overlay=x=740:y=110:enable='gte(t,3)',format=yuv420p[v]",
        "-map", "[v]", "-map", "3:a", "-t", str(SOURCE_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(path),
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


def rendered(client, job: dict, timeout: float = 30) -> dict:
    """The Job, once its renders are done."""
    return wait_for(client, job["id"], "review", timeout=timeout)


def probe(settings, path: Path) -> dict:
    command = [str(settings.ffprobe_bin), "-v", "error", "-of", "json", "-show_streams", "-show_format", str(path)]
    return json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)


def loudness(settings, path: Path) -> float:
    """Integrated loudness in LUFS (EBU R128), as ffmpeg measures it."""
    command = [str(settings.ffmpeg_bin), "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"]
    output = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", output)[-1])


def output_frame(settings, video: Path, at: float) -> np.ndarray:
    """The Clip's frame at `at` seconds, shrunk to 54x96 RGB."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-ss", f"{at}", "-i", str(video), "-frames:v", "1",
        "-vf", "scale=54:96", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(96, 54, 3).astype(int)


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
        # The Render Plan is kept with the Job: one scene without faces, so Blur: the whole frame over
        # its blurred full-height 9:16 crop from the middle.
        plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
        [scene] = plan["scenes"]
        background, shot = scene["panels"]
        assert scene["layout"] == "blur"
        assert (background["crop_width"], background["crop_height"], background["path"], background["blur"]) == (
            202, 360, [{"at": 0.0, "x": 220, "y": 0}], True
        )
        assert (shot["area"], shot["crop_width"], shot["crop_height"], shot["blur"]) == (
            {"x": 0, "y": 656, "width": 1080, "height": 608}, 640, 360, False
        )
    assert client.get(f"/api/jobs/{job['id']}/clips").json() == done["clips"]

    # The browser plays and downloads them through /media.
    clip = done["clips"][0]["output"]
    response = client.get(f"/media/{job['id']}/{clip['video']}", headers={"Range": "bytes=0-99"})
    assert (response.status_code, response.headers["content-type"]) == (206, "video/mp4")
    assert client.get(f"/media/{job['id']}/{clip['poster']}").headers["content-type"] == "image/jpeg"
    # Only the finished files are left.
    assert sorted(path.name for path in (job_dir / "clips").iterdir()) == sorted(
        f"{c['id']}{suffix}" for c in (first, second) for suffix in (".mp4", ".jpg", ".plan.json", ".srt", ".vtt")
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


def test_a_clip_records_the_revision_it_was_rendered_from(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["output"]["revision"] == candidate["revision"]

    # An Advanced Edit change alone leaves the Clip behind its Candidate: it is stale.
    edited = patch(client, job, candidate, text_layers=[{"id": "t", "text": "Judul", "start": 0, "secs": 1}])
    assert edited["revision"] == candidate["revision"] + 1
    [clip] = client.get(f"/api/jobs/{job['id']}").json()["clips"]
    assert clip["output"]["revision"] == candidate["revision"]


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
    assert Renders(store, settings, transcriber).request(job["id"])

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
    monkeypatch.setattr(cli, "WhisperTranscriber", lambda settings: transcriber)

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


def test_a_close_up_crop_follows_the_face_and_keeps_it_in_frame(client, settings, video_source, moving_face):
    video_source.video = moving_face
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    # One scene (the shot has no cut), tracked by a crop that moves.
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    [scene] = plan["scenes"]
    [panel] = scene["panels"]
    assert (scene["layout"], panel["crop_width"], panel["crop_height"]) == ("track", 404, 720)
    path = panel["path"]
    assert len(path) > 10 and path[0]["at"] == 0

    # The Clip's analysis is kept with the Job: MediaPipe found the face in nearly every sampled frame.
    [analysis_file] = (job_dir / "analysis").iterdir()
    frames = json.loads(analysis_file.read_text())["frames"]
    seen = [frame for frame in frames if frame["faces"]]
    assert len(frames) == pytest.approx((candidate["end"] - candidate["start"]) * 25 / 3, abs=1)
    assert len(seen) >= 0.9 * len(frames)
    centres = [face["x"] + face["width"] / 2 for frame in seen for face in frame["faces"]]
    assert max(centres) - min(centres) > panel["crop_width"]
    # On every sampled frame, the face is inside the crop.
    for frame in seen:
        x = [point["x"] for point in path if point["at"] <= frame["at"] + 1e-6][-1]
        for face in frame["faces"]:
            assert x <= face["x"] and face["x"] + face["width"] <= x + panel["crop_width"], frame

    # The Renderer moved the crop as planned: the face stays in the middle of the picture, over the
    # plain background, from the first frame to the last.
    for at in (0.2, 2.5, 5.5):
        middle = output_frame(settings, job_dir / clip["output"]["video"], at)[30:70, 12:42]
        assert (np.abs(middle - BACKGROUND).max(axis=2) > 24).mean() > 0.9, at

    # Rendering again after a hook edit reuses the analysis.
    analysed = analysis_file.stat().st_mtime_ns
    patch(client, job, candidate, hook_text="Hook baru")
    render(client, job)
    [again] = rendered(client, job, timeout=60)["clips"]
    assert again["output"]["hook_text"] == "Hook baru"
    assert [analysis_file] == list((job_dir / "analysis").iterdir())
    assert analysis_file.stat().st_mtime_ns == analysed
    replanned = json.loads((job_dir / again["output"]["plan"]).read_text())
    assert replanned["hook"]["lines"] == ["Hook baru"]
    assert {**replanned, "hook": None} == plan


def shows_head(picture: np.ndarray, background: np.ndarray, share: float = 0.9) -> bool:
    """Whether at least `share` of a region of an output frame is head, not background."""
    return (np.abs(picture - background).max(axis=2) > 24).mean() > share


def colourful(picture: np.ndarray) -> float:
    """The region's mean saturation: its pixels' spread between colour channels."""
    return float((picture.max(axis=2) - picture.min(axis=2)).mean())


def check_split(frame: np.ndarray, background: np.ndarray) -> None:
    """The 54x96 frame shows the colour head (the left one) in the middle of the top panel and the
    grey head (the right one) in the middle of the bottom panel. (Some of the grey head's pixels are
    as bright as the background, which is about 20 in colourfulness.)"""
    top, bottom = frame[10:40, 12:42], frame[58:88, 12:42]
    assert shows_head(top, background) and shows_head(bottom, background, share=0.75)
    assert colourful(top) > 40 and colourful(bottom) < 8


def test_two_faces_side_by_side_are_split_with_the_left_face_on_top(client, settings, video_source, two_faces):
    video_source.video = two_faces
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    [scene] = plan["scenes"]
    top, bottom = scene["panels"]
    assert scene["layout"] == "split"
    assert (top["area"], bottom["area"]) == (
        {"x": 0, "y": 0, "width": 1080, "height": 960}, {"x": 0, "y": 960, "width": 1080, "height": 960}
    )
    assert (top["crop_width"], top["crop_height"]) == (640, 568)
    # MediaPipe found both faces in nearly every sampled frame; each is inside its panel's crop, the
    # left one in the top panel's.
    [analysis_file] = (job_dir / "analysis").iterdir()
    frames = json.loads(analysis_file.read_text())["frames"]
    both = [frame for frame in frames if len(frame["faces"]) == 2]
    assert len(both) >= 0.9 * len(frames)
    for frame in both:
        left, right = sorted(frame["faces"], key=lambda face: face["x"])
        for panel, face in ((top, left), (bottom, right)):
            at = [point for point in panel["path"] if point["at"] <= frame["at"] + 1e-6][-1]
            assert at["x"] <= face["x"] and face["x"] + face["width"] <= at["x"] + panel["crop_width"]
            assert at["y"] <= face["y"] and face["y"] + face["height"] <= at["y"] + panel["crop_height"]

    for at in (0.5, 5.5):
        check_split(output_frame(settings, job_dir / clip["output"]["video"], at), BACKGROUND)


def test_the_layout_switches_at_a_cut_within_one_clip(client, settings, video_source, face_then_two):
    video_source.video = face_then_two
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    # A close-up tracked, then the two people split, cut where the shot changes (3 s into the Source).
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    cut = 3 - candidate["start"]
    assert [scene["layout"] for scene in plan["scenes"]] == ["track", "split"]
    assert plan["scenes"][1]["start"] == pytest.approx(cut, abs=0.02)

    # Every frame is there once, and the sound runs on unbroken for the whole Clip.
    video = job_dir / clip["output"]["video"]
    info = probe(settings, video)
    [picture] = [s for s in info["streams"] if s["codec_type"] == "video"]
    [sound] = [s for s in info["streams"] if s["codec_type"] == "audio"]
    length = candidate["end"] - candidate["start"]
    assert int(picture["nb_frames"]) == pytest.approx(length * 25, abs=1)
    assert float(picture["duration"]) == pytest.approx(length, abs=0.05)
    assert float(sound["duration"]) == pytest.approx(length, abs=0.05)

    # The close-up fills the frame up to its last frame before the cut; from the cut's first frame
    # on, the two panels show the two heads. (A frame is shown from `at` seconds: 0.04 s at 25 fps.)
    for at in (0.3, cut - 0.05):
        assert shows_head(output_frame(settings, video, at)[20:76, 12:42], BACKGROUND), at
    for at in (cut - 0.01, length - 0.3):
        check_split(output_frame(settings, video, at), OTHER_BACKGROUND)


# Captions (ticket 15), on a plain 10 s Source: anything far from its colour is a caption.
CAPTIONS_SECS = 10
# The captions' colours as they come out of the encode.
WHITE, ORANGE = np.array([255, 255, 255]), np.array([0xFF, 0x9F, 0x0A])


@pytest.fixture(scope="session")
def plain_video(tmp_path_factory) -> Path:
    """10 s of a plain 640x360 picture (no faces, so Blur) with a tone."""
    path = tmp_path_factory.mktemp("plain") / "plain.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", f"color=c=0x4a5560:size=640x360:rate=25:duration={CAPTIONS_SECS}",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", str(CAPTIONS_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(path),
    ]
    subprocess.run(command, check=True)
    return path


def full_frame(settings, video: Path, at: float) -> np.ndarray:
    """The Clip's frame at `at` seconds, 1080x1920 RGB."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-ss", f"{at}", "-i", str(video), "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(1920, 1080, 3).astype(int)


def pixels(frame: np.ndarray, colour: np.ndarray, tolerance: int = 40) -> tuple[np.ndarray, np.ndarray]:
    """The rows and columns of the frame's pixels within `tolerance` of `colour` in every channel."""
    return np.nonzero(np.abs(frame - colour).max(axis=2) <= tolerance)


# What the Transcriber hears, on the Source's timeline. The Clip is "Podcast" to "ya" of the
# captions (3.65–6.45 s): "Jadi," and "Oke." are in the 2 s margins either side of it.
HEARD = [
    Word("Jadi,", 1.7, 2.1),
    Word("podcast", 4.0, 4.4),
    Word("ini", 4.45, 4.6),
    Word("seru", 4.65, 5.0),
    Word("banget,", 5.05, 5.4),
    Word("ya!", 5.6, 5.9),
    Word("Oke.", 6.6, 7.0),
]


def test_captions_are_burned_from_the_clips_own_transcription(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start = candidate["start"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    # Transcribed in the Job's language, from 2 s before the Clip to 2 s after it.
    [(language, begin, end)] = transcriber.calls
    assert (language, begin, end) == ("id", pytest.approx(start - 2), pytest.approx(candidate["end"] + 2))
    # The Render Plan's caption lines, on the Clip's timeline, in the lower third (the Clip is Blur).
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    lower = {"x": 130, "y": 1296, "width": 820, "height": 200}
    expected = [
        ("PODCAST INI SERU", 4.0, 5.05, [("PODCAST", 4.0, 4.45), ("INI", 4.45, 4.65), ("SERU", 4.65, 5.05)]),
        ("BANGET YA!", 5.05, 6.2, [("BANGET", 5.05, 5.6), ("YA!", 5.6, 6.2)]),
    ]
    assert len(plan["captions"]) == len(expected)
    for event, (text, on, off, words) in zip(plan["captions"], expected):
        assert (cue_text(event), event["area"]) == (text, lower)
        assert (event["start"], event["end"]) == (pytest.approx(on - start, abs=1e-3), pytest.approx(off - start, abs=1e-3))
        assert [(w["text"], w["start"], w["end"]) for w in cue_words(event)] == [
            (word, pytest.approx(a - start, abs=1e-3), pytest.approx(b - start, abs=1e-3)) for word, a, b in words
        ]

    # Burned in: white with the spoken Word in orange, inside the caption area, only while a line is on.
    video = job_dir / clip["output"]["video"]
    for at, active in ((4.2, "first"), (4.8, "last"), (5.2, "first"), (5.8, "last")):
        frame = full_frame(settings, video, at - start)
        white, orange = pixels(frame, WHITE), pixels(frame, ORANGE)
        assert len(white[0]) > 500 and len(orange[0]) > 300, at
        for rows, columns in (white, orange):
            assert 1296 <= rows.min() and rows.max() < 1496 and 130 <= columns.min() and columns.max() < 950, at
        # The spoken Word is the first or the last of its line.
        assert (orange[1].mean() < white[1].mean()) == (active == "first"), at
    for at in (3.8, 6.3):
        frame = full_frame(settings, video, at - start)
        assert len(pixels(frame, WHITE)[0]) == len(pixels(frame, ORANGE)[0]) == 0, at

    # Rendering again after a hook or layout edit reuses the transcription; a bounds edit transcribes again.
    [words_file] = (job_dir / "words").iterdir()
    transcribed = words_file.stat().st_mtime_ns
    patch(client, job, candidate, hook_text="Hook baru", layout="track")
    render(client, job)
    rendered(client, job)
    assert len(transcriber.calls) == 1 and words_file.stat().st_mtime_ns == transcribed
    longer = patch(client, job, candidate, start=1.0)
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert transcriber.calls[1] == ("id", pytest.approx(max(0, longer["start"] - 2)), pytest.approx(longer["end"] + 2))
    assert len(list((job_dir / "words").iterdir())) == 2


def test_with_captions_off_nothing_is_transcribed_or_burned(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = wait_for(client, create_job(client, captions=False)["id"], "review")
    candidate = add(client, job, "Podcast", "ya")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    assert transcriber.calls == []
    assert json.loads((job_dir / clip["output"]["plan"]).read_text())["captions"] == []
    for at in (4.2, 5.8):
        frame = full_frame(settings, job_dir / clip["output"]["video"], at - candidate["start"])
        assert len(pixels(frame, WHITE)[0]) == len(pixels(frame, ORANGE)[0]) == 0, at


def test_split_captions_are_on_the_seam_and_a_wide_line_is_set_smaller_to_fit(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    # One Word as wide as 20 average letters: at the usual size it would run off both sides.
    transcriber.words = [Word("wwwwwwwwwwwwwww", 4.0, 5.0)]
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), layout="split")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    [event] = json.loads((job_dir / clip["output"]["plan"]).read_text())["captions"]
    assert (cue_text(event), event["area"]) == ("W" * 15, {"x": 130, "y": 860, "width": 820, "height": 200})
    frame = full_frame(settings, job_dir / clip["output"]["video"], 4.5 - candidate["start"])
    rows, columns = pixels(frame, ORANGE)
    assert len(rows) > 1000
    # Centred on the seam, as wide as the area allows and no wider, outline included.
    assert rows.mean() == pytest.approx(960, abs=6)
    assert 130 <= columns.min() < 150 and 930 < columns.max() < 950
    outline_rows, outline_columns = pixels(frame, np.array([0, 0, 0]), tolerance=30)
    assert 860 <= outline_rows.min() and outline_rows.max() < 1060
    assert 130 <= outline_columns.min() and outline_columns.max() < 950


def test_the_hook_as_last_edited_is_burned_over_the_first_3_seconds_above_the_captions(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    start = candidate["start"]
    # Spoken while the hook is on, so that both are on screen together.
    transcriber.words = [Word("halo", start + 1.0, start + 1.4), Word("semua", start + 1.45, start + 2.0)]
    patch(client, job, candidate, hook_text="Hook lama")
    candidate = patch(client, job, candidate, hook_text="  Setetes racun bisa   bunuh perusahaan? ")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    assert clip["output"]["hook_text"] == "Setetes racun bisa bunuh perusahaan?"

    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    hook = plan["hook"]
    assert (hook["lines"], hook["start"], hook["end"], hook["size"]) == (
        ["Setetes racun bisa", "bunuh perusahaan?"], 0.0, 3.0, 88
    )
    area = hook["area"]
    top, bottom, left, right = area["y"], area["y"] + area["height"], area["x"], area["x"] + area["width"]
    assert top == 232 and bottom < 860 and 130 <= left and right <= 950
    [caption] = plan["captions"]
    assert caption["area"] == {"x": 130, "y": 1296, "width": 820, "height": 200}

    video = job_dir / clip["output"]["video"]
    for at in (0.0, 1.5, 2.6):
        frame = full_frame(settings, video, at)
        # Above Blur's shot, the picture is the plain blurred background, except for the hook's box:
        # darker, filling its area and no more, with the white lines inside its padding.
        upper = frame[:600]
        background = upper[100, 540]
        rows, columns = np.nonzero(np.abs(upper - background).max(axis=2) > 15)
        assert (rows.min(), rows.max(), columns.min(), columns.max()) == (top, bottom - 1, left, right - 1), at
        box = upper[top:bottom, left:right]
        dark = (np.abs(box - 0.4 * background).max(axis=2) <= 10).mean()
        assert 0.6 < dark < 0.95, at
        white_rows, white_columns = pixels(upper, WHITE)
        assert len(white_rows) > 3000, at
        assert top + 15 <= white_rows.min() and white_rows.max() < bottom - 15, at
        assert left + 25 <= white_columns.min() and white_columns.max() < right - 25, at
        if at == 1.5:
            # The caption is on at the same time, in the lower third.
            rows, columns = pixels(frame[600:], ORANGE)
            assert len(rows) > 300 and 1296 <= rows.min() + 600 and rows.max() + 600 < 1496
    # Gone after 3 s.
    frame = full_frame(settings, video, 3.3)
    upper = frame[:600]
    assert (np.abs(upper - upper[100, 540]).max(axis=2) > 15).sum() == 0

    # A blank hook shows nothing.
    patch(client, job, candidate, hook_text=" ")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert json.loads((job_dir / clip["output"]["plan"]).read_text())["hook"] is None
    upper = full_frame(settings, video, 1.5)[:600]
    assert (np.abs(upper - upper[100, 540]).max(axis=2) > 15).sum() == 0


def test_captions_and_the_hook_are_burned_in_the_candidates_preset_with_its_overrides(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start = candidate["start"]
    green = "#00FF00"
    candidate = patch(
        client, job, candidate, hook_text="Halo", preset_id="yellow-pop",
        style_overrides={"caption": {"active_colour": green, "position": "top"}, "hook": {"position": "bottom"}},
    )
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)

    # The plan holds the resolved styles: the Preset's, with the overrides.
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    caption, hook = plan["caption_style"], plan["hook_style"]
    assert (caption["font"], caption["size"], caption["active_colour"], caption["position"]) == ("anton", 130, green, "top")
    assert (hook["font"], hook["box_colour"], hook["position"]) == ("anton", "#FFE600", "bottom")
    assert all(event["area"]["y"] == 430 for event in plan["captions"])
    assert plan["hook"]["area"]["y"] + plan["hook"]["area"]["height"] == 1536

    # Burned in: the spoken Word in green at the top, the hook's yellow box at the bottom of the safe area.
    frame = full_frame(settings, job_dir / clip["output"]["video"], 4.2 - start)
    rows, columns = pixels(frame, np.array([0, 255, 0]))
    assert len(rows) > 300 and 430 <= rows.min() and rows.max() < 630
    rows, _ = pixels(frame, np.array([0xFF, 0xE6, 0x00]), tolerance=30)
    assert len(rows) > 5000 and plan["hook"]["area"]["y"] <= rows.min() and rows.max() < 1536
    # No orange highlight in the captions' band (the yellow box's antialiased edge can come near orange).
    assert len(pixels(frame[400:700], ORANGE)[0]) == 0


def test_tracking_and_line_height_space_the_burned_hook_and_captions_as_planned(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start = candidate["start"]
    green, magenta = np.array([0, 255, 0]), np.array([255, 0, 255])
    candidate = patch(client, job, candidate, hook_text="HALO HALO", style_overrides={
        "caption": {"colour": "#FF00FF", "highlight": "none", "outline": 0, "tracking": 24},
        "hook": {"shape": "none", "colour": "#00FF00", "tracking": 60, "line_height": 1.4},
    })
    plan = preview(client, job, candidate)["plan"]
    hook = plan["hook"]
    # One line untracked; spaced out, two.
    assert hook["lines"] == ["HALO", "HALO"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    frame = full_frame(settings, job_dir / clip["output"]["video"], 4.2 - start)
    metrics = font_metrics()
    cap = metrics.cap_height / metrics.units

    def ink(colour: np.ndarray, top: float, bottom: float) -> tuple[int, int, int]:
        """The top row, and the left and right columns, of the colour's pixels between two rows."""
        rows, columns = pixels(frame[round(top):round(bottom)], colour)
        assert len(rows) > 300
        return round(top) + rows.min(), columns.min(), columns.max()

    # Each hook line is as wide as its letters and their tracking, centred on its anchor, and the
    # second line_height sizes below the first.
    tops = []
    for line, (x, baseline) in zip(hook["lines"], hook["anchors"]):
        top, left, right = ink(green, baseline - 1.2 * cap * hook["size"], baseline + 4)
        width = metrics.width(line, hook["size"], 60)
        assert width - 20 < right - left + 1 <= width + 2
        assert (left + right) / 2 == pytest.approx(x, abs=3)
        tops.append(top)
    assert tops[1] - tops[0] == pytest.approx(1.4 * hook["size"], abs=2)
    # So is the caption line, in the middle of its area.
    [caption] = [event for event in plan["captions"] if event["start"] <= 4.2 - start < event["end"]]
    area, size = caption["area"], caption["size"]
    _, left, right = ink(magenta, area["y"], area["y"] + area["height"])
    width = metrics.width(cue_text(caption), size, 24)
    assert width - 20 < right - left + 1 <= width + 2
    assert (left + right) / 2 == pytest.approx(area["x"] + area["width"] / 2, abs=3)


@pytest.mark.parametrize("font", ["montserrat-black", "anton", "bangers"])
def test_a_two_line_cue_is_burned_on_two_rows_one_font_size_apart_with_the_box_on_the_second(
    client, settings, video_source, transcriber, plain_video, font
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start = candidate["start"]
    # Sentence's line limits, with the box highlight.
    candidate = patch(client, job, candidate, style_overrides={"caption": {
        "max_lines": 2, "max_chars": 24, "max_secs": 5, "pause_secs": 0.7, "highlight": "box", "font": font,
    }})
    assert candidate["style_overrides"]["caption"]["max_lines"] == 2
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    [cue] = plan["captions"]
    assert [" ".join(word["text"] for word in line) for line in cue["lines"]] == ["PODCAST INI", "SERU BANGET YA!"]
    area, size = cue["area"], cue["size"]
    middle = area["y"] + area["height"] / 2
    metrics = font_metrics(font)
    cap = metrics.cap_height / metrics.units * size

    # "BANGET", the second line's second Word, is spoken: white text over an orange box.
    frame = full_frame(settings, job_dir / clip["output"]["video"], 5.2 - start)
    rows, columns = pixels(frame, WHITE)
    above, below = rows[rows < middle], rows[rows >= middle]
    assert len(above) > 500 and len(below) > 500
    # Two rows of capitals, each a capital tall, one font size apart about the area's middle (libass
    # sets a line as tall as the font size).
    assert above.max() - above.min() == pytest.approx(cap, abs=4)
    assert below.max() - below.min() == pytest.approx(cap, abs=4)
    assert below.min() - above.min() == pytest.approx(size, abs=2)
    assert (above.min() + below.max()) / 2 == pytest.approx(middle, abs=size / 4)
    # The box is behind the second line, from the middle of its line rightwards, and not the first.
    box_rows, box_columns = pixels(frame, ORANGE)
    assert len(box_rows) > 500
    assert above.max() < box_rows.min() < below.min() and below.max() < box_rows.max()
    second = columns[rows >= middle]
    assert second.min() < box_columns.min() and box_columns.max() < second.max()


def test_the_hooks_soft_shadow_and_its_boxs_padding_and_radius_are_burned_as_planned(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start = candidate["start"]
    green, blue = np.array([0, 255, 0]), np.array([0, 0, 255])
    look = {"colour": "#00FF00", "box_colour": "#0000FF", "box_opacity": 1.0, "shape": "block"}
    default = preview(client, job, patch(client, job, candidate, hook_text="HALO", style_overrides={"hook": look}))["plan"]["hook"]
    # Captions saved before drop shadows: a hard magenta shadow 4 px right and down.
    candidate = patch(client, job, candidate, hook_text="HALO", style_overrides={
        "hook": {**look, "padding_x": 90, "padding_y": 50, "radius": 60,
                 "shadow": {"colour": "#FF0000", "opacity": 1, "blur": 12, "distance": 16, "angle": 45}},
        "caption": {"shadow": 4, "shadow_colour": "#FF00FF", "highlight": "none", "outline": 0},
    })
    assert candidate["style_overrides"]["caption"]["shadow"]["colour"] == "#FF00FF"
    plan = preview(client, job, candidate)["plan"]
    hook = plan["hook"]
    # Padded, the box is wider and taller round the same line.
    assert hook["lines"] == default["lines"] and hook["size"] == default["size"]
    area = hook["area"]
    assert (area["width"] - default["area"]["width"], area["height"] - default["area"]["height"]) == (2 * (90 - 36), 2 * (50 - 26))
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    frame = full_frame(settings, job_dir / clip["output"]["video"], 4.2 - start)
    top, left, bottom, right = area["y"], area["x"], area["y"] + area["height"], area["x"] + area["width"]

    # The box fills its area, but for its rounded corners.
    rows, columns = pixels(frame[:900], blue, tolerance=60)
    assert (rows.min(), rows.max(), columns.min(), columns.max()) == (top, bottom - 1, left, right - 1)
    middle = (top + bottom) // 2
    assert (np.abs(frame[top + 2, (left + right) // 2] - blue).max() <= 60) and (np.abs(frame[middle, left + 2] - blue).max() <= 60)
    assert np.abs(frame[top + 4, left + 4] - blue).max() > 100 and np.abs(frame[bottom - 5, right - 5] - blue).max() > 100

    # The shadow falls down and to the right of the letters, soft.
    box = frame[top:bottom, left:right]
    letters = np.abs(box - green).max(axis=2) <= 60
    # Red over the box (the encode leaves a little red in the blue).
    redness = np.clip(box[:, :, 0] - box[:, :, 1] - 30, 0, 255) * ~letters
    ys, xs = np.nonzero(letters)
    weight = redness.sum()
    assert weight > 0
    shadow_y = (redness.sum(axis=1) * np.arange(box.shape[0])).sum() / weight
    shadow_x = (redness.sum(axis=0) * np.arange(box.shape[1])).sum() / weight
    # Its middle about 11 px right of and below the letters' (16 px at 45°), give or take what they hide.
    assert 8 < shadow_x - xs.mean() < 20 and 8 < shadow_y - ys.mean() < 20
    # None of it above or left of the letters but its blur's; much of it blurred, between red and the box.
    assert redness[: ys.min() - 8].sum() == 0 and redness[:, : xs.min() - 8].sum() == 0
    partial = ((box[:, :, 0] > 60) & (box[:, :, 0] < 200) & ~letters).sum()
    assert partial > 0.3 * (redness > 0).sum()

    # The caption's migrated shadow: magenta, right of and below its white letters, as before.
    [caption] = [event for event in plan["captions"] if event["start"] <= 4.2 - start < event["end"]]
    band = frame[caption["area"]["y"]:caption["area"]["y"] + caption["area"]["height"]]
    white_rows, white_columns = pixels(band, WHITE)
    magenta_rows, magenta_columns = pixels(band, np.array([255, 0, 255]))
    assert len(magenta_rows) > 300
    assert magenta_rows.max() - white_rows.max() == pytest.approx(4, abs=1)
    assert magenta_columns.max() - white_columns.max() == pytest.approx(4, abs=1)


# The clip editor's Preview Plan and preparation (clip-editor ticket 03).


def preview(client, job: dict, candidate: dict, draft: dict | None = None) -> dict:
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan", json=draft)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_preview_plan_is_the_plan_the_render_makes(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), hook_text="Halo", preset_id="yellow-pop")
    start = candidate["start"]

    # Before a render: the episode Transcript's Words, one Scene, the captions and the hook planned.
    before = preview(client, job, candidate)
    assert (before["words_source"], before["analysed"]) == ("transcript", False)
    episode = [w for w in job["transcript"]["words"] if candidate["start"] < (w["start"] + w["end"]) / 2 < candidate["end"]]
    assert [(w["text"], w["start"]) for w in before["words"]] == [
        (w["text"], pytest.approx(w["start"] - start, abs=1e-3)) for w in episode
    ]
    assert [w["text"] for w in episode][0] == "Podcast"
    assert len(before["plan"]["scenes"]) == 1 and before["plan"]["captions"]
    assert before["plan"]["hook"]["lines"] == ["Halo"] and before["plan"]["caption_style"]["font"] == "anton"

    render(client, job)
    [clip] = rendered(client, job)["clips"]
    after = preview(client, job, candidate)
    assert (after["words_source"], after["analysed"]) == ("clip", True)
    # The Clip's own Words (in it, not its margins), and exactly the plan its render saved.
    assert [word["text"] for word in after["words"]] == ["podcast", "ini", "seru", "banget,", "ya!"]
    assert after["words"][0]["start"] == pytest.approx(4.0 - start, abs=1e-3)
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert after["plan"] == json.loads((job_dir / clip["output"]["plan"]).read_text())


def test_a_draft_is_planned_without_being_saved(client, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    draft = preview(client, job, candidate, {
        "hook_text": "Kenapa?", "style_overrides": {"caption": {"position": "top"}, "hook": {"position": "middle"}},
    })
    assert draft["plan"]["hook"]["lines"] == ["Kenapa?"]
    assert {event["area"]["y"] for event in draft["plan"]["captions"]} == {430}
    assert preview(client, job, candidate)["plan"]["hook"] is None
    # Placed on the preview: the hook's and each caption line's middle at x.
    placed = {"position": "custom", "x": 400, "y": 900}
    moved = preview(client, job, candidate, {"hook_text": "Kenapa?", "style_overrides": {"caption": placed, "hook": placed}})["plan"]
    middle = lambda area: area["x"] + area["width"] / 2
    assert abs(middle(moved["hook"]["area"]) - 400) <= 1 and moved["hook"]["area"]["y"] == 900
    assert {middle(event["area"]) for event in moved["captions"]} == {400}
    [saved] = client.get(f"/api/jobs/{job['id']}").json()["candidates"]
    assert (saved["hook_text"], saved["style_overrides"]) == ("", {"caption": {}, "hook": {}, "watermark": {}})

    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan"
    assert client.post(url, json={"style_overrides": {"caption": {"size": 1}}}).status_code == 422
    assert client.post(url, json={"start": 9999}).status_code == 422
    assert client.post(url, json={"preset_id": "nope"}).status_code == 404
    assert client.post(f"/api/jobs/{job['id']}/candidates/nope/preview-plan").status_code == 404


def test_preparing_a_candidate_transcribes_and_analyses_it_without_a_render(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/prepare"
    response = client.post(url)
    assert response.status_code == 202, response.text
    done = rendered(client, job)
    assert (done["preparing"], done["clips"]) == ([], [])
    assert "rendering" in [change["status"] for change in done["history"]]
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert len(list((job_dir / "words").iterdir())) == len(list((job_dir / "analysis").iterdir())) == 1
    assert not (job_dir / "clips").exists() or not list((job_dir / "clips").iterdir())
    prepared = preview(client, job, candidate)
    assert (prepared["words_source"], prepared["analysed"]) == ("clip", True)

    # Prepared already: nothing is queued, and the Job stays in review.
    assert client.post(url).json()["status"] == "review"
    assert len(transcriber.calls) == 1
    # A render then uses what was prepared.
    render(client, job)
    rendered(client, job)
    assert len(transcriber.calls) == 1

    assert client.post(f"/api/jobs/{job['id']}/candidates/nope/prepare").status_code == 404


def test_without_captions_the_preview_has_none_but_still_gives_the_words(client, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = wait_for(client, create_job(client, captions=False)["id"], "review")
    candidate = add(client, job, "Podcast", "ya")
    plan = preview(client, job, candidate)
    assert plan["plan"]["captions"] == [] and [word["text"] for word in plan["words"]][0] == "Podcast"
    # Preparing analyses it without transcribing.
    client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/prepare")
    rendered(client, job)
    assert transcriber.calls == [] and preview(client, job, candidate)["analysed"] is True


def test_word_edits_are_saved_previewed_and_rendered(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    render(client, job)
    rendered(client, job)
    words = preview(client, job, candidate)["words"]
    seru, banget = words[2], words[3]
    start = candidate["start"]
    at = lambda word: start + (word["start"] + word["end"]) / 2  # noqa: E731
    edits = [
        {"at": at(seru), "text": "  keren "},
        {"at": at(banget), "break_before": True},
        {"at": at(words[1]), "text": ""},
        {"at": 1.0},  # changes nothing: dropped
    ]
    candidate = patch(client, job, candidate, word_edits=edits)
    assert candidate["edited"] is True
    assert candidate["word_edits"] == [
        {"at": at(words[1]), "text": "", "break_before": False, "media": None},
        {"at": at(seru), "text": "keren", "break_before": False, "media": None},
        {"at": at(banget), "text": None, "break_before": True, "media": None},
    ]
    # The preview gives each Word its edit, as saved.
    shown = preview(client, job, candidate)
    assert [w["edit"] for w in shown["words"]] == [None, candidate["word_edits"][0], candidate["word_edits"][1], candidate["word_edits"][2], None]
    assert [cue_text(event) for event in shown["plan"]["captions"]] == ["PODCAST KEREN", "BANGET YA!"]

    render(client, job)
    [clip] = rendered(client, job)["clips"]
    plan = json.loads((settings.data_dir / "jobs" / job["id"] / clip["output"]["plan"]).read_text())
    assert [cue_text(event) for event in plan["captions"]] == ["PODCAST KEREN", "BANGET YA!"]

    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    for bad in ([{"at": 1.0, "text": "x" * 41}], [{"at": "inf", "text": "x"}], [{"at": 1.0, "text": "x"}] * 501, [{"text": "x"}]):
        assert client.patch(url, json={"word_edits": bad}).status_code == 422


# A Cue Edit's own place and size, unset.
UNPLACED = {"x": None, "y": None, "scale": None}


def test_cue_edits_are_saved_previewed_and_rendered(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    render(client, job)
    rendered(client, job)
    before = preview(client, job, candidate)["plan"]["captions"]
    first, second = before[0], before[1]
    assert first["end"] - first["start"] > 0.5 and not first["edited"]
    # The first Cue goes 0.2 s sooner, the second comes up when the first goes; keyed by any time in
    # their first Words. Two of one Cue: the later.
    edits = [
        {"at": first["key"]["at"] + 0.01, "end_delta": -0.3},
        {"at": second["key"]["at"], "start_delta": -9.0},
        {"at": first["key"]["at"] + 0.01, "end_delta": -0.2},
    ]
    candidate = patch(client, job, candidate, cue_edits=edits)
    assert candidate["edited"] is True
    assert candidate["cue_edits"] == [
        {"at": first["key"]["at"] + 0.01, "media": None, "shift": 0.0, "start_delta": 0.0, "end_delta": -0.2, **UNPLACED, "join": False},
        {"at": second["key"]["at"], "media": None, "shift": 0.0, "start_delta": -9.0, "end_delta": 0.0, **UNPLACED, "join": False},
    ]
    shown = preview(client, job, candidate)["plan"]
    after = shown["captions"]
    assert [cue["edited"] for cue in after[:2]] == [True, True] and shown["unused_cue_edits"] == []
    assert (after[0]["start"], after[0]["end"]) == (first["start"], pytest.approx(first["end"] - 0.2, abs=1e-3))
    assert after[1]["start"] == after[0]["end"]
    assert [cue_text(cue) for cue in after] == [cue_text(cue) for cue in before]

    # The render is planned as the preview was.
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert json.loads((settings.data_dir / "jobs" / job["id"] / clip["output"]["plan"]).read_text()) == shown

    # One whose Word the Clip doesn't show is unused, and kept.
    away = patch(client, job, candidate, cue_edits=[*candidate["cue_edits"], {"at": 1.0, "shift": 1.0}])
    assert [edit["at"] for edit in preview(client, job, away)["plan"]["unused_cue_edits"]] == [1.0]
    assert [edit["at"] for edit in away["cue_edits"]] == [1.0, first["key"]["at"] + 0.01, second["key"]["at"]]

    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    for bad in (
        [{"at": 1.0, "shift": 10.5}], [{"at": 1.0, "start_delta": -11}], [{"at": 1.0, "end_delta": "inf"}],
        [{"at": 1.0, "media": "nope"}], [{"shift": 1.0}], [{"at": 1.0}] * 501,
        # A join sets nothing else.
        [{"at": 1.0, "join": True, "shift": 0.5}], [{"at": 1.0, "join": True, "end_delta": -0.1}], [{"at": 1.0, "join": True, "y": 700}],
    ):
        assert client.patch(url, json={"cue_edits": bad}).status_code == 422
    joined = patch(client, job, candidate, cue_edits=[{"at": second["key"]["at"], "join": True}])
    assert joined["cue_edits"] == [{"at": second["key"]["at"], "media": None, "shift": 0.0, "start_delta": 0.0, "end_delta": 0.0, **UNPLACED, "join": True}]


def test_a_cue_placed_and_scaled_alone_is_burned_at_its_place_and_the_next_at_the_styles(
    client, settings, video_source, transcriber, plain_video
):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    magenta = np.array([255, 0, 255])
    candidate = patch(client, job, candidate, hook_text="", style_overrides={
        "caption": {"colour": "#FF00FF", "highlight": "none", "outline": 0, "size": 80},
    })
    # Rendered once, its Cues are planned from the Clip's own Words.
    render(client, job)
    rendered(client, job)
    first, second = preview(client, job, candidate)["plan"]["captions"][:2]
    candidate = patch(client, job, candidate, cue_edits=[{"at": first["key"]["at"], "x": 360, "y": 600, "scale": 1.5}])
    assert candidate["cue_edits"] == [{
        "at": first["key"]["at"], "media": None, "shift": 0.0, "start_delta": 0.0, "end_delta": 0.0,
        "x": 360, "y": 600, "scale": 1.5, "join": False,
    }]
    plan = preview(client, job, candidate)["plan"]
    moved, after = plan["captions"][:2]
    assert moved["size"] == 120 and after["size"] == 80 and after["area"] == second["area"]
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert json.loads((job_dir / clip["output"]["plan"]).read_text()) == plan
    metrics = font_metrics()

    def ink(cue: dict) -> tuple[float, float, int]:
        """Where the cue's magenta ink is, mid-cue: its rows' and columns' middles, and its width."""
        frame = full_frame(settings, job_dir / clip["output"]["video"], (cue["start"] + cue["end"]) / 2)
        rows, columns = pixels(frame, magenta)
        assert len(rows) > 300
        return (rows.min() + rows.max()) / 2, (columns.min() + columns.max()) / 2, columns.max() - columns.min() + 1

    # The moved Cue is centred at 600 px down, half as big again, and as near 360 px across as keeps
    # its line in the frame; the next one is where the style puts it.
    half = metrics.width(cue_text(moved), 120) / 2
    assert half > 360 and moved["area"]["x"] + moved["area"]["width"] / 2 == round(half)
    row, column, width = ink(moved)
    assert row == pytest.approx(600, abs=30) and column == pytest.approx(half, abs=4)
    assert width == pytest.approx(metrics.width(cue_text(moved), 120), abs=20)
    row, column, width = ink(after)
    assert after["area"]["y"] <= row <= after["area"]["y"] + after["area"]["height"] and column == pytest.approx(540, abs=4)
    assert width == pytest.approx(metrics.width(cue_text(after), 80), abs=20)

    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    for bad in ([{"at": 1.0, "scale": 4.5}], [{"at": 1.0, "scale": 0.1}], [{"at": 1.0, "x": 1081}], [{"at": 1.0, "y": -1}]):
        assert client.patch(url, json={"cue_edits": bad}).status_code == 422


def test_one_scene_is_rendered_in_its_overridden_layout(client, settings, video_source, face_then_two):
    video_source.video = face_then_two
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # The two people's Scene (from 3 s into the Source) in Blur instead of Split.
    candidate = patch(client, job, candidate, layout_overrides=[{"at": 4.5, "layout": "blur"}])
    assert candidate["edited"] is True and candidate["layout_overrides"] == [{"at": 4.5, "layout": "blur", "framing": None, "keys": {}}]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    assert [scene["layout"] for scene in plan["scenes"]] == ["track", "blur"]
    assert preview(client, job, candidate)["plan"] == plan

    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    assert client.patch(url, json={"layout_overrides": [{"at": 1.0, "layout": "sideways"}]}).status_code == 422
    assert client.patch(url, json={"layout_overrides": [{"at": 1.0, "layout": "blur"}] * 201}).status_code == 422


def test_a_clip_records_the_editors_edits_it_was_rendered_with(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(
        client, job, candidate, preset_id="minimal", style_overrides={"caption": {"size": 80}, "hook": {}},
        word_edits=[{"at": 4.5, "text": "keren"}], hook_start=0.5, hook_secs=2.0,
        layout_overrides=[{"at": 4.0, "layout": "track"}],
    )
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    output = clip["output"]
    for field in ("preset_id", "style_overrides", "word_edits", "hook_start", "hook_secs", "layout_overrides"):
        assert output[field] == candidate[field], field
    assert (output["caption_style"]["font"], output["caption_style"]["size"]) == ("poppins-black", 80)
    assert output["hook_style"]["font"] == "poppins-black"


# The Kicker (hook-styles ticket 03).


def test_a_kicker_and_emphasis_are_saved_previewed_rendered_and_recorded(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), hook_text="*Halo* semua")
    assert candidate["hook_kicker"] == ""
    # A draft Kicker is planned, not saved.
    draft = preview(client, job, candidate, {"hook_kicker": "Fakta"})
    assert draft["plan"]["hook"]["kicker"]["text"] == "Fakta"
    assert preview(client, job, candidate)["plan"]["hook"]["kicker"] is None

    candidate = patch(client, job, candidate, hook_kicker="  Terbongkar\n  lho ")
    assert (candidate["hook_kicker"], candidate["edited"]) == ("Terbongkar lho", True)
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}"
    assert client.patch(url, json={"hook_kicker": "x" * 25}).status_code == 422
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["output"]["hook_kicker"] == "Terbongkar lho"
    plan = json.loads((settings.data_dir / "jobs" / job["id"] / clip["output"]["plan"]).read_text())
    assert plan["hook"]["kicker"]["text"] == "Terbongkar lho"
    assert (plan["hook"]["lines"], plan["hook"]["emphasis"]) == (["Halo semua"], [[[0, 4]]])


# Caption files (captions-advanced ticket 10).


def subtitle_time(secs: float, mark: str) -> str:
    ms = round(secs * 1000)
    return f"{ms // 3_600_000:02d}:{ms // 60_000 % 60:02d}:{ms // 1000 % 60:02d}{mark}{ms % 1000:03d}"


def test_a_render_writes_srt_and_vtt_beside_the_mp4_in_the_words_own_case(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # "ini" corrected; the Caption Style is in UPPERCASE and strips end punctuation.
    candidate = patch(client, job, candidate, word_edits=[{"at": 4.5, "text": "Keren"}])
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    output = clip["output"]
    assert (output["srt"], output["vtt"]) == (f"clips/{candidate['id']}.srt", f"clips/{candidate['id']}.vtt")

    plan = json.loads((job_dir / output["plan"]).read_text())
    assert [cue_text(cue) for cue in plan["captions"]] == ["PODCAST KEREN", "SERU BANGET YA!"]
    first, second = plan["captions"]
    srt = (
        f"1\n{subtitle_time(first['start'], ',')} --> {subtitle_time(first['end'], ',')}\npodcast Keren\n\n"
        f"2\n{subtitle_time(second['start'], ',')} --> {subtitle_time(second['end'], ',')}\nseru banget, ya!\n"
    )
    vtt = (
        "WEBVTT\n\n"
        f"1\n{subtitle_time(first['start'], '.')} --> {subtitle_time(first['end'], '.')}\npodcast Keren\n\n"
        f"2\n{subtitle_time(second['start'], '.')} --> {subtitle_time(second['end'], '.')}\nseru banget, ya!\n"
    )
    assert (job_dir / output["srt"]).read_text() == srt
    assert (job_dir / output["vtt"]).read_text() == vtt
    # Served from the Job's directory, as the MP4 is.
    for file, text, kind in ((output["srt"], srt, "application/x-subrip"), (output["vtt"], vtt, "text/vtt")):
        response = client.get(f"/media/{job['id']}/{file}")
        assert response.status_code == 200 and response.text == text
        assert response.headers["content-type"].startswith(kind)
    # A Clip is deleted with its Job, and its caption files with it.
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert not job_dir.exists()


def test_with_captions_off_a_render_writes_no_caption_files(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = wait_for(client, create_job(client, captions=False)["id"], "review")
    candidate = add(client, job, "Podcast", "ya")
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, clip, candidate)
    assert (clip["output"]["srt"], clip["output"]["vtt"]) == (None, None)
    assert sorted(path.suffix for path in (job_dir / "clips").iterdir()) == [".jpg", ".json", ".mp4"]
    # Nor is there anything to download.
    assert client.get(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/captions/srt").status_code == 409


def subtitle_file(cues: list[dict], format: str) -> str:
    """The caption file a plan's Cues (its JSON) make in `format`, as the writer's tests spell it."""
    mark = "," if format == "srt" else "."
    blocks = [
        f"{number}\n{subtitle_time(cue['start'], mark)} --> {subtitle_time(cue['end'], mark)}\n" + "".join(f"{line}\n" for line in cue["plain"])
        for number, cue in enumerate(cues, 1)
    ]
    return "\n".join(["WEBVTT\n"] * (format == "vtt") + blocks)


def test_a_candidates_captions_are_downloaded_from_its_saved_state_without_a_render(client, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    url = f"/api/jobs/{job['id']}/candidates/{candidate['id']}/captions"
    # Before a render: the episode Transcript's Words, as the Preview Plan has them, with the saved
    # Word Edits (the one on "ya", keyed by its middle), in their own case.
    ya = next(word for word in job["transcript"]["words"] if word["text"] == "ya")
    patch(client, job, candidate, word_edits=[{"at": (ya["start"] + ya["end"]) / 2, "text": "Ya."}])
    cues = preview(client, job, candidate)["plan"]["captions"]
    assert cues and [line for cue in cues for line in cue["plain"]][-1].endswith("Ya.")
    for format, kind in (("srt", "application/x-subrip"), ("vtt", "text/vtt")):
        response = client.get(f"{url}/{format}")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith(kind)
        assert response.text == subtitle_file(cues, format)
    assert "PODCAST" not in client.get(f"{url}/srt").text

    # Once rendered, the Clip's own Words.
    render(client, job)
    rendered(client, job)
    after = preview(client, job, candidate)["plan"]["captions"]
    assert after != cues and client.get(f"{url}/srt").text == subtitle_file(after, "srt")

    assert client.get(f"{url}/ass").status_code == 422
    assert client.get(f"/api/jobs/{job['id']}/candidates/nope/captions/srt").status_code == 404
    assert client.get("/api/jobs/nope/candidates/nope/captions/srt").status_code == 404
