"""Speed, Reverse and Freeze frame keep the Matte (.scratch/background-removal/issues/07-speed-reverse-and-freeze-frame.md,
ADR 0015, 0009): Seam A through the API and the real ffmpeg with the fake matter (fakes.py's
FakeMatter, which keeps what is red) on a Source whose red disc moves, so that a Matte a frame out of
step with its picture cuts a crescent off it; then the reversed copy of a Matte, made from its pieces,
and its sweep."""

import subprocess
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.candidates import Subject
from app.config import load_settings
from app.main import create_app
from app.matte import MATTES_DIR, MatteRunner, Mattes, PiecesMissing, Reversed
from app.person_model import PersonModel
from app.ports import Ports
from app.retimed import Copies, CopySize, Retime
from fakes import matter_kind
from test_background_removal import cut_out, settled
from test_behind_overlays import behind, pictures  # noqa: F401
from test_segment_backgrounds import uploaded
from test_render import add, preview, render, rendered, reviewed
from test_review import patch
from test_segments import ranges

# The disc's path: up and down through the middle of the frame, 1.6 s a swing, at most 16 px a frame.
FPS = 25
BLUE = "#0000ff"


def bobbing(path: Path, secs: float) -> Path:
    """`secs` at 25 fps of a red disc (radius 40) bobbing up and down through the middle of a grey
    640x360 frame, with a tone; the disc's green grows with time (from 10, 5 a second), so that its
    colour tells the Source's time too."""
    disc = "lte(hypot(X-320,Y-180-100*sin(2*PI*T/1.6)),40)"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", f"color=c=black:size=640x360:rate={FPS}:duration={secs},format=rgb24,geq=r='if({disc},220,90)':g='if({disc},10+5*T,90)':b='if({disc},30,90)'",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={secs}",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


@pytest.fixture(scope="session")
def bobbing_disc(tmp_path_factory) -> Path:
    return bobbing(tmp_path_factory.mktemp("bob") / "bob.mp4", 8)


@pytest.fixture
def matter():
    return matter_kind()


@pytest.fixture
def person_model(settings) -> PersonModel:
    model = PersonModel(settings.data_dir / "models")
    model.path.parent.mkdir(parents=True, exist_ok=True)
    model.path.write_bytes(b"rvm")
    return model


@pytest.fixture
def client(settings, video_source, transcriber, llm, bobbing_disc, person_model, matter):
    """The app with the person model and the fake matter, its Source the bobbing disc."""
    video_source.video = bobbing_disc
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm, person_model=person_model, matter=matter))) as client:
        try:
            yield client
        finally:
            video_source.release()
            transcriber.release()
            transcriber.stop()


