"""Freeze frames: a Segment that holds one frame of the Source or of a video for its `hold`
(.scratch/speed/issues/10-freeze-frame.md, docs/adr/0009).

Seam B on the planner and candidate_plan, then Seam A through the API, the MCP server and the real ffmpeg.
"""

from dataclasses import replace
from datetime import UTC, datetime

import numpy as np
import pytest

from app.analysis import ClipAnalysis
from app.candidates import Framing, Keyframe, KeyProperty, Layout, LayoutOverride, Segment, Transform, manual_candidate
from app.config import AnalysisTuning, CameraTuning
from app.media import MediaItem, MediaKind
from app.pictures import cover_scale
from app.planner import FRAME, FrameFaces, Scene, SceneLayout, SegmentPlan, _first_framing
from app.rendering import HELD_REACH_SECS, analysed_range, candidate_plan
from app.styles import PresetStore
from app.transcript import Word
from app.video_source import SourceMetadata
from test_media_library import upload
from test_music import loudness_by_window
from test_planner import crop_at, face, sampled
from test_render import add, full_frame, moving_face, output_frame, preview, render, rendered, reviewed  # noqa: F401
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segments import ramp_video  # noqa: F401
from test_mcp import anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_through_mcp

SOURCE = SourceMetadata(duration=600, fps=25.0, width=1920, height=1080, codec="h264")
INTRO = "ab" * 16


class Library:
    """A Media Library holding a 5 s 720x1280 video, INTRO."""

    def find(self, media_id: str) -> MediaItem | None:
        return MediaItem(INTRO, MediaKind.VIDEO, "intro", 1, 5.0, 720, 1280, True, datetime.now(UTC)) if media_id == INTRO else None


def analysis(start: float, end: float, scenes: list[Scene], frames: list[FrameFaces]) -> ClipAnalysis:
    return ClipAnalysis(start, end, AnalysisTuning(), "blaze", scenes, frames)


def plan(tmp_path, candidate, words, analyses):
    return candidate_plan(candidate, SOURCE, words, analyses, PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Library())


def test_a_held_source_segment_is_one_still_scene_framed_as_the_scene_holding_its_frame(tmp_path):
    # 10–13 s of the Source, a face gliding right through it; then the Freeze frame of 13 s for
    # 1.5 s; then 13–16 s, two faces. The Segment either side was split from one at 13 s.
    glide = analysis(10, 13, [Scene(0, 3)], [FrameFaces(round(k * 0.12, 3), [face(500 + 300 * k * 0.12)]) for k in range(25)])
    two = analysis(13, 16, [Scene(0, 3)], sampled((3, [face(500), face(1400)])))
    candidate = replace(
        manual_candidate("c1", 10, 16),
        segments=[Segment("head", 10, 13), Segment("still", 13, 13, hold=1.5), Segment("tail", 13, 16)],
    )
    # Its analysis is the head's, the first Segment that plays through its frame.
    assert analysed_range(candidate, candidate.segments[1], SOURCE.duration) == (10, 13)
    words = [[Word("halo", 0.5, 1.0)], [Word("salah", -0.2, 0.3)], [Word("semua", 0.2, 0.6)]]
    planned = plan(tmp_path, candidate, words, [glide, glide, two])

    head, still, tail = planned.segments
    assert still == SegmentPlan(3, 4.5, 13, 13, scenes=1, id="still", hold=1.5)
    assert (tail.start, tail.end) == (4.5, 7.5)
    first, held, last = planned.scenes
    assert (held.start, held.end, held.layout) == (3, 4.5, SceneLayout.TRACK)
    assert last.layout is SceneLayout.SPLIT
    # Its crop is where the head's camera has got to at its last frame, held: one point.
    [panel] = held.panels
    moved = crop_at(first.panels[0].path, 3)
    assert moved > first.panels[0].path[0].x
    assert [(point.at, point.x) for point in panel.path] == [(3, moved)]
    assert held.framing == _first_framing(SceneLayout.TRACK, held.panels, SOURCE)
    # No captions while it holds: "salah" (heard around its frame) isn't shown.
    assert [caption.text for caption in planned.captions] == ["HALO", "SEMUA"]
    assert all(caption.end <= 3 or caption.start >= 4.5 for caption in planned.captions)


def test_a_held_source_segment_takes_the_layout_of_its_scene_from_an_override_or_its_faces(tmp_path):
    two = sampled((4, [face(500), face(1400)]))
    analysed = analysis(20, 24, [Scene(0, 2), Scene(2, 4)], two)
    for overrides, layout in (
        ([], SceneLayout.SPLIT),
        # An override in the Scene holding its frame (23 s, in the second shot) applies; one in the first doesn't.
        ([LayoutOverride(23.5, Layout.BLUR)], SceneLayout.BLUR),
        ([LayoutOverride(20.5, Layout.BLUR)], SceneLayout.SPLIT),
    ):
        candidate = replace(
            manual_candidate("c1", 20, 24),
            segments=[Segment("a", 20, 24), Segment("still", 23, 23, hold=1)],
            layout_overrides=overrides,
        )
        planned = plan(tmp_path, candidate, None, [analysed, analysed])
        scene = planned.scenes[-1]
        assert (scene.start, scene.end, scene.layout) == (4, 5, layout), overrides
        assert all(len(panel.path) == 1 for panel in scene.panels)


