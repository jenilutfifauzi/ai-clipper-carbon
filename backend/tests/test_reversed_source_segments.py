"""A reversed Segment of the Source (.scratch/speed/issues/07-reversed-source-segment.md): Seam B on the
planner, no captions in its span, its Scenes, camera path, Layout Overrides and a Manual Scene's
motion mirrored; then Seam A through the API, the MCP and a real render of a Split Scene played
backwards from the Source's Retimed copy."""

import subprocess
import time
from pathlib import Path

import numpy as np
import pytest

from app.candidates import EASE_IN, EASE_OUT, Keyframe, KeyProperty, Layout, LayoutOverride, Segment, WordEdit
from app.config import CameraTuning, load_settings
from app.keyframes import value_at
from app.planner import Scene, SceneLayout, SegmentInput, plan_render
from app.rendering import candidate_plan, source_copies
from app.retimed import CopySize, Retime
from app.styles import PresetStore
from app.transcript import Word
from app.video_source import Source, SourceMetadata
from test_keyed_scenes import by_hand
from test_keyframes import clip_of
from test_media_library import make
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import SOURCE_SECS, add, preview, probe, reviewed
from test_review import patch
from test_segments import SOURCE
from test_segments import manual as manual_candidate
from test_sped_source_segments import GLIDE, caption_words

# Seam B: the planner


def test_a_reversed_source_segment_has_no_captions_and_those_either_side_are_unchanged():
    def track(reverse: bool):
        return [
            SegmentInput(20, 22, words=[Word("satu", 0.5, 0.9)]),
            SegmentInput(10, 14, words=[Word("dua", 1.0, 1.4), Word("tiga", 2.0, 2.6)], reverse=reverse),
            SegmentInput(30, 32, words=[Word("empat", 0.2, 0.6)]),
        ]

    forwards, backwards = (plan_render(10, 32, SOURCE, main_track=track(reverse)) for reverse in (False, True))
    middle = backwards.segments[1]
    assert (middle.start, middle.end, middle.reverse) == (2, 6, True)
    assert not [event for event in backwards.captions if event.end > middle.start and event.start < middle.end]
    assert caption_words(backwards) == [word for word in caption_words(forwards) if word[0] in ("SATU", "EMPAT")] == [("SATU", 0.5), ("EMPAT", 6.2)]


