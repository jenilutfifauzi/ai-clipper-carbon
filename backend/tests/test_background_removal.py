"""Background removal on a Source Segment, in the render (.scratch/background-removal/issues/02-cut-out-a-source-segment-in-the-render.md,
ADR 0015): Seam B on the planner and candidate_plan; then the Matte's pieces made by the runner and
by a render, and Seam A through the API, MCP and the real ffmpeg with the fake matter (fakes.py's
FakeMatter, which keeps a red disc of a generated pattern and takes the rest away)."""

import subprocess
import time
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from mcp import Client
from pydantic import TypeAdapter

from app.candidates import Background, BackgroundRemoval, Candidate, Framing, Layout, LayoutOverride, Segment, Transform, manual_candidate
from app.config import CameraTuning, load_settings
from app.main import create_app
from app.matte import MATTES_DIR, MatteRunner, Mattes, RvmMatter, matte_pieces
from app.person_model import PERSON_MODEL_FILE, PersonModel, fixed_copy
from app.planner import MatteRead, SceneLayout, SegmentInput, plan_render
from app.ports import Ports
from app.renderer import Renderer
from app.rendering import candidate_plan, matted
from app.scaled_plan import scaled_plan
from app.styles import PresetStore
from app.video_source import SourceMetadata
from fakes import matter_kind
from test_mcp import anyio_backend, call, fails, manual  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, render, rendered, reviewed
from test_review import candidate_url, patch
from test_save_frame import pixels_of, saved_frame
from test_segments import ranges

# A 640x360 Source at 25 fps, 8 s long (one piece of Matte).
SOURCE = SourceMetadata(width=640, height=360, duration=40.0, fps=25.0, codec="h264")
CUT = BackgroundRemoval()


# Seam B: the planner


def test_a_source_segments_background_removal_reaches_its_plan_with_the_pieces_it_reads():
    planned = plan_render(10, 31, SOURCE, main_track=[
        SegmentInput(8, 12, background_removal=BackgroundRemoval(feather=6)),
        SegmentInput(20, 23),
        SegmentInput(25, 25, hold=1.0, background_removal=CUT),
    ])
    cut, plain, held = planned.segments
    assert cut.background_removal == BackgroundRemoval(feather=6) and cut.background == Background()
    # 8..12 s reads the pieces from 0 and 10; a Freeze frame the one holding its frame.
    assert cut.matte == MatteRead([0, 10]) and held.matte == MatteRead([20])
    assert plain.background_removal is None and plain.background is None and plain.matte is None


def test_the_feather_grows_with_a_manual_pictures_scale_and_with_the_output():
    framing = Framing(Transform(scale=2.0))
    planned = plan_render(10, 12, SOURCE, layout=Layout.MANUAL, framing=framing, main_track=[
        SegmentInput(10, 12, background_removal=BackgroundRemoval(feather=6)),
    ])
    assert planned.segments[0].background_removal.feather == 12
    # At 720p, two thirds.
    assert scaled_plan(planned, (720, 1280)).segments[0].background_removal.feather == 8


def test_the_feather_is_scaled_by_the_framing_of_the_scene_that_shows_it():
    """A Segment in a Manual Layout Override is drawn at its override's scale; one in a Track or Split
    override of a Manual Candidate isn't drawn at the Candidate's."""
    removal = BackgroundRemoval(feather=6)
    overridden = plan_render(10, 12, SOURCE, layout=Layout.TRACK, main_track=[
        SegmentInput(10, 12, background_removal=removal, layout_overrides=[LayoutOverride(1.0, Layout.MANUAL, Framing(Transform(scale=1.5)))]),
    ])
    assert overridden.scenes[0].layout is SceneLayout.MANUAL and overridden.segments[0].background_removal.feather == 9
    for layout in (Layout.TRACK, Layout.SPLIT):
        tracked = plan_render(10, 12, SOURCE, layout=Layout.MANUAL, framing=Framing(Transform(scale=2.0)), main_track=[
            SegmentInput(10, 12, background_removal=removal, layout_overrides=[LayoutOverride(1.0, layout)]),
        ])
        assert tracked.scenes[0].layout is not SceneLayout.MANUAL and tracked.segments[0].background_removal.feather == 6, layout


