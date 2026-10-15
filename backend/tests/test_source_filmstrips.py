"""Filmstrips of a Job's Source, per 30-second chunk, made on request (.scratch/timeline-visuals/
issues/04-filmstrip-on-source-segments.md, docs/adr/0005-timeline-media-is-derived-per-chunk.md).
Seam A, through the API with the real ffmpeg."""

import json
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app import derived
from app.config import load_settings


def make(path: Path, *args: str) -> Path:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path


@pytest.fixture(scope="session")
def long_source(tmp_path_factory) -> Path:
    """A 65 s 64x48 test pattern."""
    return make(
        tmp_path_factory.mktemp("sources") / "long.mp4", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=5:duration=65",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    )


def with_source(client, video_source, video: Path) -> dict:
    """A Job whose Video Source fetched `video`, once its Source is there."""
    video_source.video = video
    job = client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=fixture"}).json()
    deadline = time.monotonic() + 10
    while (job := client.get(f"/api/jobs/{job['id']}").json())["source"] is None:
        assert time.monotonic() < deadline, f"Job stayed {job['status']} without its Source"
        time.sleep(0.01)
    return job


def size(settings, picture: bytes, tmp_path: Path) -> tuple[int, int]:
    """A JPEG's width and height."""
    path = tmp_path / "chunk.jpg"
    path.write_bytes(picture)
    out = subprocess.run(
        [str(settings.ffprobe_bin), "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    width, height = out.split(",")
    return int(width), int(height)


def strips(settings, job_id: str) -> Path:
    return settings.data_dir / "jobs" / job_id / "strips" / "v1-1fps-h112"


def test_a_source_has_a_chunk_per_30_seconds_made_when_asked_for(client, settings, video_source, long_source, tmp_path):
    job = with_source(client, video_source, long_source)
    # Nothing is made until it is asked for.
    assert not strips(settings, job["id"]).exists()

    frames = []
    for start in (0, 30, 60):
        chunk = client.get(f"/api/jobs/{job['id']}/filmstrip/v1/{start}.jpg")
        assert chunk.status_code == 200 and chunk.headers["content-type"] == "image/jpeg", start
        assert "immutable" in chunk.headers["cache-control"]
        frames.append(int(chunk.headers["x-frames"]))
        # 64x48 at 112px tall: 149.3, rounded to even.
        assert size(settings, chunk.content, tmp_path) == (frames[-1] * 150, 112)
    assert frames == [30, 30, 5]
    assert sorted(path.name for path in strips(settings, job["id"]).iterdir()) == ["0.jpg", "30.jpg", "60.jpg"]

    # Off the grid, past the end, before the start; and a Job that isn't there.
    for start in (15, 90, -30):
        assert client.get(f"/api/jobs/{job['id']}/filmstrip/v1/{start}.jpg").status_code == 404, start
    assert client.get("/api/jobs/0123456789ab/filmstrip/v1/0.jpg").status_code == 404


def test_a_chunk_is_made_once(client, settings, video_source, long_source):
    job = with_source(client, video_source, long_source)
    url = f"/api/jobs/{job['id']}/filmstrip/v1/30.jpg"
    first = client.get(url)
    made = (strips(settings, job["id"]) / "30.jpg").stat().st_mtime_ns

    assert client.get(url).content == first.content
    assert (strips(settings, job["id"]) / "30.jpg").stat().st_mtime_ns == made


def test_two_requests_at_once_for_one_chunk_both_get_it_and_leave_one_file(client, settings, video_source, long_source):
    job = with_source(client, video_source, long_source)
    url = f"/api/jobs/{job['id']}/filmstrip/v1/0.jpg"
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda _: client.get(url), range(2)))

    assert [answer.status_code for answer in answers] == [200, 200]
    assert answers[0].content == answers[1].content
    # No temporary file left behind.
    assert [path.name for path in strips(settings, job["id"]).iterdir()] == ["0.jpg"]


def test_a_source_the_browser_cant_play_is_read_from_its_preview_proxy(client, settings, tmp_path, wait_for_status):
    # An MKV master gets a preview proxy on upload.
    master = make(
        tmp_path / "master.mkv", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=5:duration=2", "-f", "lavfi", "-i",
        "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
    )
    options = {"language": "id", "min_secs": 2, "max_secs": 6, "captions": False, "brief": "cari momen lucu"}
    with master.open("rb") as file:
        created = client.post(
            "/api/jobs/upload", data={"options": json.dumps(options)}, files={"file": ("master.mkv", file, "video/x-matroska")}
        )
    job = wait_for_status(created.json()["id"], "review", "error")
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert job["source"]["preview"] == "preview.mp4"
    # Without the master, the chunk can only come from the proxy.
    (job_dir / job["source"]["video"]).unlink()

    chunk = client.get(f"/api/jobs/{job['id']}/filmstrip/v1/0.jpg")
    assert chunk.status_code == 200 and chunk.headers["x-frames"] == "2"
    assert size(settings, chunk.content, tmp_path)[1] == 112


def decodes(monkeypatch) -> list[list[str]]:
    """The ffmpeg commands derived media runs from now on (still run)."""
    commands: list[list[str]] = []
    run = derived._run

    def spy(command: list[str], what: str) -> bytes:
        commands.append(command)
        return run(command, what)

    monkeypatch.setattr(derived, "_run", spy)
    return commands


def threads(command: list[str]) -> str:
    """The decoding threads asked of ffmpeg: those set before its input."""
    return command[command.index("-threads", 0, command.index("-i")) + 1]


def test_a_chunk_is_decoded_on_every_core_while_the_worker_is_idle(client, settings, video_source, long_source, wait_for_status, monkeypatch):
    job = with_source(client, video_source, long_source)
    wait_for_status(job["id"], "review")
    commands = decodes(monkeypatch)

    assert client.get(f"/api/jobs/{job['id']}/filmstrip/v1/0.jpg").status_code == 200
    assert threads(commands[-1]) == "0"


def test_a_chunk_is_decoded_on_one_thread_while_the_worker_runs_a_job(client, settings, video_source, long_source, wait_for_status, monkeypatch):
    job = with_source(client, video_source, long_source)
    wait_for_status(job["id"], "review")
    # Another Job's download is held: the Worker is busy with it.
    video_source.hold()
    try:
        client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=another"})
        deadline = time.monotonic() + 5
        while not client.app.state.worker.busy:
            assert time.monotonic() < deadline, "The Worker never took the other Job"
            time.sleep(0.01)
        commands = decodes(monkeypatch)
        assert client.get(f"/api/jobs/{job['id']}/filmstrip/v1/30.jpg").status_code == 200
        assert threads(commands[-1]) == "1"
    finally:
        video_source.release()


def test_waiting_requests_are_served_latest_first(tmp_path):
    # One chunk is being made; three more are asked for, one after another, while it is.
    made: list[str] = []
    started = threading.Event()
    go = threading.Event()

    def make(name: str):
        def write(part: Path) -> None:
            if name == "first":
                started.set()
                go.wait(5)
            made.append(name)
            part.write_bytes(b"x")

        return write

    with ThreadPoolExecutor(4) as pool:
        first = pool.submit(derived.on_demand, tmp_path / "first", make("first"))
        started.wait(5)
        later = []
        for name in ("a", "b", "c"):
            later.append(pool.submit(derived.on_demand, tmp_path / name, make(name)))
            time.sleep(0.1)
        go.set()
        for future in [first, *later]:
            future.result(5)

    # The one asked for last (where a fling stopped) is made next.
    assert made == ["first", "c", "b", "a"]
