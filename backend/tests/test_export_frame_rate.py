"""The export frame rate (.scratch/export-settings/issues/03-export-frame-rate.md, docs/adr/0021): a
Clip planned and encoded at the Export Settings' frame rate, or the Source's for Same as Source, with
everything that lands on frames on the output's; the Preview Plan always at the Source's rate.

Seam B on the planner, then Seam A with the real ffmpeg, rendering Render Plans with the Renderer
(the render worker passes the default settings until Export Presets choose others).
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Framing, Keyframe, KeyProperty, Shape, TransitionKind
from app.config import RenderTuning
from app.encoding import ExportSettings
from app.layer_pictures import make_pictures
from app.pictures import cover_scale
from app.canvas import PORTRAIT as NINE_SIXTEEN
from app.planner import Join, SegmentInput, TransitionEvent, plan_render
from app.renderer import Renderer
from app.video_source import SourceMetadata
from test_export_settings import picture
from test_keyed_scenes import by_hand
from test_media_library import make
from test_render import add, pixels, preview, reviewed
from test_render import from_render_video, render_video  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=25.0, width=1920, height=1080, codec="h264")

# Seam B: the planner


def test_a_plan_at_a_given_rate_carries_it_and_checks_a_keyed_manual_scene_at_its_frames():
    # A Manual Scene's picture covers the frame at every one of the 25 fps Source's frames (0.04 s
    # apart), but dips under cover at 0.1 s, between two of them: a frame of a 60 fps Clip.
    cover = cover_scale(1920, 1080, NINE_SIXTEEN.size)
    dip = {KeyProperty.SCALE: [Keyframe(0, cover + 0.1), Keyframe(0.1, cover - 0.01), Keyframe(0.2, cover + 0.1)]}
    overrides = [by_hand(1, dip, Framing())]
    at_source = plan_render(100, 103, SOURCE, layout_overrides=overrides)
    at_60 = plan_render(100, 103, SOURCE, layout_overrides=overrides, fps=60)
    assert (at_source.fps, at_source.source_fps) == (25, 25)
    assert (at_60.fps, at_60.source_fps) == (60, 25)
    [scene], [sixty] = at_source.scenes, at_60.scenes
    # Covered at every 25 fps frame, so no Background; at 60 fps the dip shows, so it is kept.
    assert (scene.panels, scene.colour) == ([], None)
    assert sixty.panels and sixty.picture.motion == scene.picture.motion


def test_a_plan_at_another_rate_holds_freeze_frames_and_transitions_for_whole_frames_of_it():
    # A Transition of 0.33 s, then a Freeze frame of 0.33 s: 8.25 of the Source's frames, 19.8 of 60 fps.
    track = [
        SegmentInput(10, 12),
        SegmentInput(20, 22, join=Join(TransitionKind.FADE, 0.33)),
        SegmentInput(22, 22, hold=0.33),
    ]
    at_60 = plan_render(10, 22, SOURCE, main_track=track, fps=60)
    # 20 frames of 60 fps each.
    assert at_60.transitions == [TransitionEvent(TransitionKind.FADE, 1.667, 2.0)]
    assert [(s.start, s.end, s.hold) for s in at_60.segments] == [(0, 2, None), (1.667, 3.667, None), (3.667, 4.0, 0.333)]
    assert at_60.duration == 4.0
    # At the Source's rate (the Preview Plan's), as the Candidate says: its frames joined as they come.
    at_source = plan_render(10, 22, SOURCE, main_track=track)
    assert at_source.fps == 25
    assert at_source.transitions == [TransitionEvent(TransitionKind.FADE, 1.67, 2.0)]
    assert [(s.start, s.end, s.hold) for s in at_source.segments] == [(0, 2, None), (1.67, 3.67, None), (3.67, 4.0, 0.33)]
    assert plan_render(10, 22, SOURCE, main_track=track, fps=25) == at_source


# Seam A: the real ffmpeg

PORTRAIT_SECS = 3


@pytest.fixture(scope="session")
def portrait_video(tmp_path_factory) -> Path:
    """3 s of a grey 1080x1920 picture at 30 fps with a tone: the Clip is its frames as they are."""
    path = tmp_path_factory.mktemp("portrait") / "portrait.mp4"
    make(
        path, "-f", "lavfi", "-i", f"color=c=0x4a5560:size=1080x1920:rate=30:duration={PORTRAIT_SECS}",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", str(PORTRAIT_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


PORTRAIT = SourceMetadata(PORTRAIT_SECS, 30.0, 1080, 1920, "h264")


def encode(settings, source: Path, tmp_path: Path, fps: float | None, **planned) -> Path:
    """Render 2 s of `source` (PORTRAIT) planned and encoded at `fps` (None: Same as Source)."""
    plan = plan_render(0.5, 2.5, PORTRAIT, fps=fps, **planned)
    video = tmp_path / "clip.mp4"
    pictures = make_pictures(settings.ffmpeg_bin, (event.layout for event in plan.picture_layers), tmp_path / "pictures")
    Renderer(settings.ffmpeg_bin, RenderTuning()).render(
        source, plan, video, tmp_path / "clip.jpg", pictures=pictures, export=ExportSettings(fps=fps)
    )
    return video


@pytest.mark.parametrize(("fps", "rate"), [(60, "60/1"), (None, "30/1"), (23.976, "24000/1001"), (29.97, "30000/1001")])
def test_a_clip_is_encoded_at_the_export_frame_rate_or_the_sources(settings, portrait_video, tmp_path, fps, rate):
    stream = picture(settings, encode(settings, portrait_video, tmp_path, fps))
    assert stream["r_frame_rate"] == rate
    num, den = map(int, rate.split("/"))
    # The Clip's 2 s, in whole frames of its rate.
    assert int(stream["nb_frames"]) == pytest.approx(2 * num / den, abs=1)
    assert float(stream["duration"]) == pytest.approx(2, abs=0.05)


@pytest.mark.parametrize("join", [Join(TransitionKind.FADE, 0.33), None])
def test_freeze_frames_and_cuts_at_60_fps_keep_the_clips_length(settings, portrait_video, tmp_path, join):
    track = [
        SegmentInput(0.2, 1.2),
        SegmentInput(1.5, 2.5, join=join),
        SegmentInput(2.5, 2.5, hold=0.33),
    ]
    plan = plan_render(0.2, 2.5, PORTRAIT, main_track=track, fps=60)
    video = tmp_path / "clip.mp4"
    Renderer(settings.ffmpeg_bin, RenderTuning()).render(portrait_video, plan, video, tmp_path / "clip.jpg", export=ExportSettings(fps=60))
    stream = picture(settings, video)
    assert stream["r_frame_rate"] == "60/1"
    # 1 + 1 (- 0.333) + 0.333 s, in frames of 60 fps.
    assert int(stream["nb_frames"]) == pytest.approx(round(plan.duration * 60), abs=1)


GREEN = np.array([0, 255, 0])
_SHAPE = TypeAdapter(Shape)


def nth_frame(settings, video: Path, n: int) -> np.ndarray:
    """The Clip's frame number `n`, 1080x1920 RGB."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", f"select=eq(n\\,{n})", "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(1920, 1080, 3).astype(int)