def test_a_candidates_segment_brings_it_to_the_plan_and_one_saved_before_it_plans_as_before(tmp_path):
    candidate = replace(manual_candidate("c1", 10, 26), segments=[Segment("a", 10, 12, background_removal=CUT), Segment("b", 20, 22)])
    planned = candidate_plan(candidate, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [segment.background_removal for segment in planned.segments] == [CUT, None]

    stored = asdict(replace(candidate, segments=[Segment("a", 10, 12), Segment("b", 20, 22)]))
    for segment in stored["segments"]:
        del segment["background_removal"]
    old = TypeAdapter(Candidate).validate_python(stored)
    assert [segment.background_removal for segment in old.segments] == [None, None]
    before = candidate_plan(old, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert before == candidate_plan(
        replace(candidate, segments=[Segment("a", 10, 12), Segment("b", 20, 22)]), SOURCE, None, [None, None],
        PresetStore(tmp_path / "presets.json"), CameraTuning(),
    )


def test_a_feather_out_of_range_is_refused_naming_its_segment():
    with pytest.raises(ValueError, match="Segment a's background_removal feather is 41; it is 0 to 40"):
        Segment("a", 10, 12, background_removal=BackgroundRemoval(feather=41))


def test_the_pieces_of_a_range_are_the_ten_second_ones_holding_it():
    assert matte_pieces(0, 8, 8, 25) == [0]
    assert matte_pieces(9.5, 10.5, 40, 25) == [0, 10]
    assert matte_pieces(10, 20, 40, 25) == [10]
    assert matte_pieces(35, 45, 38, 25) == [30]
    assert matte_pieces(25, 25, 40, 25) == [20]
    # By frame: a frame held within half a frame before a piece is that piece's first, and a range
    # ending just past a piece's first frame reads it.
    assert matte_pieces(19.99, 19.99, 40, 25) == [20]
    assert matte_pieces(15, 20.01, 40, 25) == [10, 20]


# Seam A: the API, the runner and the real ffmpeg, with the fake matter


@pytest.fixture(scope="session")
def disc_video(tmp_path_factory) -> Path:
    """8 s at 25 fps of a red disc (radius 70) in the middle of a black and grey checkerboard of
    20 px squares whose grey brightens with time (from 60, 15 a second), with a tone. The disc's
    green grows with time too (from 5, 11 a second), so that its colour tells the Source's time."""
    path = tmp_path_factory.mktemp("disc") / "disc.mp4"
    disc = "lte(hypot(X-320,Y-180),70)"
    square = "mod(floor(X/20)+floor(Y/20),2)"
    grey = f"if({square},60+15*T,20)"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", f"color=c=black:size=640x360:rate=25:duration=8,format=rgb24,geq=r='if({disc},220,{grey})':g='if({disc},5+11*T,{grey})':b='if({disc},30,{grey})'",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


@pytest.fixture
def matter():
    return matter_kind()


@pytest.fixture
def person_model(settings) -> PersonModel:
    """The person model, its file there (the fake matter never reads it)."""
    model = PersonModel(settings.data_dir / "models")
    model.path.parent.mkdir(parents=True, exist_ok=True)
    model.path.write_bytes(b"rvm")
    return model


@pytest.fixture
def client(settings, video_source, transcriber, llm, disc_video, person_model, matter):
    """The app with the person model and the fake matter, its Source the disc video."""
    video_source.video = disc_video
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm, person_model=person_model, matter=matter))) as client:
        try:
            yield client
        finally:
            video_source.release()
            transcriber.release()
            transcriber.stop()


def matte_of(client, job: dict, candidate: dict, retry: bool = False) -> dict:
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/matte", json={"retry": retry})
    assert response.status_code == 200, response.text
    return response.json()


def settled(client, job: dict, candidate: dict, timeout: float = 30) -> dict:
    """The Candidate's Matte once it is no longer being made."""
    deadline = time.monotonic() + timeout
    while (matte := matte_of(client, job, candidate))["state"] == "making":
        assert time.monotonic() < deadline, matte
        time.sleep(0.05)
    return matte


def pieces(settings, job: dict) -> list[str]:
    folder = settings.data_dir / "jobs" / job["id"] / MATTES_DIR
    return sorted(path.name for path in folder.iterdir()) if folder.is_dir() else []


