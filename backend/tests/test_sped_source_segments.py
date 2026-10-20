"""A sped Segment of the Source (.scratch/speed/issues/03-sped-source-segment.md): Seam B on the
planner, its Words, Word Edits, Scenes, camera path and Layout Overrides placed on the Timeline
through the mapping; then Seam A through the API, MCP and the real ffmpeg: a one-Segment Clip kept
at its Speed, its captions burned in time with its speech."""

import json

import numpy as np
import pytest

from app.candidates import Layout, LayoutOverride, Segment, WordEdit
from app.config import CameraTuning
from app.planner import FrameFaces, Scene, SceneLayout, SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.transcript import Word
from conftest import cue_text, cue_words
from test_keyed_scenes import by_hand
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_planner import face
from test_render import BACKGROUND, HEARD, ORANGE, add, full_frame, output_frame, pixels, preview, probe, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, moving_face, plain_video, render_video  # noqa: F401
from test_review import candidates, patch
from test_segments import SOURCE
from test_segments import manual as manual_candidate

# Seam B: the planner


def caption_words(planned) -> list[tuple[str, float]]:
    return [(word.text, word.start) for event in planned.captions for word in event.words]


@pytest.mark.parametrize("speed", [2, 0.5])
def test_words_of_a_sped_source_segment_land_at_their_offsets_divided_by_its_speed(speed):
    words = [Word("dua", 1.0, 1.4), Word("tiga", 2.0, 2.6)]
    planned = plan_render(
        10, 22, SOURCE,
        main_track=[SegmentInput(20, 22, words=[Word("satu", 0.5, 0.9)]), SegmentInput(10, 14, words=words, speed=speed)],
    )
    assert planned.segments[1].start == 2 and planned.segments[1].end == 2 + 4 / speed
    assert caption_words(planned) == [("SATU", 0.5), ("DUA", 2 + 1 / speed), ("TIGA", 2 + 2 / speed)]


def test_a_word_edit_finds_its_word_in_a_half_speed_segment(tmp_path):
    candidate = manual_candidate(
        segments=[Segment("a", 20, 22), Segment("b", 10, 14, speed=0.5)],
        word_edits=[WordEdit(12.2, "TIGA!")],
    )
    words = [[Word("satu", 0.5, 0.9)], [Word("dua", 1.0, 1.4), Word("tiga", 2.0, 2.6)]]
    planned = candidate_plan(candidate, SOURCE, words, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [event.text for event in planned.captions] == ["SATU", "DUA", "TIGA!"]
    assert caption_words(planned)[1:] == [("DUA", 4), ("TIGA!", 6)]


# A face gliding across the 1920 px Source over its first 3 s, sampled every 0.12 s.
GLIDE = [FrameFaces(round(k * 0.12, 3), [face(500 + min(900, 300 * k * 0.12))]) for k in range(34)]


def test_scenes_and_the_camera_path_of_a_sped_segment_are_those_at_1x_scaled_by_one_over_its_speed():
    shots = [Scene(0, 1.5), Scene(1.5, 4)]

    def planned(speed: float):
        return plan_render(10, 14, SOURCE, layout=Layout.TRACK, main_track=[SegmentInput(10, 14, shots, GLIDE, speed=speed)]).scenes

    at_1x = planned(1)
    assert len(at_1x) == 2 and len(at_1x[1].panels[0].path) > 5
    for speed in (2, 0.5):
        sped = planned(speed)
        assert [(scene.start, scene.end) for scene in sped] == [(scene.start / speed, scene.end / speed) for scene in at_1x]
        for scene, normal in zip(sped, at_1x):
            [panel], [panel_1x] = scene.panels, normal.panels
            assert [(point.at, point.x, point.y) for point in panel.path] == [
                (pytest.approx(point.at / speed, abs=1e-3), point.x, point.y) for point in panel_1x.path
            ]


def test_a_layout_override_in_a_2x_segment_applies_to_the_scene_holding_its_source_time():
    shots = [Scene(0, 2), Scene(2, 4)]
    sped = SegmentInput(10, 14, shots, speed=2, layout_overrides=[LayoutOverride(3.0, Layout.BLUR)])
    planned = plan_render(10, 14, SOURCE, layout=Layout.TRACK, main_track=[SegmentInput(20, 21), sped])
    assert [(scene.start, scene.end, scene.layout) for scene in planned.scenes] == [
        (0, 1, SceneLayout.TRACK), (1, 2, SceneLayout.TRACK), (2, 3, SceneLayout.BLUR),
    ]


def test_a_manual_scenes_keyframes_in_a_2x_segment_stay_on_the_same_frames():
    # The override at 13 s frames the shot from 12 s; its Keyframes 0 and 4 s into the shot on the Source.
    sped = SegmentInput(10, 20, [Scene(0, 2), Scene(2, 10)], speed=2, layout_overrides=[by_hand(3)])
    _, manual_scene = plan_render(10, 20, SOURCE, main_track=[sped]).scenes
    assert (manual_scene.start, manual_scene.end, manual_scene.keys_from) == (1, 5, 1)
    assert [(key.at, key.value) for key in manual_scene.picture.motion["x"]] == [(1, 300), (3, 800)]


# Seam A: the API and MCP


def test_a_one_segment_clip_at_2x_is_kept_as_its_segment_and_previews_its_words_retimed(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    start, end = candidate["start"], candidate["end"]
    saved = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "speed": 2}])
    assert (saved["start"], saved["end"]) == (start, end)
    assert [(segment["id"], segment["start"], segment["end"], segment["speed"]) for segment in saved["segments"]] == [("e", start, end, 2)]
    [reloaded] = [found for found in candidates(client, job) if found["id"] == saved["id"]]
    assert reloaded["segments"] == saved["segments"]

    shown = preview(client, job, saved)
    assert shown["plan"]["segments"][0]["end"] == pytest.approx((end - start) / 2, abs=1e-3)
    heard = {word["text"]: word for word in job["transcript"]["words"]}
    assert [word["text"] for word in shown["words"]] == ["halo", "semua", "apa", "kabar", "kita", "ngobrol", "soal"]
    for word in shown["words"]:
        said = heard[word["text"]]
        assert word["start"] == pytest.approx((said["start"] - start) / 2, abs=1e-3)
        # A Word Edit of it is still keyed by its time on the Source.
        assert word["at"] == pytest.approx((said["start"] + said["end"]) / 2, abs=1e-3)

    # At 1× again, one Segment is the plain range it was.
    assert patch(client, job, saved, segments=[{"id": "e", "start": start, "end": end}])["segments"] == []