def test_a_keyed_shape_at_60_fps_is_at_its_keyed_place_between_two_of_the_sources_frames(settings, portrait_video, tmp_path):
    # A green bar sliding from x 200 to 880 in 1 s, from the Clip's start: 680 px a second.
    slid = _SHAPE.validate_python({
        "id": "slid", "start": 0.0, "secs": 2.0, "transform": {"y": 300}, "style": {"width": 100, "height": 120, "fill": "#00FF00"},
        "keys": {"x": [{"at": 0, "value": 200}, {"at": 1, "value": 880}]},
    })
    video = encode(settings, portrait_video, tmp_path, 60, shapes=[slid])
    # Frame 31 is at 0.517 s, half way between the Source's frames at 0.5 and 0.533 s.
    for n in (30, 31, 45):
        _, columns = pixels(nth_frame(settings, video, n)[200:400], GREEN)
        assert abs(columns.mean() - (200 + 680 * n / 60)) <= 2, (n, columns.mean())


def test_the_preview_plan_stays_at_the_sources_rate(client):
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    plan = preview(client, job, candidate)["plan"]
    assert plan["fps"] == plan["source_fps"] == 25


def test_the_preview_plan_has_its_canvas_and_safe_area(client):
    job = reviewed(client)
    plan = preview(client, job, add(client, job, "Podcast", "ya"))["plan"]
    assert (plan["width"], plan["height"]) == (1080, 1920)
    assert plan["safe_area"] == {"x": 0, "y": 232, "width": 950, "height": 1304}