def test_a_word_edit_in_a_reversed_segment_is_kept_and_applied_where_its_time_plays_forwards(tmp_path):
    candidate = manual_candidate(
        segments=[Segment("a", 10, 14), Segment("b", 10, 14, reverse=True)],
        word_edits=[WordEdit(12.2, "TIGA!")],
    )
    words = [[Word("dua", 1.0, 1.4), Word("tiga", 2.0, 2.6)], [Word("dua", 1.0, 1.4), Word("tiga", 2.0, 2.6)]]
    planned = candidate_plan(candidate, SOURCE, words, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert caption_words(planned) == [("DUA", 1), ("TIGA!", 2)]
    assert candidate.word_edits == [WordEdit(12.2, "TIGA!")]


@pytest.mark.parametrize("speed", [1, 2])
def test_a_scene_cut_2_s_into_a_10_s_range_sits_at_8_s_into_it_reversed_divided_by_its_speed(speed):
    reversed_segment = SegmentInput(10, 20, [Scene(0, 2), Scene(2, 10)], speed=speed, reverse=True)
    planned = plan_render(10, 20, SOURCE, layout=Layout.TRACK, main_track=[SegmentInput(30, 31), reversed_segment])
    assert [(scene.start, scene.end) for scene in planned.scenes] == [(0, 1), (1, 1 + 8 / speed), (1 + 8 / speed, 1 + 10 / speed)]


def crop_at(panel, at: float) -> tuple[int, int]:
    point = next(point for point in reversed(panel.path) if point.at <= at)
    return point.x, point.y


@pytest.mark.parametrize("speed", [1, 2])
def test_the_camera_path_of_a_reversed_segment_is_the_forward_one_run_backwards(speed):
    shots = [Scene(0, 1.5), Scene(1.5, 4)]

    def planned(reverse: bool, at: float):
        segment = SegmentInput(10, 14, shots, GLIDE, speed=at, reverse=reverse)
        return plan_render(10, 14, SOURCE, layout=Layout.TRACK, main_track=[segment]).scenes

    forwards, backwards = planned(False, 1), planned(True, speed)
    assert [(scene.start, scene.end) for scene in backwards] == [(0, 2.5 / speed), (2.5 / speed, 4 / speed)]
    assert len(forwards[1].panels[0].path) > 5
    for t in np.arange(0.005, 4 / speed, 0.01):
        shown = next(scene for scene in backwards if scene.start <= t < scene.end)
        mirrored = 4 - t * speed
        forward = next(scene for scene in forwards if scene.start < mirrored <= scene.end)
        assert crop_at(shown.panels[0], t) == crop_at(forward.panels[0], mirrored - 1e-6), t
    # Its first frame is drawn from the forward Scene's last crop.
    assert backwards[0].framing.transform != forwards[1].framing.transform


def test_a_layout_override_in_a_reversed_segment_applies_to_the_mirrored_scene_holding_its_source_time():
    backwards = SegmentInput(10, 20, [Scene(0, 2), Scene(2, 10)], reverse=True, layout_overrides=[LayoutOverride(1.0, Layout.BLUR)])
    planned = plan_render(10, 20, SOURCE, layout=Layout.TRACK, main_track=[SegmentInput(30, 31), backwards])
    assert [(scene.start, scene.end, scene.layout) for scene in planned.scenes] == [
        (0, 1, SceneLayout.TRACK), (1, 9, SceneLayout.TRACK), (9, 11, SceneLayout.BLUR),
    ]


def test_a_manual_scenes_motion_in_a_reversed_segment_runs_backwards_on_the_same_frames():
    # The override at 13 s frames the shot from 12 s; it pans x 300 → 800 over 0–4 s into the shot,
    # easing in, then back to 500 by 6 s, easing out.
    pan = {KeyProperty.X: [Keyframe(0, 300), Keyframe(4, 800, EASE_IN), Keyframe(6, 500, EASE_OUT)]}
    backwards = SegmentInput(10, 20, [Scene(0, 2), Scene(2, 10)], reverse=True, layout_overrides=[by_hand(3, pan)])
    manual_scene, _ = plan_render(10, 20, SOURCE, main_track=[backwards]).scenes
    assert (manual_scene.start, manual_scene.end, manual_scene.keys_from) == (0, 8, None)
    # 12 s + k on the Source shows at 8 − k into the Clip.
    keys = manual_scene.picture.motion["x"]
    assert [(key.at, key.value) for key in keys] == [(2, 500), (4, 800), (8, 300)]
    # An ease out run backwards is an ease in, and the other way round.
    assert (keys[1].ease, keys[2].ease) == (EASE_IN, EASE_OUT)
    forwards = plan_render(10, 20, SOURCE, main_track=[SegmentInput(10, 20, [Scene(0, 2), Scene(2, 10)], layout_overrides=[by_hand(3, pan)])])
    forward_keys = forwards.scenes[1].picture.motion["x"]
    for k in (0.5, 3.0, 4.7, 5.5):
        assert value_at(keys, 8 - k, 0) == pytest.approx(value_at(forward_keys, 2 + k, 0), abs=1e-6), k


# Seam A: the API and MCP


def wait_for(client, url: str, body: dict) -> dict:
    deadline = time.monotonic() + 30
    while (answer := client.post(url, json=body)).status_code == 200 and answer.json()["url"] is None:
        assert answer.json()["error"] is None and time.monotonic() < deadline, answer.json()
        time.sleep(0.05)
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_the_editor_asks_for_a_preview_copy_of_a_range_of_the_source_served_from_the_jobs_directory(client, settings):
    job = reviewed(client)
    url = f"/api/jobs/{job['id']}/retimed"
    made = wait_for(client, url, {"start": 0.5, "end": 2.0})
    assert made == {"progress": 1, "url": f"/media/{job['id']}/retimed/reversed-preview-500-2000.mp4", "at": 0, "error": None}
    served = client.get(made["url"])
    assert served.status_code == 200 and served.headers["content-type"] == "video/mp4"
    assert client.post(url, json={"start": 1, "end": 1.5}).json()["at"] == 0.5
    for body in ({"start": 1, "end": SOURCE_SECS + 1}, {"start": 1, "end": 0.5}, {"start": 0, "end": 1, "reverse": False}):
        assert client.post(url, json=body).status_code == 422, body
    assert client.post("/api/jobs/nope/retimed", json={"start": 0, "end": 1}).status_code == 404


def test_a_one_segment_reversed_clip_is_kept_as_its_segment_and_previews_no_words(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    start, end = candidate["start"], candidate["end"]
    saved = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "reverse": True}])
    assert [(segment["start"], segment["end"], segment["reverse"]) for segment in saved["segments"]] == [(start, end, True)]
    shown = preview(client, job, saved)
    assert shown["words"] == [] and shown["plan"]["captions"] == []
    assert shown["plan"]["segments"][0]["reverse"] is True


