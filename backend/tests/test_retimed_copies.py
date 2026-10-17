"""Retimed copies and a reversed media Segment (.scratch/speed/issues/06-retimed-copies-and-reversed-media-segment.md):
the copies' names and lookup, then real copies made by ffmpeg (backwards, in pieces, never left
half-written, in bounded memory, made in the background for the editor), and Seam A through the API,
the MCP and a real render of a reversed video Segment."""

import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest

from app.config import load_settings
from app.retimed import Copies, Copy, CopySize, Retime, piece_secs
from app.segment_time import SegmentTime
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, probe, reviewed
from test_review import candidate_url, patch
from test_sped_media_segments import COVER, FPS, STEP, centre_luma, frames, source_at_30  # noqa: F401

# The sweep's frequency at `t` seconds into the counter video: 200 Hz rising 300 Hz a second.
SWEEP = (200, 300)


def sweep_at(t: float) -> float:
    return SWEEP[0] + SWEEP[1] * t


@pytest.fixture(scope="session")
def counter(tmp_path_factory) -> Path:
    """A 2.5 s 640x360 video at FPS whose picture brightens by STEP each frame (a frame counter),
    with a rising tone (a sweep)."""
    lavfi = ("-f", "lavfi", "-i")
    path = tmp_path_factory.mktemp("counter") / "counter.mp4"
    make(
        path,
        *lavfi, f"color=c=black:size=640x360:rate={FPS}:duration=2.5,format=yuv420p,geq=lum='16+N*{STEP}':cb=128:cr=128",
        *lavfi, f"aevalsrc='sin(2*PI*({SWEEP[0]}*t+{SWEEP[1] / 2}*t*t))':d=2.5:s=48000",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac", "-shortest",
    )
    return path


@pytest.fixture(autouse=True)
def from_source_at_30(video_source, source_at_30) -> None:
    """Clips at the counter's rate, so that each of their frames is one of its frames."""
    video_source.video = source_at_30


def copies_of(folder: Path, video: Path) -> Copies:
    return Copies(folder, {CopySize.PREVIEW: video, CopySize.FULL: video}, (640, 360, FPS))


def lumas(video: Path) -> np.ndarray:
    """The mean luma of each frame of a 640x360 video, of a patch in its middle."""
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error", "-i", str(video),
        "-vf", "crop=100:100:270:130,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-",
    ]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.uint8).astype(float)


def leftovers(folder: Path) -> list[str]:
    return sorted(path.name for path in folder.iterdir() if path.name.startswith("."))


# Names and lookup


def test_a_copy_is_named_by_its_kind_size_and_range_in_ms_and_read_back_from_its_name():
    assert Retime(1.5, 4.25).name(CopySize.FULL) == "reversed-full-1500-4250.mp4"
    assert Retime(1.0004, 2.0001).name(CopySize.PREVIEW) == "reversed-preview-1000-2001.mp4"
    assert Retime(0, 3, reverse=False, speed=8).name(CopySize.PREVIEW) == "retimed-preview-0-3000-x8.mp4"
    assert Retime(0, 3, speed=0.125, pitch=True).name(CopySize.PREVIEW) == "retimed-preview-0-3000-x0.125-pitch-reversed.mp4"
    for retime in (Retime(1.5, 4.25), Retime(0, 3, reverse=False, speed=8), Retime(0, 3, speed=0.125, pitch=True)):
        for size in CopySize:
            assert Retime.named(retime.name(size)) == (size, retime)
    for other in ("reversed-full-1500.mp4", "reversed-huge-0-1.mp4", ".reversed-full-0-1000.ab.part.mp4", "0.jpg", "../x.mp4"):
        assert Retime.named(other) is None, other


def test_a_reversed_copy_of_a_to_b_shows_c_to_d_from_b_minus_d_and_plays_it_at_the_segments_speed():
    copy = Copy(Path("reversed-full-1000-5000.mp4"), CopySize.FULL, Retime(1, 5))
    assert copy.retime.covers(Retime(2, 4)) and copy.retime.covers(Retime(1, 5))
    assert not copy.retime.covers(Retime(0.9, 4)) and not copy.retime.covers(Retime(2, 5.1))
    assert not copy.retime.covers(Retime(2, 4, reverse=False, speed=2))
    assert copy.at(2, 4) == 1
    assert copy.read(SegmentTime(2, 4, speed=2, reverse=True)) == SegmentTime(1, 3, 2)
    sped = Copy(Path("retimed-preview-1000-5000-x8.mp4"), CopySize.PREVIEW, Retime(1, 5, reverse=False, speed=8))
    assert sped.at(3, 5) == 0.25


def test_pieces_hold_a_bounded_number_of_frames():
    assert piece_secs(640, 360, 30) == 10
    assert 1 < piece_secs(1920, 1080, 30) < 2
    assert piece_secs(3840, 2160, 60) == 0.5


