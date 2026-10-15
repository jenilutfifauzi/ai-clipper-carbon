"""Peaks of a Job's Source, per 30-second chunk, made on request (.scratch/timeline-visuals/issues/
06-waveform-on-source-segments.md, docs/adr/0005-timeline-media-is-derived-per-chunk.md). Seam A,
through the API with the real ffmpeg."""

import json
import struct
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app import derived
from app.config import load_settings

# The speech's stand-in: an eighth of full scale, 440 Hz, for the first 5 s of every 10.
TONE = 1 / 8


def make(path: Path, *args: str) -> Path:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path


@pytest.fixture(scope="session")
def sources(tmp_path_factory) -> dict[str, Path]:
    """A 65 s 64x48 test pattern with a tone that pauses every 5 s, and a silent one."""
    folder = tmp_path_factory.mktemp("sources")
    picture = ("-f", "lavfi", "-i", "testsrc=size=64x48:rate=5:duration=65")
    video = ("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p")
    return {
        "speech": make(
            folder / "speech.mp4", *picture, "-f", "lavfi", "-i",
            f"aevalsrc={TONE}*sin(2*PI*440*t)*lt(mod(t\\,10)\\,5):s=48000:d=65", *video, "-c:a", "aac", "-shortest",
        ),
        "silent": make(folder / "silent.mp4", *picture, *video),
    }


def with_source(client, video_source, video: Path) -> dict:
    """A Job whose Video Source fetched `video`, once its Source is there."""
    video_source.video = video
    job = client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=fixture"}).json()
    deadline = time.monotonic() + 10
    while (job := client.get(f"/api/jobs/{job['id']}").json())["source"] is None:
        assert time.monotonic() < deadline, f"Job stayed {job['status']} without its Source"
        time.sleep(0.01)
    return job


def read(chunk: bytes) -> tuple[int, list[int], list[int]]:
    """A Peaks chunk's buckets a second, mins and maxes, as the spec lays them out."""
    per_second, count = struct.unpack_from("<HI", chunk)
    assert len(chunk) == 6 + 2 * count
    return per_second, list(struct.unpack_from(f"<{count}b", chunk, 6)), list(struct.unpack_from(f"<{count}b", chunk, 6 + count))


def peaks(settings, job_id: str) -> Path:
    return settings.data_dir / "jobs" / job_id / "peaks" / "v1-b1000"


def test_a_source_has_a_chunk_of_peaks_per_30_seconds_made_when_asked_for(client, settings, video_source, sources):
    job = with_source(client, video_source, sources["speech"])
    # Nothing is made until it is asked for.
    assert not peaks(settings, job["id"]).exists()

    counts = []
    for start in (0, 30, 60):
        chunk = client.get(f"/api/jobs/{job['id']}/peaks/v1/{start}.peaks")
        assert chunk.status_code == 200 and chunk.headers["content-type"] == "application/octet-stream", start
        assert "immutable" in chunk.headers["cache-control"]
        per_second, mins, maxes = read(chunk.content)
        assert per_second == 1000
        assert all(low <= 0 for low in mins) and all(high >= 0 for high in maxes)
        counts.append(len(mins))
    # A millisecond a bucket; the last chunk is what the sound holds past 60 s, about 5 s.
    assert counts[:2] == [30000, 30000] and abs(counts[2] - 5000) <= 50
    assert sorted(path.name for path in peaks(settings, job["id"]).iterdir()) == ["0.peaks", "30.peaks", "60.peaks"]

    # Off the grid, past the end, before the start; and a Job that isn't there.
    for start in (15, 90, -30):
        assert client.get(f"/api/jobs/{job['id']}/peaks/v1/{start}.peaks").status_code == 404, start
    assert client.get("/api/jobs/0123456789ab/peaks/v1/0.peaks").status_code == 404


def test_a_chunk_shows_the_pauses_where_they_are_in_the_source(client, video_source, sources):
    job = with_source(client, video_source, sources["speech"])
    _, mins, maxes = read(client.get(f"/api/jobs/{job['id']}/peaks/v1/30.peaks").content)

    # From 30 s: the tone for 5 s, a pause for 5 s, and so on. Away from the edges, every 10 ms of
    # the tone peaks near its amplitude, and the pause is flat.
    for second in range(30):
        for at in range(second * 1000 + 100, second * 1000 + 900, 10):
            if second % 10 < 5:
                assert abs(max(maxes[at : at + 10]) / 127 - TONE) < 0.03, at
                assert abs(-min(mins[at : at + 10]) / 127 - TONE) < 0.03, at
            else:
                assert max(maxes[at : at + 10]) <= 1 and min(mins[at : at + 10]) >= -1, at


def test_a_source_without_sound_has_no_peaks(client, settings, video_source, sources):
    job = with_source(client, video_source, sources["silent"])
    assert client.get(f"/api/jobs/{job['id']}/peaks/v1/0.peaks").status_code == 404
    # Nor a temporary file left behind: only the note that it has no sound.
    assert [file.name for file in peaks(settings, job["id"]).glob("*")] == ["no-sound"]


def test_a_source_without_sound_is_not_decoded_again(client, settings, video_source, sources, monkeypatch):
    job = with_source(client, video_source, sources["silent"])
    assert client.get(f"/api/jobs/{job['id']}/peaks/v1/0.peaks").status_code == 404

    def decode(*_):
        raise AssertionError("ffmpeg ran again")

    monkeypatch.setattr(derived, "_run", decode)
    assert client.get(f"/api/jobs/{job['id']}/peaks/v1/30.peaks").status_code == 404


def test_a_chunk_is_made_once(client, settings, video_source, sources):
    job = with_source(client, video_source, sources["speech"])
    url = f"/api/jobs/{job['id']}/peaks/v1/30.peaks"
    first = client.get(url)
    made = (peaks(settings, job["id"]) / "30.peaks").stat().st_mtime_ns

    assert client.get(url).content == first.content
    assert (peaks(settings, job["id"]) / "30.peaks").stat().st_mtime_ns == made


def test_two_requests_at_once_for_one_chunk_both_get_it_and_leave_one_file(client, settings, video_source, sources):
    job = with_source(client, video_source, sources["speech"])
    url = f"/api/jobs/{job['id']}/peaks/v1/0.peaks"
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda _: client.get(url), range(2)))

    assert [answer.status_code for answer in answers] == [200, 200]
    assert answers[0].content == answers[1].content
    # No temporary file left behind.
    assert [path.name for path in peaks(settings, job["id"]).iterdir()] == ["0.peaks"]


def test_a_source_the_browser_cant_play_is_read_from_its_preview_proxy(client, settings, tmp_path, wait_for_status):
    # An MKV master with PCM sound gets a preview proxy, with AAC sound, on upload.
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

    chunk = client.get(f"/api/jobs/{job['id']}/peaks/v1/0.peaks")
    assert chunk.status_code == 200
    per_second, mins, _ = read(chunk.content)
    assert per_second == 1000 and abs(len(mins) - 2000) <= 50
