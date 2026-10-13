import subprocess
import time
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, load_settings
from app.main import create_app
from app.ports import Ports
from fakes import FakeVideoSource

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return replace(load_settings(), data_dir=tmp_path / "data")


@pytest.fixture(scope="session")
def fixture_video(tmp_path_factory) -> Path:
    """A 2-second 320x180, 25 fps H.264 test pattern with a sine tone."""
    path = tmp_path_factory.mktemp("fixtures") / "source.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440",
        "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
    ]
    subprocess.run(command, check=True)
    return path


@pytest.fixture
def video_source(settings, fixture_video) -> FakeVideoSource:
    return FakeVideoSource(fixture_video, FIXTURES / "captions.json3", settings.ffprobe_bin)


@pytest.fixture
def client(settings, video_source):
    with TestClient(create_app(settings, Ports(video_source=video_source))) as client:
        try:
            yield client
        finally:
            video_source.release()


@pytest.fixture
def wait_for_status(client) -> Callable[..., dict]:
    """Poll the API until the Job reaches one of `statuses`, and return it."""

    def wait(job_id: str, *statuses: str, timeout: float = 5) -> dict:
        deadline = time.monotonic() + timeout
        while (job := client.get(f"/api/jobs/{job_id}").json())["status"] not in statuses:
            assert time.monotonic() < deadline, f"Job stayed {job['status']}, expected one of {statuses}"
            time.sleep(0.01)
        return job

    return wait