def frames_of(settings, video: Path) -> np.ndarray:
    """Every frame of a Clip, shrunk to 270x480, RGB."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", "scale=270:480", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, np.uint8).reshape(-1, 480, 270, 3).astype(int)


def reds(frame: np.ndarray) -> int:
    return int(((frame[..., 0] > 150) & (frame[..., 1] < 120) & (frame[..., 2] < 100)).sum())


def blues(frame: np.ndarray) -> int:
    return int(((frame[..., 2] > 200) & (frame[..., 0] < 60) & (frame[..., 1] < 60)).sum())


def test_at_a_speed_in_reverse_and_held_the_kept_area_sits_on_the_disc_in_every_rendered_frame(client, settings):
    job = reviewed(client)
    fast, slow, backwards, within = ranges(job, ("halo", "soal"), ("kita", "soal"), ("halo", "kabar"), ("semua", "ngobrol"))
    played = [
        fast | {"speed": 2},
        slow | {"id": "s1", "speed": 0.5},
        # From within a frame (0.5 s is 12.5 frames).
        within | {"id": "s2", "reverse": True},
        {"id": "s3", "start": 0.777, "end": 0.777, "hold": 1},
        backwards | {"id": "s4", "reverse": True, "speed": 2},
    ]
    cut = [cut_out(segment, feather=0) | {"background": {"kind": "colour", "colour": BLUE}} for segment in played]
    plain = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=played)
    matted = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=cut)
    # The reversed Segments' Matte is a reversed copy of their range, made from its pieces by the runner.
    assert settled(client, job, matted)["state"] == "ready"
    copies = settings.data_dir / "jobs" / job["id"] / MATTES_DIR / "person-fake-1"
    names = [f"reversed-full-{round(saved['start'] * 1000)}-{round(saved['end'] * 1000)}.mp4" for saved in matted["segments"][2::2]]
    assert sorted(path.name for path in copies.iterdir()) == sorted(names)
    assert matted["segments"][2]["start"] == pytest.approx(0.5)
    assert [s["end"] for s in preview(client, job, plain)["plan"]["segments"]] == [s["end"] for s in preview(client, job, matted)["plan"]["segments"]]

    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=120)["clips"]}
    job_dir = settings.data_dir / "jobs" / job["id"]
    drawn = {}
    for candidate in (plain, matted):
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        drawn[candidate["id"]] = frames_of(settings, job_dir / clip["output"]["video"])
    before, after = drawn[plain["id"]], drawn[matted["id"]]
    assert len(before) == len(after)
    for i, (whole, cut_frame) in enumerate(zip(before, after)):
        # The whole disc kept, on every frame (but for its edge, blended with blue: 2 to 4%), and the
        # colour Background around it. A Matte a frame out of step would cut off a crescent of up to
        # a quarter of it.
        assert reds(whole) > 1000, i
        assert abs(reds(cut_frame) - reds(whole)) < reds(whole) * 0.06, (i, reds(cut_frame), reds(whole))
        assert blues(cut_frame) > 0.6 * (whole.shape[0] * whole.shape[1] - reds(whole)), i


def test_a_reversed_cut_out_segment_shows_a_behind_overlay_outside_its_kept_area(client, settings, pictures):
    blue = uploaded(client, pictures["blue"], "blue.png")
    job = reviewed(client)
    [backwards] = ranges(job, ("halo", "kabar"))
    teal = {"background": {"kind": "colour", "colour": "#008080"}}
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[cut_out(backwards | {"reverse": True}, feather=0) | teal])
    candidate = patch(client, job, candidate, overlays=[behind(blue["id"], 0.0, 1.0)])
    settled(client, job, candidate)
    render(client, job)
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    shown = frames_of(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"])
    for i in (3, 12, 20):
        # In the top left corner the Behind Overlay over the Background, beside it the Background, and
        # the bobbing disc kept over them.
        assert abs(shown[i, 20:40, 20:40].reshape(-1, 3).mean(axis=0) - (0, 0, 255)).max() < 20, i
        assert abs(shown[i, 20:40, 200:220].reshape(-1, 3).mean(axis=0) - (0, 128, 128)).max() < 20, i
        assert reds(shown[i]) > 1000, i


def test_a_render_waits_for_a_reversed_segments_matte_copy_as_for_its_pieces(client, settings, person_model):
    person_model.path.unlink()
    job = reviewed(client)
    [backwards] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[cut_out(backwards | {"reverse": True})])
    assert settled(client, job, candidate)["state"] == "waiting"
    folder = settings.data_dir / "jobs" / job["id"] / MATTES_DIR
    assert not folder.exists() or list(folder.iterdir()) == []

    person_model.path.write_bytes(b"rvm")
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    [saved] = candidate["segments"]
    name = f"reversed-full-{round(saved['start'] * 1000)}-{round(saved['end'] * 1000)}.mp4"
    assert (folder / "person-fake-1-0.mp4").is_file() and (folder / "person-fake-1" / name).is_file()


def test_the_preview_plan_says_where_a_reversed_segments_matte_copy_is_served(client, settings):
    job = reviewed(client)
    [backwards] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[cut_out(backwards | {"reverse": True})])
    settled(client, job, candidate)
    shown = preview(client, job, candidate)
    [saved] = candidate["segments"]
    start, end = saved["start"], saved["end"]
    url = f"/media/{job['id']}/{MATTES_DIR}/person-fake-1/reversed-full-{round(start * 1000)}-{round(end * 1000)}.mp4"
    assert shown["matte_copies"] == [{"start": start, "end": end, "url": url, "at": 0}]
    served = client.get(url)
    assert served.status_code == 200 and served.content[4:8] == b"ftyp"
    # A trim inward reads the copy it has, from further in.
    [later, sooner] = ranges(job, ("apa", "kabar"), ("halo", "semua"))
    trimmed = preview(client, job, candidate, {"segments": [cut_out(later | {"reverse": True})]})
    assert trimmed["matte_copies"] == [{"start": later["start"], "end": end, "url": url, "at": 0}]
    trimmed = preview(client, job, candidate, {"segments": [cut_out(sooner | {"reverse": True})]})
    assert trimmed["matte_copies"] == [{"start": start, "end": sooner["end"], "url": url, "at": pytest.approx(end - sooner["end"])}]


# The reversed copy, made from the pieces


def frames(settings, video: Path, pixels: str, depth: int) -> np.ndarray:
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", pixels, "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, np.uint8).reshape(-1, 360, 640, depth).astype(int)


def test_a_reversed_copy_holds_the_frames_of_the_pictures_own_reversed_copy_across_two_pieces(tmp_path, settings, person_model):
    """Over 8.3..11.1 s, across the pieces' join: frame by frame, its kept area is where the disc is in
    the picture's Retimed copy of the range."""
    long_disc = bobbing(tmp_path / "long.mp4", 14)
    mattes = Mattes(tmp_path / MATTES_DIR, long_disc, (640, 360, float(FPS)), 14.0)
    runner = MatteRunner(person_model, matter_kind(), settings.ffmpeg_bin)
    part = Reversed(8.3, 11.1)
    # Not before its pieces.
    with pytest.raises(PiecesMissing):
        mattes.make(settings.ffmpeg_bin, runner.matter(person_model.path), Subject.PERSON, part)
    [*_, copy] = runner.make([(mattes, Subject.PERSON, 0), (mattes, Subject.PERSON, 10), (mattes, Subject.PERSON, part)])
    assert copy == tmp_path / MATTES_DIR / "person-fake-1" / "reversed-full-8300-11100.mp4"
    picture = Copies(tmp_path / "retimed", {CopySize.FULL: long_disc}, (640, 360, float(FPS))).make(settings.ffmpeg_bin, CopySize.FULL, Retime(8.3, 11.1))
    matte, shown = frames(settings, copy, "gray", 1)[..., 0], frames(settings, picture.path, "rgb24", 3)
    # The range's 70 frames from its last, the first decoded twice (the copies start with sound, their
    # picture a fraction of a frame later), alike.
    assert len(matte) == len(shown) == 71
    for i, (kept, frame) in enumerate(zip(matte, shown)):
        disc = (frame[..., 0] > 150) & (frame[..., 1] < 100)
        assert ((kept > 128) == disc).mean() > 0.998, i