def test_a_freeze_frame_no_segment_plays_through_is_framed_from_a_short_window_around_it(tmp_path):
    candidate = replace(
        manual_candidate("c1", 10, 12),
        segments=[Segment("a", 10, 12), Segment("still", 30, 30, hold=1)],
        layout=Layout.MANUAL,
        framing=Framing(Transform(scale=2)),
    )
    assert analysed_range(candidate, candidate.segments[1], SOURCE.duration) == (30 - HELD_REACH_SECS, 30 + HELD_REACH_SECS)
    assert analysed_range(candidate, Segment("start", 0.2, 0.2, hold=1), SOURCE.duration) == (0, 0.2 + HELD_REACH_SECS)
    # Unanalysed: still framed, by the Candidate's Manual Framing.
    planned = plan(tmp_path, candidate, None, [None, None])
    scene = planned.scenes[-1]
    assert (scene.start, scene.end, scene.layout, scene.framing) == (2, 3, SceneLayout.MANUAL, candidate.framing)


def test_a_held_media_segment_is_drawn_from_its_framing_and_keyframes_for_its_hold(tmp_path):
    zoom = {KeyProperty.SCALE: [Keyframe(0, 1), Keyframe(1.5, 2)]}
    candidate = replace(
        manual_candidate("c1", 10, 12),
        segments=[Segment("a", 10, 12), Segment("still", 2.5, 2.5, INTRO, Framing(), hold=1.5, keys=zoom)],
    )
    planned = plan(tmp_path, candidate, None, [None, None])
    still = planned.segments[1]
    assert (still.start, still.end, still.source_start, still.hold, still.media) == (2, 3.5, 2.5, 1.5, INTRO)
    scene = planned.scenes[-1]
    assert scene.layout is SceneLayout.MEDIA and scene.picture is not None
    assert [key.at for key in scene.picture.motion[KeyProperty.SCALE]] == [2, 3.5]


# Seam A: the API