@pytest.mark.anyio
async def test_the_agent_reverses_a_segment_of_the_episode_and_the_dry_run_has_no_captions_in_it(client, mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    episode = {"id": "e", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [episode, episode | {"id": "r"}]})
    saved = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "r", "reverse": True}])
    assert [segment["reverse"] for segment in saved["segments"]] == [False, True]

    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    forwards, backwards = plan["segments"]
    assert (backwards["reverse"], backwards["copy"]) == (True, "made by the render")
    assert plan["captions"] and all(caption["end"] <= backwards["start"] + 0.01 for caption in plan["captions"])
    stored = client.app.state.store
    source_copies(stored.job_dir(job["id"]), stored.get(job["id"]).source).make(
        load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, HALO_KABAR[1] + 0.5)
    )
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    assert plan["segments"][1]["copy"] == "ready"


# Seam A: the real ffmpeg

FPS = 30
# The Source's left half brightens by 2 a frame and its right half darkens by 2, from 16 and 224,
# starting again every 3.5 s: a frame counter on each Split panel, which add up to 240 on any one frame.
PERIOD = 105
# Each frame's step, as the Clip shows it: its frames are full range, the counters limited range.
STEP = 2 * 255 / 219


@pytest.fixture(scope="session")
def two_counters(tmp_path_factory) -> Path:
    lavfi = ("-f", "lavfi", "-i")
    path = tmp_path_factory.mktemp("counters") / "source.mp4"
    luma = f"if(lt(X,W/2),16+mod(N,{PERIOD})*2,224-mod(N,{PERIOD})*2)"
    make(
        path,
        *lavfi, f"color=c=black:size=640x360:rate={FPS}:duration={SOURCE_SECS},format=yuv420p,geq=lum='{luma}':cb=128:cr=128",
        *lavfi, f"sine=frequency=440:duration={SOURCE_SECS}",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac", "-shortest",
    )
    return path


def panel_lumas(settings, video: Path) -> np.ndarray:
    """The mean luma of a patch in the middle of each Split panel (top, bottom), clear of the captions
    on the seam, of each of the Clip's frames."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-i", str(video),
        "-vf", "crop=200:1460:440:200,scale=1:146:flags=area,format=gray", "-f", "rawvideo", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    rows = np.frombuffer(data, dtype=np.uint8).astype(float).reshape(-1, 146)
    return np.stack([rows[:, :50].mean(axis=1), rows[:, 96:].mean(axis=1)], axis=1)


def test_a_split_scene_renders_both_panels_backwards_and_in_step_from_the_sources_copy(client, settings, video_source, two_counters):
    video_source.video = two_counters
    job = reviewed(client)
    words = {word["text"]: word for word in job["transcript"]["words"]}
    start, end = words["halo"]["start"], words["soal"]["end"]
    candidate = add(client, job, "halo", "soal")
    candidate = patch(client, job, candidate, layout="split", segments=[
        {"id": "a", "start": start, "end": words["kabar"]["end"]},
        {"id": "r", "start": start, "end": end, "reverse": True},
        {"id": "b", "start": words["Podcast"]["start"], "end": words["ya"]["end"]},
    ])
    planned = preview(client, job, candidate)["plan"]
    first, backwards, last = planned["segments"]
    # Its ends as snapped to the Words.
    start, end = backwards["source_start"], backwards["source_end"]
    assert end < PERIOD / FPS
    assert all(scene["layout"] == "split" for scene in planned["scenes"])
    clip = clip_of(client, settings, job, candidate)
    assert float(probe(settings, clip)["format"]["duration"]) == pytest.approx(last["end"], abs=0.1)
    # The render made the full-size copy of its range.
    copies = settings.data_dir / "jobs" / job["id"] / "retimed"
    assert [path.name for path in copies.iterdir()] == [Retime(start, end).name(CopySize.FULL)]

    shown = panel_lumas(settings, clip)
    top, bottom = shown[:, 0], shown[:, 1]
    on, off = round(backwards["start"] * FPS), round(backwards["end"] * FPS)
    # In step: both panels show one frame of the Source at a time.
    assert np.abs(top + bottom - 104 * STEP).max() <= 3
    # Forwards before it, then backwards from the frame before its end to its first, a frame at a time.
    assert (np.abs(np.diff(top[1:on - 1]) - STEP) <= 1).all()
    steps = np.diff(top[on:off])
    assert len(steps) > 50 and (np.abs(steps + STEP) <= 1).all(), steps
    assert top[on] == pytest.approx(STEP * (round(end * FPS) - 1), abs=2)
    assert top[off - 1] == pytest.approx(STEP * round(start * FPS), abs=2)


def test_source_copies_are_the_jobs_from_its_proxy_and_its_video(tmp_path):
    source = Source("video.mkv", None, SourceMetadata(60, 25, 1920, 1080, "h264"), preview="preview.mp4")
    copies = source_copies(tmp_path, source)
    assert (copies.folder, copies.frame) == (tmp_path / "retimed", (1920, 1080, 25))
    assert copies.videos == {CopySize.PREVIEW: tmp_path / "preview.mp4", CopySize.FULL: tmp_path / "video.mkv"}
