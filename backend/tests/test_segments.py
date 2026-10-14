"""Segments: the Main Track cut, reordered and joined from pieces of the Source
(.scratch/advanced-edit/issues/05-segments-source.md, docs/adr/0002-segments-and-timeline-time.md).

Seam B on the planner and candidate_plan, then Seam A through the API and the real ffmpeg.
"""

import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.candidates import Candidate, Layout, LayoutOverride, Segment, WordEdit, manual_candidate
from app.config import CameraTuning, load_settings
from app.planner import Piece, SceneLayout, SegmentPlan, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.transcript import Word
from app.video_source import SourceMetadata
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def test_each_segment_is_framed_on_its_own_and_joined_back_to_back():
    planned = plan_render(
        10, 23, SOURCE,
        pieces=[
            Piece(10, 12, layout_overrides=[LayoutOverride(0.5, Layout.SPLIT)], words=[Word("satu", 1.5, 1.9)]),
            Piece(20, 23, words=[Word("dua", 0.05, 0.4)]),
        ],
    )
    assert planned.duration == 5
    assert planned.segments == [SegmentPlan(0, 2, 10, 12), SegmentPlan(2, 5, 20, 23)]
    assert [(scene.start, scene.end, scene.layout) for scene in planned.scenes] == [
        (0, 2, SceneLayout.SPLIT), (2, 5, SceneLayout.TRACK),
    ]
    # A crop's change points are in Clip time.
    assert planned.scenes[1].panels[0].path[0].at == 2
    # A caption line ends at the cut, and the next starts after it.
    [first, second] = planned.captions
    assert first.text == "SATU" and first.end <= 2 and second.text == "DUA" and second.start >= 2


def test_one_segment_plans_as_a_clip_did():
    before = plan_render(10, 12, SOURCE, words=[Word("satu", 0.5, 0.9)])
    assert before.segments == [] and before.duration == 2


def manual(**fields) -> Candidate:
    return replace(manual_candidate("c1", 10, 26), **fields)


def test_word_edits_and_layout_overrides_apply_in_every_segment_that_shows_them(tmp_path):
    candidate = manual(
        segments=[Segment("a", 10, 12), Segment("b", 20, 22), Segment("c", 10, 12)],
        word_edits=[WordEdit(11.0, "SATU!")],
        layout_overrides=[LayoutOverride(11.0, Layout.BLUR)],
    )
    words = [[Word("satu", 0.9, 1.2)], [Word("dua", 0.9, 1.2)], [Word("satu", 0.9, 1.2)]]
    planned = candidate_plan(candidate, SOURCE, words, [None, None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [event.text for event in planned.captions] == ["SATU!", "DUA", "SATU!"]
    assert [scene.layout for scene in planned.scenes] == [SceneLayout.BLUR, SceneLayout.TRACK, SceneLayout.BLUR]
    assert [(segment.start, segment.source_start) for segment in planned.segments] == [(0, 10), (2, 20), (4, 10)]


@pytest.fixture(scope="session")
def ramp_video(tmp_path_factory) -> Path:
    """8 s of a picture that brightens with time (its luma 25 a second), with a tone."""
    path = tmp_path_factory.mktemp("ramp") / "ramp.mp4"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=black:size=640x360:rate=25:duration=8,format=yuv420p,geq=lum='min(250,T*25)':cb=128:cr=128",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


def ranges(job: dict, *spans: tuple[str, str]) -> list[dict]:
    words = {word["text"]: word for word in job["transcript"]["words"]}
    return [{"id": f"s{i}", "start": words[a]["start"], "end": words[b]["end"]} for i, (a, b) in enumerate(spans)]


def test_segments_are_saved_snapped_and_validated(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"))
    saved = patch(client, job, candidate, segments=pieces)
    assert [segment["id"] for segment in saved["segments"]] == ["s0", "s1"]
    assert saved["edited"]
    # The hull of what it shows, for the Candidate list and Selection.
    assert saved["start"] == saved["segments"][1]["start"] and saved["end"] == saved["segments"][0]["end"]
    planned = preview(client, job, saved)["plan"]
    assert [segment["source_start"] for segment in planned["segments"]] == [s["start"] for s in saved["segments"]]

    # Its edges can't be moved as a whole while it is cut.
    refused = client.patch(candidate_url(job, saved), json={"start": saved["start"] + 0.1})
    assert refused.status_code == 422 and "Advanced Edit" in refused.json()["detail"]
    for bad in ([], [pieces[0], pieces[0]], [pieces[0] | {"start": 7.9, "end": 8.0}]):
        assert client.patch(candidate_url(job, saved), json={"segments": bad}).status_code == 422, bad

    # Back to one Segment: a plain range again.
    single = patch(client, job, saved, segments=[pieces[1]])
    assert single["segments"] == [] and (single["start"], single["end"]) == (saved["segments"][1]["start"], saved["segments"][1]["end"])


def luma(frame: np.ndarray) -> float:
    """The mean brightness of the middle of the frame, where Blur shows the shot."""
    return float(frame[900:1020, 400:680].mean())


def test_a_clip_of_three_segments_renders_them_in_order(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(client, job, candidate, layout="blur", segments=ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal")))
    planned = preview(client, job, candidate)["plan"]
    lengths = [segment["source_end"] - segment["source_start"] for segment in planned["segments"]]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(sum(lengths), abs=0.1)
    assert clip["output"]["segments"] == candidate["segments"]
    # The middle of each piece shows its own moment of the Source: the latest one ("Podcast")
    # brightest, then "kita", then "halo".
    video = job_dir / clip["output"]["video"]
    middles = [segment["start"] + (segment["end"] - segment["start"]) / 2 for segment in planned["segments"]]
    shown = [luma(full_frame(settings, video, at)) for at in middles]
    expected = [25 * (s["source_start"] + (s["source_end"] - s["source_start"]) / 2) for s in planned["segments"]]
    assert shown[0] > shown[2] > shown[1]
    assert np.corrcoef(shown, expected)[0, 1] > 0.99