def cut_out(segment: dict, **removal) -> dict:
    return segment | {"background_removal": {"subject": "person", **removal}}


@pytest.fixture(scope="session")
def swinging_disc(tmp_path_factory) -> Path:
    """14 s at 25 fps of a red disc (radius 40) swinging left and right across the middle of a grey
    frame, 19 px a frame at its fastest: a Matte a frame out of step cuts a crescent off it."""
    path = tmp_path_factory.mktemp("swing") / "swing.mp4"
    disc = "lte(hypot(X-320-60*sin(2*PI*T/0.8),Y-180),40)"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", f"color=c=black:size=640x360:rate=25:duration=14,format=rgb24,geq=r='if({disc},220,90)':g='if({disc},30,90)':b='if({disc},30,90)'",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path),
    ], check=True)
    return path


def reds(frame: np.ndarray) -> int:
    return int(((frame[..., 0] > 150) & (frame[..., 1] < 100)).sum())


def test_the_matte_keeps_a_moving_subject_whole_across_two_pieces(tmp_path, settings, swinging_disc, person_model):
    source = replace(SOURCE, duration=14.0)
    mattes = Mattes(tmp_path / MATTES_DIR, swinging_disc, (640, 360, 25.0), 14.0)
    runner = MatteRunner(person_model, matter_kind(), settings.ffmpeg_bin)
    renderer = Renderer(settings.ffmpeg_bin, settings.render)
    # 8.3..12.3 s of the Source reads the pieces from 0 and 10.
    plain = plan_render(8.3, 12.3, source, layout=Layout.TRACK, main_track=[SegmentInput(8.3, 12.3)])
    cut = plan_render(8.3, 12.3, source, layout=Layout.TRACK, main_track=[SegmentInput(8.3, 12.3, background_removal=BackgroundRemoval(feather=0))])
    cut, files = matted(cut, mattes, runner)
    assert cut.segments[0].matte.pieces == [0, 10] and sorted(path.name for path in files.values()) == ["person-fake-1-0.mp4", "person-fake-1-10.mp4"]
    for at in (0.52, 1.0, 1.72, 2.36, 3.1):
        drawn = {}
        for name, plan in (("plain", plain), ("cut", cut)):
            still = tmp_path / f"{name}.png"
            renderer.frame(swinging_disc, plan, at, still, files=files)
            drawn[name] = pixels_of(settings, still)
        # The whole disc is kept, on every frame, either side of the pieces' join.
        assert abs(reds(drawn["cut"]) - reds(drawn["plain"])) < reds(drawn["plain"]) * 0.03, (at, reds(drawn["cut"]), reds(drawn["plain"]))


def test_switching_it_on_makes_the_pieces_its_range_reads_and_a_trim_or_another_candidate_makes_none(client, settings, matter):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    assert matte_of(client, job, candidate) == {"state": "ready", "progress": 1.0, "error": None, "segments": {}, "overlays": {}}
    candidate = patch(client, job, candidate, segments=[cut_out(first), second])
    assert settled(client, job, candidate) == {
        "state": "ready", "progress": 1.0, "error": None, "segments": {"s0": {"state": "ready", "progress": 1.0, "error": None}}, "overlays": {},
    }
    assert pieces(settings, job) == ["person-fake-1-0.mp4"]
    made = (settings.data_dir / "jobs" / job["id"] / MATTES_DIR / "person-fake-1-0.mp4").stat().st_mtime_ns
    runs = len(matter.loads)

    # A trim within it, and another Candidate showing the same time, read the same piece.
    trimmed = patch(client, job, candidate, segments=[cut_out(first | {"end": first["end"] - 0.3}), second])
    other = patch(client, job, add(client, job, "halo", "ya"), segments=[cut_out(second), first])
    assert settled(client, job, trimmed)["state"] == settled(client, job, other)["state"] == "ready"
    assert pieces(settings, job) == ["person-fake-1-0.mp4"]
    assert (settings.data_dir / "jobs" / job["id"] / MATTES_DIR / "person-fake-1-0.mp4").stat().st_mtime_ns == made
    assert len(matter.loads) == runs