@pytest.mark.anyio
async def test_the_agent_slows_a_segment_of_the_episode_and_its_word_edit_stays_on_its_word(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    kabar = next(word for word in plan["words"] if word["text"] == "kabar")
    segment = {"id": "e", "start": candidate["start"], "end": candidate["end"], "speed": 0.5}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [segment], "word_edits": [{"at": kabar["at"], "text": "kabarnya"}]})

    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    [sped] = plan["segments"]
    assert (sped["speed"], sped["end"]) == (0.5, round(2 * (candidate["end"] - candidate["start"]), 2))
    slowed = next(word for word in plan["words"] if word["text"] == "kabar")
    assert (slowed["start"], slowed["at"], slowed["edit"]["text"]) == (pytest.approx(2 * kabar["start"], abs=0.02), kabar["at"], "kabarnya")
    assert any("KABARNYA" in line for caption in plan["captions"] for line in caption["lines"])


# Seam A: the real ffmpeg


def test_a_source_segment_at_1_5x_burns_its_captions_in_time_with_its_speech(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    start, end = candidate["start"], candidate["end"]
    candidate = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "speed": 1.5}])
    render(client, job)
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    video = job_dir / clip["output"]["video"]
    assert float(probe(settings, video)["format"]["duration"]) == pytest.approx((end - start) / 1.5, abs=0.08)

    # The plan's Words are where they are said at 1.5×.
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    said = [word for word in HEARD if start < (word.start + word.end) / 2 < end]
    spoken = [word for event in plan["captions"] for word in cue_words(event)]
    assert [word["start"] for word in spoken] == [pytest.approx((word.start - start) / 1.5, abs=1e-3) for word in said]
    # Burned in: each Word in orange while it is said, the highlight moving along its line.
    for event in plan["captions"]:
        lefts = []
        for word in cue_words(event):
            frame = full_frame(settings, video, (word["start"] + word["end"]) / 2)
            rows, columns = pixels(frame, ORANGE)
            assert len(rows) > 300, (word, len(rows))
            lefts.append(columns.mean())
        assert lefts == sorted(lefts), (cue_text(event), lefts)


def test_a_2x_segments_crop_follows_its_face_at_its_speed(client, settings, video_source, moving_face):
    video_source.video = moving_face
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    start, end = candidate["start"], candidate["end"]
    candidate = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "speed": 2}], layout="track")
    render(client, job)
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    plan = json.loads((job_dir / clip["output"]["plan"]).read_text())
    [scene] = plan["scenes"]
    path = scene["panels"][0]["path"]
    assert scene["end"] == pytest.approx((end - start) / 2, abs=1e-3)
    # The face glides 600 px from 0.5 s to 5.5 s of the Source: in the Clip, within its 3 s.
    assert len(path) > 10 and path[-1]["x"] - path[0]["x"] > 400
    for at in (0.1, 1.4, 2.7):
        middle = output_frame(settings, job_dir / clip["output"]["video"], at)[30:70, 12:42]
        assert (np.abs(middle - BACKGROUND).max(axis=2) > 24).mean() > 0.9, at