# Real copies


def test_a_copy_plays_its_range_backwards_picture_and_sound(tmp_path, counter):
    copies = copies_of(tmp_path / "retimed", counter)
    copy = copies.make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0.5, 2.0))
    assert copy.path == tmp_path / "retimed" / "reversed-full-500-2000.mp4"
    shown = lumas(copy.path)
    forward = lumas(counter)
    # Each frame one less than the one before, from the last frame before 2 s down to the one at 0.5 s.
    assert len(shown) == pytest.approx(1.5 * FPS, abs=2)
    steps = np.diff(shown)
    assert (np.abs(steps + np.diff(forward).mean()) < 1.5).all(), steps
    assert shown[-1] == pytest.approx(forward[round(0.5 * FPS)], abs=1.5)
    assert shown[0] == pytest.approx(forward[round(2.0 * FPS) - 1], abs=1.5 * np.diff(forward).mean())
    # The sweep falls: at 0.2 s into it, the tone of 1.8 s into the video, not of 0.7 s.
    for at in (0.2, 0.5, 1.2):
        heard, mirrored = sweep_at(2.0 - at), sweep_at(0.5 + at)
        assert tone_level(load_settings(), copy.path, heard, at) > 5 * tone_level(load_settings(), copy.path, mirrored, at), at
    assert leftovers(tmp_path / "retimed") == []


def test_a_copy_of_a_to_b_serves_c_to_d_inside_it_and_a_range_reaching_outside_makes_another(tmp_path, counter):
    copies = copies_of(tmp_path / "retimed", counter)
    ffmpeg = load_settings().ffmpeg_bin
    wide = copies.make(ffmpeg, CopySize.FULL, Retime(0.2, 2.2))
    made = wide.path.stat().st_mtime_ns
    inside = copies.make(ffmpeg, CopySize.FULL, Retime(0.5, 1.5))
    assert inside == wide and wide.path.stat().st_mtime_ns == made
    assert inside.at(0.5, 1.5) == pytest.approx(0.7)
    # Another size, or a range past its end, is another copy.
    assert copies.find(CopySize.PREVIEW, Retime(0.5, 1.5)) is None
    outside = copies.make(ffmpeg, CopySize.FULL, Retime(1.0, 2.4))
    assert outside.path.name == "reversed-full-1000-2400.mp4"
    assert sorted(path.name for path in (tmp_path / "retimed").iterdir()) == ["reversed-full-1000-2400.mp4", "reversed-full-200-2200.mp4"]


def test_a_copy_retimed_at_a_speed_has_its_frames_at_the_videos_rate_and_lasts_its_range_divided_by_it(tmp_path, counter):
    """Ticket 09's preview copies: every 4th frame at 4×, each frame 8 times at 0.125×, every 8th
    counting down at 8× reversed, and as long as the render makes them; also when made in pieces
    (of 1.4 s, as of a 1080p video)."""
    copies = copies_of(tmp_path / "retimed", counter)
    in_pieces = Copies(tmp_path / "pieces", {CopySize.FULL: counter}, (1920, 1080, FPS))
    ffmpeg = load_settings().ffmpeg_bin
    forward = lumas(counter)
    step = np.diff(forward).mean()
    for made, retime, frames in (
        (copies, Retime(0, 2, reverse=False, speed=4), forward[0:60:4]),
        (copies, Retime(0.5, 1.0, reverse=False, speed=0.125), np.repeat(forward[15:30], 8)),
        (copies, Retime(0, 2.4, speed=8), forward[71::-8][:9]),
        (in_pieces, Retime(0, 2.4, reverse=False, speed=0.25), np.repeat(forward[:72], 4)),
        (in_pieces, Retime(0, 2.4, speed=6), forward[71::-6]),
    ):
        size = CopySize.FULL if made is in_pieces else CopySize.PREVIEW
        copy = made.make(ffmpeg, size, retime)
        streams = {stream["codec_type"]: float(stream["duration"]) for stream in probe(load_settings(), copy.path)["streams"]}
        length = (retime.end - retime.start) / retime.speed
        assert streams["video"] == pytest.approx(length, abs=0.5 / FPS), (retime, streams)
        assert streams["audio"] == pytest.approx(length, abs=0.05), (retime, streams)
        shown = lumas(copy.path)
        assert len(shown) == len(frames), (retime, len(shown))
        assert np.abs(shown - frames).max() < step / 2, (retime, shown - frames)


def test_a_slowed_copys_sound_keeps_its_pitch_as_the_renders_does(tmp_path, counter):
    copy = copies_of(tmp_path / "retimed", counter).make(
        load_settings().ffmpeg_bin, CopySize.PREVIEW, Retime(0.5, 1.0, reverse=False, speed=0.125)
    )
    for at in (0.5, 2.0, 3.5):
        heard = sweep_at(0.5 + at * 0.125)
        assert tone_level(load_settings(), copy.path, heard, at) > 5 * tone_level(load_settings(), copy.path, heard / 2, at), at


