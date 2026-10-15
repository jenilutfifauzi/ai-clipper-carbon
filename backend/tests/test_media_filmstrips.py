"""Filmstrips of Media Library videos, per 30-second chunk (.scratch/timeline-visuals/issues/
03-filmstrip-on-media-segments.md, docs/adr/0005-timeline-media-is-derived-per-chunk.md). Seam A,
through the API with the real ffmpeg."""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.config import load_settings


def make(path: Path, *args: str) -> bytes:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path.read_bytes()


@pytest.fixture(scope="session")
def files(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s 320x240 video with a tone, a 65 s 64x48 one, and a PNG."""
    folder = tmp_path_factory.mktemp("filmstrips")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "video": make(folder / "clip.mov", *lavfi, "testsrc=size=320x240:rate=25:duration=2", *lavfi,
                      "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "long": make(folder / "long.mp4", *lavfi, "testsrc=size=64x48:rate=5:duration=65", "-c:v", "libx264",
                     "-preset", "ultrafast"),
        "image": make(folder / "still.png", *lavfi, "color=c=blue:size=64x48", "-frames:v", "1"),
    }


def upload(client, data: bytes, name: str) -> dict:
    answer = client.post("/api/media", files={"file": (name, data, "application/octet-stream")})
    assert answer.status_code == 201, answer.text
    return answer.json()


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


def strips(settings, media_id: str) -> Path:
    return settings.data_dir / "media" / f"{media_id}.strips" / "v1-1fps-h112"


def test_an_uploaded_video_has_its_filmstrip_ready(client, settings, files, tmp_path):
    video = upload(client, files["video"], "intro.mov")
    # Made by the upload, before any request.
    assert sorted(path.name for path in strips(settings, video["id"]).iterdir()) == ["0.jpg"]

    chunk = client.get(f"/api/media/{video['id']}/filmstrip/v1/0.jpg")
    assert chunk.status_code == 200 and chunk.headers["content-type"] == "image/jpeg"
    assert chunk.headers["x-frames"] == "2"
    assert "immutable" in chunk.headers["cache-control"]
    # Two frames of 320x240 at 112px tall, each 150px wide (149.3, rounded to even), side by side.
    assert size(settings, chunk.content, tmp_path) == (2 * 150, 112)


def test_a_longer_video_has_a_chunk_per_30_seconds(client, settings, files, tmp_path):
    video = upload(client, files["long"], "long.mp4")
    frames = []
    for start in (0, 30, 60):
        chunk = client.get(f"/api/media/{video['id']}/filmstrip/v1/{start}.jpg")
        assert chunk.status_code == 200, start
        frames.append(int(chunk.headers["x-frames"]))
        # 64x48 at 112px tall: 149.3, rounded to even.
        assert size(settings, chunk.content, tmp_path) == (frames[-1] * 150, 112)
    assert frames == [30, 30, 5]

    # Off the grid, past the end, before the start.
    for start in (15, 90, -30):
        assert client.get(f"/api/media/{video['id']}/filmstrip/v1/{start}.jpg").status_code == 404, start


def test_images_and_unknown_items_have_no_filmstrip(client, files):
    image = upload(client, files["image"], "still.png")
    assert client.get(f"/api/media/{image['id']}/filmstrip/v1/0.jpg").status_code == 404
    assert client.get("/api/media/0123456789abcdef0123456789abcdef/filmstrip/v1/0.jpg").status_code == 404


def test_a_video_uploaded_before_filmstrips_gets_them_on_request(client, settings, files):
    video = upload(client, files["long"], "long.mp4")
    shutil.rmtree(settings.data_dir / "media" / f"{video['id']}.strips")

    chunk = client.get(f"/api/media/{video['id']}/filmstrip/v1/60.jpg")
    assert chunk.status_code == 200 and chunk.headers["x-frames"] == "5"
    assert "immutable" in chunk.headers["cache-control"]
    # Only the chunk asked for, and no temporary file left behind.
    assert [path.name for path in strips(settings, video["id"]).iterdir()] == ["60.jpg"]
    made = (strips(settings, video["id"]) / "60.jpg").stat().st_mtime_ns
    assert client.get(f"/api/media/{video['id']}/filmstrip/v1/60.jpg").content == chunk.content
    assert (strips(settings, video["id"]) / "60.jpg").stat().st_mtime_ns == made


def test_deleting_a_video_deletes_its_filmstrip(client, settings, files):
    video = upload(client, files["video"], "intro.mov")
    assert client.delete(f"/api/media/{video['id']}").status_code == 204
    assert [path.name for path in (settings.data_dir / "media").iterdir()] == ["media.json"]
    assert client.get(f"/api/media/{video['id']}/filmstrip/v1/0.jpg").status_code == 404