def test_freeze_frames_are_saved_unsnapped_and_validated(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    head = {"id": "head", "start": words["halo"]["start"], "end": words["semua"]["end"]}
    tail = {"id": "tail", "start": words["apa"]["start"], "end": words["kabar"]["end"]}
    # Between two Words, where no edge would snap.
    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    saved = patch(client, job, candidate, segments=[head, still, tail])
    assert saved["segments"][1] == still | {"media": None, "framing": None, "volume": 1, "speed": 1, "pitch": False, "keys": {}}
    # The hull is of the Segments that play.
    assert (saved["start"], saved["end"]) == (saved["segments"][0]["start"], saved["segments"][2]["end"])
    planned = preview(client, job, saved)
    span = planned["plan"]["segments"][1]
    assert (span["hold"], round(span["end"] - span["start"], 3)) == (1, 1)
    assert all(not (span["start"] < word["start"] < span["end"]) for word in planned["words"])

    for bad, said in (
        ([head, still | {"end": 0.9}, tail], "end must equal its start"),
        ([head, still | {"hold": 0.05}, tail], "hold"),
        ([head, still | {"keys": {"scale": [{"at": 0, "value": 1}]}}, tail], "Keyframes"),
        ([head, still | {"start": 700, "end": 700}, tail], "past the Source's end"),
        ([still], "plays"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": bad})
        assert response.status_code == 422 and said in response.text, (bad, response.text)


def test_a_freeze_frame_has_no_speed_pitch_or_reverse(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    head = {"id": "head", "start": words["halo"]["start"], "end": words["kabar"]["end"]}
    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    # Reverse comes with ticket 06.
    for bad in ({"speed": 2}, {"pitch": True}, *([{"reverse": True}] if "reverse" in Segment.__dataclass_fields__ else [])):
        response = client.patch(candidate_url(job, candidate), json={"segments": [head, still | bad]})
        assert response.status_code == 422 and "Freeze frame" in response.text, bad


def test_a_held_media_segment_takes_picture_keyframes_but_not_volume_ones(client, ramp_video):
    item = upload(client, ramp_video.read_bytes(), "ramp.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["kabar"]["end"]}
    still = {"id": "still", "start": 4, "end": 4, "hold": 1.5, "media": item["id"], "framing": {}}
    zoom = {"scale": [{"at": 0, "value": 1}, {"at": 1.5, "value": 2}]}
    saved = patch(client, job, candidate, segments=[episode, still | {"keys": zoom}])
    assert saved["segments"][1]["keys"]["scale"][1]["at"] == 1.5
    for bad, said in (
        (still | {"keys": {"volume": [{"at": 0, "value": 0.5}]}}, "volume"),
        (still | {"keys": {"scale": [{"at": 2, "value": 2}]}}, "past its length"),
        (still | {"start": 9, "end": 9}, "past the end"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": [episode, bad]})
        assert response.status_code == 422 and said in response.text, (bad, response.text)


# Seam A: the MCP server


@pytest.mark.anyio
async def test_the_agent_makes_a_freeze_frame_and_the_dry_run_lists_its_span(mcp):  # noqa: F811
    job = await reviewed_through_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 2.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    segments = [{"id": "head", "start": 0.1, "end": 1.6}, {"id": "still", "start": 1.6, "end": 1.6, "hold": 1}, {"id": "tail", "start": 1.6, "end": 2.6}]
    view = await call(mcp, "edit_candidate", **ids, changes={"segments": segments}, dry_run=True)
    held = view["segments"][1]
    assert (held["id"], held["hold"], held["source_start"]) == ("still", 1, 1.6)
    assert round(held["end"] - held["start"], 2) == 1
    assert view["duration"] == pytest.approx(view["segments"][2]["end"])
    assert "end must equal its start" in await fails(
        mcp, "merge_candidate_items", **ids, segments=[{"id": "still", "start": 1.6, "end": 2.0, "hold": 1}]
    )


# Seam A: the real ffmpeg


def luma(frame: np.ndarray) -> float:
    return float(frame[900:1020, 400:680].mean())


def test_a_held_media_segment_renders_its_frame_in_silence_with_transitions_either_side(
    client, settings, video_source, ramp_video,
):
    # The ramp brightens 25 a second, so a frame's brightness tells its time; its tone is heard.
    video_source.video = ramp_video
    item = upload(client, ramp_video.read_bytes(), "ramp.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    cover = {"transform": {"scale": cover_scale(640, 360, FRAME)}}
    candidate = patch(client, job, candidate, segments=[
        {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"]},
        {"id": "still", "start": 6, "end": 6, "hold": 2, "media": item["id"], "framing": cover},
        {"id": "b", "start": words["Podcast"]["start"], "end": words["ya"]["end"]},
    ], transitions=[{"after": "a", "kind": "fade", "secs": 0.4}, {"after": "still", "kind": "fade", "secs": 0.4}])
    planned = preview(client, job, candidate)["plan"]
    _, still, last = planned["segments"]
    assert (still["hold"], round(still["end"] - still["start"], 3)) == (2, 2)
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(last["end"], abs=0.1)
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    # Between the Transitions, the frame at 6 s throughout.
    shown = [luma(full_frame(settings, video, still["start"] + at)) for at in (0.5, 1.0, 1.5)]
    assert max(shown) - min(shown) < 2
    assert shown[0] == pytest.approx(25 * 6, abs=6)
    # And silent there, while the Segments either side are heard.
    levels = loudness_by_window(settings, video)
    into, out_of = planned["transitions"]
    held = levels[int(into["end"] * 10) + 1 : int(out_of["start"] * 10)]
    assert held.max() < levels.max() * 0.05
    assert levels[2:8].mean() > levels.max() * 0.3


def test_a_keyed_held_media_segment_zooms_over_its_still(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    item = upload(client, ramp_video.read_bytes(), "ramp.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    framing = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#0000FF"}}
    zoom = {"scale": [{"at": 0, "value": 0.5}, {"at": 2, "value": 1}]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "still", "start": 4, "end": 4, "hold": 2, "media": item["id"], "framing": framing, "keys": zoom},
        {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"]},
    ])
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def picture(at: float) -> tuple[float, float]:
        frame = full_frame(settings, video, at)
        grey = np.abs(frame - np.array([0, 0, 255])).max(axis=2) > 80
        return float(grey.mean()), float(frame[960, 540].mean())

    (early, middle_early), (late, middle_late) = picture(0.2), picture(1.8)
    # The still grows (about 4 times its area from 0.5 to 1) and stays the frame at 4 s.
    assert late > 2.5 * early
    assert middle_early == pytest.approx(middle_late, abs=3) and middle_early == pytest.approx(100, abs=8)


def test_a_held_source_segment_renders_the_face_where_its_track_scene_had_it(client, settings, video_source, moving_face):
    # The face glides right from 0.5 s to 5.5 s; the Freeze frame holds 3 s, halfway, which no
    # Segment plays through: its Track crop is found from a window around it, and keeps the face in.
    video_source.video = moving_face
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, layout="track", segments=[
        {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"]},
        {"id": "still", "start": 3, "end": 3, "hold": 1.5},
    ])
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    # Its analysis is of a short window around its frame.
    assert (job_dir / "analysis" / f"{round((3 - HELD_REACH_SECS) * 1000)}-{round((3 + HELD_REACH_SECS) * 1000)}.json").is_file()
    video = job_dir / clip["output"]["video"]
    first_end = round(words["kabar"]["end"] - words["halo"]["start"], 3)
    frames = [output_frame(settings, video, first_end + at) for at in (0.3, 0.8, 1.3)]
    background = np.array([0x4A, 0x55, 0x60])
    for frame in frames:
        middle = frame[30:70, 12:42]
        assert (np.abs(middle - background).max(axis=2) > 24).mean() > 0.9
    assert np.abs(frames[0] - frames[2]).mean() < 2