def test_an_interrupted_copy_leaves_no_file_under_its_name_nor_its_pieces(tmp_path, counter):
    copies = Copies(tmp_path / "retimed", {CopySize.FULL: counter}, (640, 360, FPS))

    def stop(done: float) -> None:
        raise KeyboardInterrupt

    # Pieces of 0.5 s: the first is made, then it stops.
    with pytest.raises(KeyboardInterrupt):
        Copies(copies.folder, copies.videos, (3840, 2160, 60)).make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 2), stop)
    assert list(copies.folder.iterdir()) == []
    assert copies.find(CopySize.FULL, Retime(0, 2)) is None


def test_the_editor_asks_for_a_copy_and_polls_its_progress_until_it_is_made_in_the_background(tmp_path, counter):
    copies = copies_of(tmp_path / "retimed", counter)
    ffmpeg = load_settings().ffmpeg_bin
    asked = copies.ask(ffmpeg, CopySize.PREVIEW, Retime(0.1, 2.4))
    assert asked.copy is None and asked.progress == 0
    # A range inside it while it is made waits for it, rather than making another.
    seen = []
    deadline = time.monotonic() + 30
    while (making := copies.ask(ffmpeg, CopySize.PREVIEW, Retime(0.5, 1.5))).copy is None:
        assert making.error is None and time.monotonic() < deadline
        seen.append(making.progress)
        time.sleep(0.05)
    assert seen == sorted(seen)
    assert making.progress == 1 and making.copy.path.name == "reversed-preview-100-2400.mp4"
    assert making.copy.at(0.5, 1.5) == pytest.approx(0.9)
    assert [path.name for path in copies.folder.iterdir()] == ["reversed-preview-100-2400.mp4"]


def test_a_failed_copy_is_told_once_and_asked_again(tmp_path):
    copies = copies_of(tmp_path / "retimed", tmp_path / "missing.mp4")
    ffmpeg = load_settings().ffmpeg_bin
    copies.ask(ffmpeg, CopySize.PREVIEW, Retime(0, 1))
    deadline = time.monotonic() + 10
    while (making := copies.ask(ffmpeg, CopySize.PREVIEW, Retime(0, 1))).error is None:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    assert "missing.mp4" in making.error
    assert copies.ask(ffmpeg, CopySize.PREVIEW, Retime(0, 1)).error is None


_MEASURE = """
import resource, sys
from pathlib import Path
from app.config import load_settings
from app.retimed import Copies, CopySize, Retime
video, folder = Path(sys.argv[1]), Path(sys.argv[2])
Copies(folder, {CopySize.FULL: video}, (1920, 1080, 5)).make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 180))
print(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
"""


def test_reversing_three_minutes_of_a_1080p_video_holds_a_bounded_amount_of_memory(tmp_path):
    """Whole, its 900 frames would be 2.8 GB in `reverse`; in pieces, a few hundred MB at most (of
    which most is the decoder's and the encoder's own)."""
    video = tmp_path / "long.mp4"
    lavfi = ("-f", "lavfi", "-i")
    make(video, *lavfi, "testsrc2=size=1920x1080:rate=5", *lavfi, "sine=frequency=440", "-t", "180",
         "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac")
    result = subprocess.run(
        [sys.executable, "-c", _MEASURE, str(video), str(tmp_path / "retimed")],
        capture_output=True, text=True, cwd=Path(__file__).parent.parent,
    )
    assert result.returncode == 0, result.stderr
    # ru_maxrss is in bytes on macOS: the largest ffmpeg's.
    assert int(result.stdout) < 768 * 2**20, int(result.stdout) / 2**20
    copy = tmp_path / "retimed" / "reversed-full-0-180000.mp4"
    assert float(probe(load_settings(), copy)["format"]["duration"]) == pytest.approx(180, abs=0.2)


# Seam A: the API, the MCP and the render