def test_a_piece_is_a_grey_video_one_frame_per_source_frame_white_where_the_subject_is(client, settings, disc_video):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [first] = ranges(job, ("halo", "kabar"))
    settled(client, job, patch(client, job, candidate, segments=[cut_out(first)]))
    piece = settings.data_dir / "jobs" / job["id"] / MATTES_DIR / "person-fake-1-0.mp4"
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(piece), "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    frames = np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, np.uint8).reshape(-1, 360, 640)
    # 8 s at 25 fps.
    assert len(frames) == 200
    assert frames[100, 180, 320] > 240 and frames[100, 20, 20] < 15 and frames[100, 180, 450] < 15


def test_the_preview_plan_says_where_the_pieces_its_cut_out_segments_read_are_served(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [first] = ranges(job, ("halo", "kabar"))

    def mattes(body: dict | None = None) -> list[dict]:
        response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan", json=body)
        assert response.status_code == 200, response.text
        return response.json()["mattes"]

    # Nothing cut out: none.
    assert mattes() == []
    # A draft cutting it out lists its piece before it is made; the preview draws the picture whole until it is served.
    url = f"/media/{job['id']}/{MATTES_DIR}/person-fake-1-0.mp4"
    # Each piece says what the preview reads it by (ADR 0001): its item's frame rate and its pieces' length.
    listed = {"start": 0, "url": url, "media": None, "fps": 25.0, "piece_secs": 10}
    assert mattes({"segments": [cut_out(first)]}) == [listed]
    settled(client, job, patch(client, job, candidate, segments=[cut_out(first)]))
    assert mattes() == [listed]
    served = client.get(url)
    assert served.status_code == 200 and served.content[4:8] == b"ftyp"


def test_a_draft_cutting_a_segment_out_asks_for_its_pieces_as_a_save_does(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [first] = ranges(job, ("halo", "kabar"))
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan", json={"segments": [cut_out(first)]})
    assert response.status_code == 200, response.text
    # Nothing saved, nor its Matte asked after: the draft alone starts it.
    deadline = time.monotonic() + 30
    while pieces(settings, job) != ["person-fake-1-0.mp4"]:
        assert time.monotonic() < deadline, pieces(settings, job)
        time.sleep(0.05)


def patch_mean(frame: np.ndarray, y: int, x: int, size: int = 40) -> np.ndarray:
    return frame[y : y + size, x : x + size].reshape(-1, 3).mean(axis=0)


def roughness(frame: np.ndarray, y: int, x: int, size: int = 120) -> float:
    """How much a patch's brightness varies: high on the sharp checkerboard, low once blurred."""
    return float(frame[y : y + size, x : x + size].mean(axis=2).std())


def test_a_rendered_frame_shows_the_subject_over_its_own_picture_blurred(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    # Track crops the middle 9:16 of the frame (202x360), scaled 5.33 times: the disc's radius is 373 px.
    plain = patch(client, job, candidate, layout="track", segments=[first, second])
    sharp = pixels_of(settings, Path(saved_frame(client, job, plain, at=0.5)["path"]))
    cut = pixels_of(settings, Path(saved_frame(client, job, plain, at=0.5, draft={"segments": [cut_out(first), second]})["path"]))
    # Inside the disc, the subject as it was.
    red = patch_mean(cut, 940, 520)
    assert red[0] > 200 and red[1] < 40 and abs(red - patch_mean(sharp, 940, 520)).max() < 6, red
    # Outside it, the checkerboard blurred: its squares (107 px on the frame) smoothed away.
    assert roughness(sharp, 60, 60) > 15 and roughness(cut, 60, 60) < roughness(sharp, 60, 60) / 3, (roughness(sharp, 60, 60), roughness(cut, 60, 60))
    # The next Segment isn't cut out.
    after = preview(client, job, plain)["plan"]["segments"][1]
    later = pixels_of(settings, Path(saved_frame(client, job, plain, at=after["start"] + 0.3, draft={"segments": [cut_out(first), second]})["path"]))
    assert roughness(later, 60, 60) > 15


def rings(hard: np.ndarray, soft: np.ndarray) -> list[float]:
    """How much two frames differ (RGB summed, averaged) inside the disc (radius 373 about 540, 960 on
    the frame), within 40 px inside and outside its edge, and well away from it."""
    differ = np.abs(hard - soft).sum(axis=2)
    y, x = np.mgrid[: differ.shape[0], : differ.shape[1]]
    radius = np.hypot(x - 540, y - 960)
    return [float(differ[(radius >= lo) & (radius < hi)].mean()) for lo, hi in ((0, 300), (333, 373), (373, 413), (500, 700))]


def test_the_feather_softens_the_edge(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [first] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, candidate, layout="track", segments=[cut_out(first, feather=0)])
    hard = pixels_of(settings, Path(saved_frame(client, job, candidate, at=0.5)["path"]))
    soft = pixels_of(settings, Path(saved_frame(client, job, candidate, at=0.5, draft={"segments": [cut_out(first, feather=20)]})["path"]))
    # Feathered by 20 px: the Background shows a little inside the edge, and the picture a little
    # outside it; the middle and what is far from the edge stay as they were.
    middle, inside, outside, far = rings(hard, soft)
    assert inside > 8 and outside > 8 and middle < 0.5 and far < 0.5, (middle, inside, outside, far)


def lumas(settings, video: Path) -> np.ndarray:
    """Each frame's mean brightness in the middle of the disc, which grows with the Source's time."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", "crop=100:100:490:910,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-"]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, np.uint8).astype(float)


def test_a_cut_out_segment_under_a_transition_keeps_its_timing(client, settings):
    job = reviewed(client)
    pieces_ = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    fade = [{"after": "s0", "kind": "fade", "secs": 0.4}]
    cut = [pieces_[0], cut_out(pieces_[1], feather=0), pieces_[2]]
    plain = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=pieces_, transitions=fade)
    matted = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=cut, transitions=fade)
    assert [s["end"] for s in preview(client, job, plain)["plan"]["segments"]] == [s["end"] for s in preview(client, job, matted)["plan"]["segments"]]
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=90)["clips"]}
    job_dir = settings.data_dir / "jobs" / job["id"]
    drawn = {}
    for candidate in (plain, matted):
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        drawn[candidate["id"]] = lumas(settings, job_dir / clip["output"]["video"])
    before, after = drawn[plain["id"]], drawn[matted["id"]]
    assert len(before) == len(after)
    # The disc is kept as it was: its colour, which jumps with the Source's time at the joins and
    # changes through the fade, is the same on every frame.
    assert np.abs(before - after).max() < 3, np.abs(before - after).max()


def test_a_render_makes_the_missing_pieces_first(client, settings, person_model):
    person_model.path.unlink()
    job = reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[cut_out(first)])
    # Without the person model nothing is made: it waits.
    assert settled(client, job, candidate)["state"] == "waiting" and pieces(settings, job) == []
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "error" and "Segment s0's background couldn't be removed: the person model isn't downloaded" in clip["error"]

    person_model.path.write_bytes(b"rvm")
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert pieces(settings, job) == ["person-fake-1-0.mp4"]


def test_a_failed_piece_fails_the_render_until_a_retry(client, settings, matter):
    matter.failing = "no subject found"
    job = reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[cut_out(first)])
    failed = settled(client, job, candidate)
    assert failed["state"] == "failed" and failed["error"] == "no subject found" and failed["segments"]["s0"]["state"] == "failed"
    # Remembered: it isn't made again until a Retry, not by a render either.
    matter.failing = None
    assert matte_of(client, job, candidate)["state"] == "failed"
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "error" and "Segment s0's background couldn't be removed: no subject found" in clip["error"]

    matte_of(client, job, candidate, retry=True)
    assert settled(client, job, candidate)["state"] == "ready"
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]


def test_it_is_saved_kept_on_a_lone_segment_and_bad_values_are_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    whole = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}
    saved = patch(client, job, candidate, segments=[cut_out(whole)])
    assert saved["segments"][0]["background_removal"] == {"subject": "person", "feather": 4.0}
    assert patch(client, job, saved, segments=[whole])["segments"] == []
    refused = client.patch(candidate_url(job, saved), json={"segments": [cut_out(whole, feather=50)]})
    assert refused.status_code == 422 and "Segment e's background_removal feather is 50; it is 0 to 40" in refused.text
    refused = client.patch(candidate_url(job, saved), json={"segments": [whole | {"background_removal": {"subject": "cat"}}]})
    assert refused.status_code == 422 and "subject" in refused.text and "person" in refused.text


def test_a_cut_out_segment_shown_by_a_keyed_manual_override_is_refused_on_save_naming_it(client):
    """The render can't cut a keyed picture yet, so the preview mustn't either: refused at once."""
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    framing = {"transform": {"scale": 1}}
    keyed = lambda at: {"at": at, "layout": "manual", "framing": framing, "keys": {"scale": [{"at": 0, "value": 1}, {"at": 0.5, "value": 1.5}]}}  # noqa: E731
    within, beyond = (first["start"] + first["end"]) / 2, (second["start"] + second["end"]) / 2
    saved = patch(client, job, candidate, segments=[cut_out(first), second], layout_overrides=[keyed(beyond)])
    message = "Segment s0 is cut out (Background removal) but its picture has Keyframes"
    refused = client.patch(candidate_url(job, saved), json={"layout_overrides": [keyed(within)]})
    assert refused.status_code == 422 and message in refused.text, refused.text
    unkeyed = patch(client, job, saved, layout_overrides=[keyed(within) | {"keys": {}}])
    refused = client.patch(candidate_url(job, unkeyed), json={"segments": [cut_out(first), second], "layout_overrides": [keyed(within)]})
    assert refused.status_code == 422 and message in refused.text, refused.text
    # A draft is refused alike, so the preview never cuts what the render won't.
    drafted = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan", json={"layout_overrides": [keyed(within)]})
    assert drafted.status_code == 422 and message in drafted.text


# MCP


@pytest.fixture
async def mcp(client):
    async with Client(client.app.state.mcp) as session:
        yield session


@pytest.mark.anyio
async def test_the_agent_cuts_out_a_segment_follows_its_matte_and_is_refused_a_bad_value(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 1.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [
        {"id": "a", "start": 1.0, "end": 1.6, "volume": 0.5}, {"id": "b", "start": 0.1, "end": 0.9},
    ]})
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "background_removal": {"subject": "person", "feather": 8}}])
    assert merged["segments"][0]["background_removal"] == {"subject": "person", "feather": 8.0} and merged["segments"][0]["volume"] == 0.5

    matte = await call(mcp, "wait_for_matte", **ids, timeout_secs=30)
    assert matte["state"] == "ready" and matte["segments"] == {"a": {"state": "ready", "progress": 1.0, "error": None}}

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    cut, plain = plan["segments"]
    assert cut["background_removal"] == {"subject": "person", "feather": 8.0} and "background_removal" not in plain

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "background_removal": {"feather": 41}}])
    assert "Segment a's background_removal feather is 41; it is 0 to 40" in message
    message = await fails(mcp, "edit_candidate", **ids, changes={"segments": [{"id": "a", "start": 1.0, "end": 1.6, "background_removal": {"subject": "dog"}}]})
    assert "subject" in message


# The real matter's sessions (ticket 13): RVM through CoreML's MLProgram on a fixed-shape copy of the model
# for each Matte size, the CPU where that can't be had. A stand-in model with RVM's interface keeps it quick.


def rvm_like(path: Path) -> Path:
    """A model with RVM's inputs and outputs, written to `path`: `pha` is the frame's red (through the
    `downsample_ratio`, there and back), each state `r{i}o` its `r{i}i` plus the red pooled 2^(i-1) times
    smaller, so that the states' shapes follow the frame's size as RVM's do."""
    import onnx
    from onnx import TensorProto, helper

    dynamic = ["batch_size", "channels", "height", "width"]
    inputs = [helper.make_tensor_value_info("src", TensorProto.FLOAT, ["batch_size", 3, "height", "width"])]
    inputs += [helper.make_tensor_value_info(f"r{i}i", TensorProto.FLOAT, dynamic) for i in range(1, 5)]
    inputs += [helper.make_tensor_value_info("downsample_ratio", TensorProto.FLOAT, [1])]
    outputs = [helper.make_tensor_value_info(name, TensorProto.FLOAT, None) for name in ("fgr", "pha", "r1o", "r2o", "r3o", "r4o")]
    constants = [helper.make_tensor(name, TensorProto.INT64, [1], [value]) for name, value in (("zero", 0), ("one", 1), ("axis", 1))]
    nodes = [
        helper.make_node("Identity", ["src"], ["fgr"]),
        helper.make_node("Slice", ["src", "zero", "one", "axis"], ["red"]),
        helper.make_node("Mul", ["red", "downsample_ratio"], ["scaled"]),
        helper.make_node("Div", ["scaled", "downsample_ratio"], ["pha"]),
    ]
    for i in range(1, 5):
        side = 2 ** (i - 1)
        nodes.append(helper.make_node("MaxPool", ["pha"], [f"pooled{i}"], kernel_shape=[side, side], strides=[side, side], pads=[0, 0, 0, 0]))
        nodes.append(helper.make_node("Add", [f"r{i}i", f"pooled{i}"], [f"r{i}o"]))
    graph = helper.make_graph(nodes, "rvm-like", inputs, outputs, initializer=constants)
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(helper.make_model(graph, opset_imports=[helper.make_opsetid("", 12)], ir_version=8), str(path))
    return path


def frame_of(width: int, height: int) -> np.ndarray:
    """A frame whose red is a gradient (so that the Matte shows where it was read wrong)."""
    frame = np.zeros((height, width, 3), np.uint8)
    frame[..., 0] = (np.arange(width * height).reshape(height, width) * 7) % 256
    return frame


coreml_offered = pytest.mark.skipif(
    "CoreMLExecutionProvider" not in __import__("onnxruntime").get_available_providers(), reason="CoreML isn't offered here"
)


@coreml_offered
def test_the_matter_runs_a_fixed_shape_copy_of_the_model_for_each_matte_size_through_coreml(tmp_path):
    model = rvm_like(tmp_path / "models" / PERSON_MODEL_FILE)
    matter = RvmMatter(model)
    for size in ((64, 48), (48, 64)):
        frame = frame_of(*size)
        alpha = matter.run()
        assert np.array_equal(alpha(frame), frame[..., 0]) and np.array_equal(alpha(frame), frame[..., 0])
        assert fixed_copy(model, size).is_file()
        assert matter.session(size).get_providers()[0] == "CoreMLExecutionProvider"
    # The copy is made once: a matter loaded later (the app's next start) reads it.
    made = fixed_copy(model, (64, 48)).stat().st_mtime_ns
    assert np.array_equal(RvmMatter(model).run()(frame_of(64, 48)), frame_of(64, 48)[..., 0])
    assert fixed_copy(model, (64, 48)).stat().st_mtime_ns == made
    assert sorted(path.name for path in model.parent.iterdir()) == sorted(
        [model.name, fixed_copy(model, (64, 48)).name, fixed_copy(model, (48, 64)).name]
    )


@pytest.mark.parametrize("unavailable", ["coreml", "onnx", "rewrite", "cpu only"])
def test_without_coreml_or_the_copy_the_matter_runs_the_model_on_the_cpu_with_the_same_matte(tmp_path, monkeypatch, unavailable):
    import onnxruntime

    from app import matte

    model = rvm_like(tmp_path / "models" / PERSON_MODEL_FILE)
    kind = RvmMatter
    if unavailable == "coreml":
        monkeypatch.setattr(onnxruntime, "get_available_providers", lambda: ["CPUExecutionProvider"])
    elif unavailable == "onnx":
        monkeypatch.setitem(__import__("sys").modules, "onnx", None)
    elif unavailable == "rewrite":
        def broken(*args, **kwargs):
            raise RuntimeError("the rewrite failed")

        monkeypatch.setattr(matte, "fixed_shape_copy", broken)
    else:
        kind = type("CpuRvmMatter", (RvmMatter,), {"coreml": False})
    matter = kind(model)
    frame = frame_of(64, 48)
    alpha = matter.run()
    assert np.array_equal(alpha(frame), frame[..., 0]) and np.array_equal(alpha(frame), frame[..., 0])
    assert matter.session((64, 48)).get_providers() == ["CPUExecutionProvider"]
    assert not fixed_copy(model, (64, 48)).exists()
    assert [path.name for path in model.parent.iterdir()] == [model.name]
