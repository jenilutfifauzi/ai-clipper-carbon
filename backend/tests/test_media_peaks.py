"""Peaks of Media Library videos and songs, per 30-second chunk (.scratch/timeline-visuals/issues/
05-waveform-on-music-and-media.md, docs/adr/0005-timeline-media-is-derived-per-chunk.md). Seam A,
through the API with the real ffmpeg."""

import shutil
import struct
import subprocess
from pathlib import Path

import pytest

from app.config import load_settings

# lavfi's sine is an eighth of full scale.
TONE = 1 / 8


def make(path: Path, *args: str) -> bytes:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path.read_bytes()


@pytest.fixture(scope="session")
def files(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s video with a tone, a silent one, a 65 s song, and a PNG."""
    folder = tmp_path_factory.mktemp("peaks")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "video": make(folder / "clip.mov", *lavfi, "testsrc=size=320x240:rate=25:duration=2", *lavfi,
                      "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "silent": make(folder / "silent.mp4", *lavfi, "testsrc=size=64x48:rate=5:duration=2", "-c:v", "libx264",
                       "-preset", "ultrafast"),
        "song": make(folder / "song.m4a", *lavfi, "sine=frequency=330:duration=65", "-c:a", "aac"),
        "image": make(folder / "still.png", *lavfi, "color=c=blue:size=64x48", "-frames:v", "1"),
    }


def upload(client, data: bytes, name: str) -> dict:
    answer = client.post("/api/media", files={"file": (name, data, "application/octet-stream")})
    assert answer.status_code == 201, answer.text
    return answer.json()


def read(chunk: bytes) -> tuple[int, list[int], list[int]]:
    """A Peaks chunk's buckets a second, mins and maxes, as the spec lays them out."""
    per_second, count = struct.unpack_from("<HI", chunk)
    assert len(chunk) == 6 + 2 * count
    return per_second, list(struct.unpack_from(f"<{count}b", chunk, 6)), list(struct.unpack_from(f"<{count}b", chunk, 6 + count))


def peaks(settings, media_id: str) -> Path:
    return settings.data_dir / "media" / f"{media_id}.peaks" / "v1-b1000"


def test_an_uploaded_video_has_its_peaks_ready(client, settings, files):
    video = upload(client, files["video"], "intro.mov")
    # Made by the upload, before any request.
    assert sorted(path.name for path in peaks(settings, video["id"]).iterdir()) == ["0.peaks"]

    chunk = client.get(f"/api/media/{video['id']}/peaks/v1/0.peaks")
    assert chunk.status_code == 200 and chunk.headers["content-type"] == "application/octet-stream"
    assert "immutable" in chunk.headers["cache-control"]
    per_second, mins, maxes = read(chunk.content)
    # A millisecond a bucket: 2 s is 2000.
    assert per_second == 1000 and len(mins) == 2000
    assert all(low <= 0 for low in mins) and all(high >= 0 for high in maxes)
    # A 440 Hz tone peaks up and down in every 10 ms (four periods) near its amplitude, an eighth of
    # full scale (127): about 16, away from the encoder's ramps at either end.
    for at in range(100, 1900, 10):
        assert abs(max(maxes[at : at + 10]) / 127 - TONE) < 0.03, at
        assert abs(-min(mins[at : at + 10]) / 127 - TONE) < 0.03, at


def test_a_song_has_a_chunk_of_peaks_per_30_seconds(client, settings, files):
    song = upload(client, files["song"], "song.m4a")
    counts = []
    for start in (0, 30, 60):
        chunk = client.get(f"/api/media/{song['id']}/peaks/v1/{start}.peaks")
        assert chunk.status_code == 200, start
        counts.append(len(read(chunk.content)[1]))
    assert counts == [30000, 30000, 5000]

    # Off the grid, past the end, before the start.
    for start in (15, 90, -30):
        assert client.get(f"/api/media/{song['id']}/peaks/v1/{start}.peaks").status_code == 404, start


def test_silent_videos_images_and_unknown_items_have_no_peaks(client, settings, files):
    silent = upload(client, files["silent"], "silent.mp4")
    assert client.get(f"/api/media/{silent['id']}/peaks/v1/0.peaks").status_code == 404
    assert not peaks(settings, silent["id"]).exists()
    image = upload(client, files["image"], "still.png")
    assert client.get(f"/api/media/{image['id']}/peaks/v1/0.peaks").status_code == 404
    assert client.get("/api/media/0123456789abcdef0123456789abcdef/peaks/v1/0.peaks").status_code == 404


def test_an_item_uploaded_before_peaks_gets_them_on_request(client, settings, files):
    song = upload(client, files["song"], "song.m4a")
    whole = client.get(f"/api/media/{song['id']}/peaks/v1/30.peaks").content
    shutil.rmtree(settings.data_dir / "media" / f"{song['id']}.peaks")

    chunk = client.get(f"/api/media/{song['id']}/peaks/v1/30.peaks")
    assert chunk.status_code == 200 and "immutable" in chunk.headers["cache-control"]
    per_second, mins, maxes = read(chunk.content)
    assert per_second == 1000 and len(mins) == 30000
    # The same shape as the upload's, read by seeking to 30 s.
    _, _, upload_maxes = read(whole)
    assert max(abs(made - uploaded) for made, uploaded in zip(maxes[100:-100], upload_maxes[100:-100])) <= 2
    # Only the chunk asked for, and no temporary file left behind.
    assert [path.name for path in peaks(settings, song["id"]).iterdir()] == ["30.peaks"]
    made = (peaks(settings, song["id"]) / "30.peaks").stat().st_mtime_ns
    assert client.get(f"/api/media/{song['id']}/peaks/v1/30.peaks").content == chunk.content
    assert (peaks(settings, song["id"]) / "30.peaks").stat().st_mtime_ns == made


def test_deleting_an_item_deletes_its_peaks(client, settings, files):
    video = upload(client, files["video"], "intro.mov")
    assert client.delete(f"/api/media/{video['id']}").status_code == 204
    assert [path.name for path in (settings.data_dir / "media").iterdir()] == ["media.json"]
    assert client.get(f"/api/media/{video['id']}/peaks/v1/0.peaks").status_code == 404