def wait_for(client, url: str, body: dict) -> dict:
    deadline = time.monotonic() + 30
    while (answer := client.post(url, json=body)).status_code == 200 and answer.json()["url"] is None:
        assert answer.json()["error"] is None and time.monotonic() < deadline, answer.json()
        time.sleep(0.05)
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_the_editor_asks_for_a_preview_copy_of_a_videos_range_and_gets_its_url_once_made(client, settings, counter):
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    url = f"/api/media/{video['id']}/retimed"
    made = wait_for(client, url, {"start": 0.5, "end": 2.0})
    assert made == {"progress": 1, "url": f"{url}/reversed-preview-500-2000.mp4", "at": 0, "error": None}
    served = client.get(made["url"])
    assert served.status_code == 200 and served.headers["content-type"] == "video/mp4"
    # A part of it is served by it.
    assert client.post(url, json={"start": 1, "end": 1.5}).json()["at"] == 0.5
    for body, status in (
        ({"start": 1, "end": 3}, 422),
        ({"start": 1, "end": 0.5}, 422),
        ({"start": 0, "end": 1, "reverse": False}, 422),
        ({"start": 0, "end": 1, "speed": 20}, 422),
    ):
        assert client.post(url, json=body).status_code == status, body
    assert client.post("/api/media/nope/retimed", json={"start": 0, "end": 1}).status_code == 404
    assert client.get(f"{url}/../counter.mp4").status_code == 404
    assert client.get(f"{url}/reversed-preview-0-1000.mp4").status_code == 404
    # Removed with the item.
    client.delete(f"/api/media/{video['id']}")
    assert not (settings.data_dir / "media" / f"{video['id']}.retimed").exists()


def test_reverse_is_saved_on_a_video_segment_and_refused_on_the_episodes_and_a_freeze_frames(client, counter):
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    backwards = {"id": "v", "start": 0.5, "end": 2, "media": video["id"], "framing": {}, "reverse": True, "speed": 2}
    saved = patch(client, job, candidate, segments=[backwards, episode])
    assert (saved["segments"][0]["reverse"], saved["segments"][1]["reverse"]) == (True, False)
    reversed_plan = preview(client, job, saved)["plan"]["segments"][0]
    assert (reversed_plan["end"], reversed_plan["reverse"], reversed_plan["source_start"], reversed_plan["source_end"]) == (0.75, True, 0.5, 2)
    response = client.patch(candidate_url(job, saved), json={"segments": [backwards, episode | {"reverse": True}]})
    assert response.status_code == 422 and "only a video's Segment can" in response.text


@pytest.mark.anyio
async def test_the_agent_reverses_a_video_segment_and_the_dry_run_says_whether_its_copy_is_ready(client, mcp, counter):
    item = await call(mcp, "add_asset", kind="media", path=str(counter))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    episode = {"id": "e", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    video = {"id": "v", "start": 0.5, "end": 2, "media": item["id"], "framing": {}}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [video, episode]})
    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "e", "reverse": True}])
    assert "only a video's Segment can" in message, message
    saved = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "reverse": True}])
    assert saved["segments"][0]["reverse"] is True

    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    backwards = plan["segments"][0]
    assert (backwards["reverse"], backwards["copy"]) == (True, "made by the render")
    assert "reverse" not in plan["segments"][1]
    client.app.state.media.retimed(item["id"]).make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 2.5))
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    assert plan["segments"][0]["copy"] == "ready"


def test_a_reversed_video_segment_renders_counting_down_with_its_sweep_backwards_at_1x_and_2x(client, settings, counter):
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "once", "start": 0, "end": 1, "media": video["id"], "framing": COVER},
        # 0–2 s backwards at 2× (1 s), its copy made first; then 0.5–2 s backwards (1.5 s), from that copy.
        {"id": "twice", "start": 0, "end": 2, "media": video["id"], "framing": COVER, "reverse": True, "speed": 2},
        {"id": "back", "start": 0.5, "end": 2, "media": video["id"], "framing": COVER, "reverse": True},
        {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]},
    ])
    once, twice, back, episode = preview(client, job, candidate)["plan"]["segments"]
    assert (twice["start"], twice["end"], back["end"]) == (1, 2, 3.5)
    clip = clip_of(client, settings, job, candidate)
    assert float(probe(settings, clip)["format"]["duration"]) == pytest.approx(episode["end"], abs=0.1)
    # A render with no copy made the full-size one it needed, and one served both.
    assert [path.name for path in (settings.data_dir / "media" / f"{video['id']}.retimed").iterdir()] == ["reversed-full-0-2000.mp4"]

    shown = centre_luma(settings, clip)
    normal = np.diff(shown[frames(0, 1, FPS)]).mean()
    assert normal > 2
    for start, end, by in ((1, 2, 2), (2, 3.5, 1)):
        steps = np.diff(shown[frames(start, end, FPS)])
        assert len(steps) > 20 and (np.abs(steps + by * normal) <= normal / 2).all(), (start, normal, steps)
    # The frame at 0.5 s of the video, a frame before its end.
    assert shown[round(3.5 * FPS) - 1] == pytest.approx(shown[round(0.5 * FPS)], abs=normal)
    # The sweep falls, at its own pitch at 2×: 0.2 s into each, the tone of 2 − 0.2 × speed s into the video.
    for at, source, mirrored in ((1.2, 1.6, 0.4), (2.2, 1.8, 0.7), (3.0, 1.0, 1.5)):
        assert tone_level(settings, clip, sweep_at(source), at) > 5 * tone_level(settings, clip, sweep_at(mirrored), at), at
