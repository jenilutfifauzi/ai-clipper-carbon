"""Media Segments: uploaded videos on the Main Track, as an intro, an outro or a full-screen B-roll
(.scratch/advanced-edit/issues/06-media-segments.md).

Seam B on the planner and candidate_plan, then Seam A through the API and the real ffmpeg.
"""

from dataclasses import replace
from datetime import UTC, datetime

import numpy as np
import pytest

from app.candidates import Fit, Segment, manual_candidate
from app.config import CameraTuning
from app.media import MediaItem, MediaKind
from app.planner import OUTPUT_HEIGHT, OUTPUT_WIDTH, SegmentInput, SceneLayout, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.transcript import Word
from app.video_source import SourceMetadata
from test_media_library import make, upload
from test_music import loudness_by_window
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segments import ramp_video  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
INTRO = "ab" * 16


def test_a_media_segment_is_filled_or_fitted_over_a_blur_and_has_no_captions(tmp_path):
    planned = plan_render(
        10, 12, SOURCE,
        main_track=[SegmentInput(0, 2, media=INTRO, width=720, height=1280, fit=Fit.FILL), SegmentInput(10, 12), SegmentInput(0, 1, media=INTRO, width=1280, height=720)],
    )
    [intro, episode, outro] = planned.scenes
    assert [segment.media for segment in planned.segments] == [INTRO, None, INTRO]
    # Filled: one panel the size of the frame, cropped 9:16 from the video.
    assert intro.layout is SceneLayout.FILL
    [panel] = intro.panels
    assert (panel.area.width, panel.area.height) == (OUTPUT_WIDTH, OUTPUT_HEIGHT)
    assert panel.crop_width / panel.crop_height == pytest.approx(9 / 16, abs=0.01)
    # Fitted (the default): the whole video over a blurred copy filling the frame.
    assert outro.layout is SceneLayout.BLUR and [p.blur for p in outro.panels] == [True, False]
    assert outro.panels[1].area.width == OUTPUT_WIDTH and (outro.panels[1].crop_width, outro.panels[1].crop_height) == (1280, 720)

    # Captions come from the Source's Segments only.
    candidate = replace(
        manual_candidate("c1", 10, 12),
        segments=[Segment("i", 0, 2, media=INTRO), Segment("e", 10, 12)],
    )
    words = [[], [Word("halo", 0.5, 0.9)]]
    planned = candidate_plan(
        candidate, SOURCE, words, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Library(),
    )
    assert [(event.text, event.start) for event in planned.captions] == [("HALO", 2.5)]


class Library:
    """A Media Library holding a 5 s 720x1280 video, INTRO."""

    def find(self, media_id: str) -> MediaItem | None:
        return MediaItem(INTRO, MediaKind.VIDEO, "intro", 1, 5.0, 720, 1280, True, datetime.now(UTC)) if media_id == INTRO else None


@pytest.fixture(scope="session")
def clips(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s red 640x360 video with a 1 kHz tone, a test pattern without sound, and a still."""
    folder = tmp_path_factory.mktemp("broll")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "red": make(folder / "red.mp4", *lavfi, "color=c=red:size=640x360:rate=30:duration=2", *lavfi,
                    "sine=frequency=1000:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "silent": make(folder / "silent.mp4", *lavfi, "testsrc2=size=640x360:rate=30:duration=2", "-c:v", "libx264"),
        "still": make(folder / "still.png", *lavfi, "color=c=red:size=8x8", "-frames:v", "1"),
    }


def test_media_segments_are_validated(client, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    still = upload(client, clips["still"], "still.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    intro = {"id": "i", "start": 0, "end": 1.5, "media": red["id"], "fit": "fill"}
    saved = patch(client, job, candidate, segments=[intro, episode])
    assert saved["segments"][0] == intro | {"volume": 1.0}
    assert (saved["start"], saved["end"]) == (saved["segments"][1]["start"], saved["segments"][1]["end"])
    for bad in (
        [intro | {"media": still["id"]}, episode],
        [intro | {"media": "cd" * 16}, episode],
        [intro | {"end": 2.5}, episode],
        [intro],
    ):
        assert client.patch(candidate_url(job, saved), json={"segments": bad}).status_code == 422, bad
    assert client.delete(f"/api/media/{red['id']}").status_code == 409


def test_an_intro_and_an_outro_render_around_the_episode(client, settings, video_source, ramp_video, clips):
    video_source.video = ramp_video
    red, silent = (upload(client, clips[name], f"{name}.mp4").json() for name in ("red", "silent"))
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "i", "start": 0.5, "end": 1.5, "media": red["id"], "fit": "fill"},
        {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
        {"id": "o", "start": 0, "end": 1, "media": silent["id"]},
    ])
    planned = preview(client, job, candidate)["plan"]
    [intro, episode, outro] = planned["segments"]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(outro["end"], abs=0.1)
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def red_share(at: float) -> float:
        frame = full_frame(settings, video, at)
        return float((np.abs(frame - np.array([255, 0, 0])).max(axis=2) < 60).mean())

    # The intro fills the frame; the episode in between is the ramp; the outro is fitted, sharp in
    # the middle of the frame, over its blur.
    assert red_share(0.5) > 0.95
    assert red_share((episode["start"] + episode["end"]) / 2) < 0.05
    frame = full_frame(settings, video, (outro["start"] + outro["end"]) / 2)
    sharp = np.abs(np.diff(frame[760:1160].mean(axis=2), axis=1)).mean()
    blurred = np.abs(np.diff(frame[100:500].mean(axis=2), axis=1)).mean()
    assert sharp > 4 * blurred
    # The intro's tone is heard; the silent outro is silent.
    levels = loudness_by_window(settings, video)
    assert levels[2:8].mean() > levels.max() * 0.3
    assert levels[int(outro["start"] * 10) + 2 : int(outro["end"] * 10) - 1].max() < levels.max() * 0.05