def test_the_sweep_keeps_the_reversed_copies_read_and_removes_the_rest(tmp_path, settings, person_model):
    folder = tmp_path / MATTES_DIR
    runner = MatteRunner(person_model, matter_kind(), settings.ffmpeg_bin)
    mine, old = folder / "person-fake-1", folder / "person-rvm-mnv3-1"
    for path in (
        mine / "reversed-full-100-1600.mp4", mine / "reversed-full-2000-3000.mp4", mine / "reversed-full-2000-3000.failed",
        mine / "reversed-full-4000-5000.failed", mine / ".reversed-full-0-1000.ab12.part.mp4", old / "reversed-full-100-1600.mp4",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")
    mattes = Mattes(folder, tmp_path / "unused.mp4", (640, 360, float(FPS)), 8.0)
    used = mattes.path(Subject.PERSON, runner.version, Reversed(0.5, 1.2))
    assert used == mine / "reversed-full-100-1600.mp4"
    removed = runner.sweep(folder, [used, mine / "reversed-full-4000-5000.mp4"])
    assert sorted(path.relative_to(folder).as_posix() for path in removed) == [
        "person-fake-1/.reversed-full-0-1000.ab12.part.mp4", "person-fake-1/reversed-full-2000-3000.failed",
        "person-fake-1/reversed-full-2000-3000.mp4", "person-rvm-mnv3-1",
    ]
    assert sorted(path.name for path in mine.iterdir()) == ["reversed-full-100-1600.mp4", "reversed-full-4000-5000.failed"]
