"""A Segment's Grade with the Adjust dials (.scratch/color-adjust/issues/01-segment-grade-adjust-dials.md,
docs/adr/0013).

Seam B on the planner and candidate_plan, then the model and the API, then Seam A through the API and
the real ffmpeg, on a Source of known colours, and through MCP. The fold itself is pinned in test_grade_fold.py.
"""

import subprocess
import time
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Adjust, Candidate, Grade, Segment, manual_candidate
from app.canvas import PORTRAIT
from app.config import CameraTuning, load_settings
from app.planner import SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.video_source import SourceMetadata
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_review import candidate_url, patch
from test_save_frame import pixels_of, saved_frame
from test_segments import ranges

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
WARM = {"adjust": {"temperature": 9500}}
GREY = {"adjust": {"saturation": -100}}


def test_segment_plans_carry_their_grade_as_given():
    warm = Grade(Adjust(temperature=9000, exposure=0.5))
    planned = plan_render(10, 23, SOURCE, main_track=[SegmentInput(10, 12, grade=warm), SegmentInput(20, 23)], canvas=PORTRAIT)
    assert [segment.grade for segment in planned.segments] == [warm, Grade()]


def test_a_candidates_segments_bring_their_grades_to_the_plan(tmp_path):
    grey = Grade(Adjust(saturation=-100))
    candidate = replace(manual_candidate("c1", 10, 26), segments=[Segment("a", 10, 12, grade=grey), Segment("b", 20, 22)])
    planned = candidate_plan(candidate, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [segment.grade for segment in planned.segments] == [grey, Grade()]


def test_a_candidate_saved_before_grades_reads_with_neutral_ones():
    stored = asdict(replace(manual_candidate("c1", 10, 26), segments=[Segment("a", 10, 12), Segment("b", 20, 22)]))
    for segment in stored["segments"]:
        del segment["grade"]
    candidate = TypeAdapter(Candidate).validate_python(stored)
    assert [segment.grade for segment in candidate.segments] == [Grade(), Grade()]
    assert all(segment.grade.neutral for segment in candidate.segments)


def test_a_grade_is_saved_validated_and_keeps_a_lone_segment(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    saved = patch(client, job, candidate, segments=[pieces[0] | {"grade": WARM}, pieces[1]])
    assert saved["segments"][0]["grade"] == {"adjust": asdict(Adjust(temperature=9500)), "look": None, "intensity": 100}
    assert saved["segments"][1]["grade"]["adjust"] == asdict(Adjust())
    planned = preview(client, job, saved)["plan"]
    assert planned["segments"][0]["grade"]["adjust"]["temperature"] == 9500

    # An out-of-range dial is refused, naming it.
    for dial, value in [("temperature", 12000), ("exposure", -4), ("contrast", 150), ("fade", -5)]:
        refused = client.patch(candidate_url(job, saved), json={"segments": [pieces[0] | {"grade": {"adjust": {dial: value}}}]})
        assert refused.status_code == 422 and dial in str(refused.json()["detail"]), (dial, refused.text)

    # One graded Segment of the Source as filmed is kept as its Segment, not made a plain range.
    lone = patch(client, job, saved, segments=[pieces[0] | {"grade": WARM}])
    assert len(lone["segments"]) == 1 and lone["segments"][0]["grade"]["adjust"]["temperature"] == 9500


@pytest.fixture(scope="session")
def colour_video(tmp_path_factory) -> Path:
    """8 s of a picture of known colours: its left half grey (128), its right half red, with a tone."""
    path = tmp_path_factory.mktemp("colours") / "colours.mp4"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x808080:size=640x360:rate=25:duration=8,drawbox=x=320:y=0:w=320:h=360:color=0xD02020:t=fill",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


# Where Blur shows the shot's grey and red halves on the frame (the shot fitted across it, about
# y 656..1264), away from their edge, the captions and the hook.
def grey_patch(frame: np.ndarray) -> np.ndarray:
    return frame[700:800, 120:420].reshape(-1, 3).mean(axis=0)


def red_patch(frame: np.ndarray) -> np.ndarray:
    return frame[700:800, 660:960].reshape(-1, 3).mean(axis=0)


def graded(client, job: dict, candidate: dict, grade: dict | None) -> dict:
    """`candidate` cut into its two Segments, the first of them graded by `grade` (none: never graded)."""
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    return patch(client, job, candidate, layout="blur", segments=[first | ({} if grade is None else {"grade": grade}), second])


def frame_at(client, settings, job: dict, candidate: dict, at: float, **draft) -> np.ndarray:
    """The frame the render draws at `at` (Timeline time), of `candidate` with the `draft` changes."""
    return pixels_of(settings, Path(saved_frame(client, job, candidate, at=at, **({"draft": draft} if draft else {}))["path"]))


def test_the_dials_change_a_segments_colours_as_they_say(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), None)
    segments = candidate["segments"]
    plain = frame_at(client, settings, job, candidate, 0.5)
    grey = grey_patch(plain)
    assert abs(grey - 128).max() < 12, grey

    def regraded(grade: dict) -> np.ndarray:
        return frame_at(client, settings, job, candidate, 0.5, segments=[segments[0] | {"grade": grade}, segments[1]])

    # Through RGB and back, a barely graded picture keeps its levels (its colour range included).
    barely = grey_patch(regraded({"adjust": {"temperature": 6550, "exposure": 0.01}}))
    assert abs(barely - grey).max() < 3, (grey, barely)
    # Warmer: the grey patch's red up and its blue down.
    warm = grey_patch(regraded(WARM))
    assert warm[0] > grey[0] + 8 and warm[2] < grey[2] - 8, (grey, warm)
    # Exposure brightens it.
    bright = grey_patch(regraded({"adjust": {"exposure": 1}}))
    assert (bright > grey + 30).all(), (grey, bright)
    # Saturation −100 turns the red patch grey.
    red, greyed = red_patch(plain), red_patch(regraded(GREY))
    assert red[0] - red[1] > 100, red
    assert np.ptp(greyed) < 8, greyed


@pytest.fixture(scope="session")
def edge_video(tmp_path_factory) -> Path:
    """8 s of a picture with one edge of light: its left half dark grey (80), its right half light (176)."""
    path = tmp_path_factory.mktemp("edge") / "edge.mp4"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x505050:size=640x360:rate=25:duration=8,drawbox=x=320:y=0:w=320:h=360:color=0xB0B0B0:t=fill",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


def test_sharpen_raises_an_edges_contrast_and_vignette_darkens_the_corners_more_than_the_centre(client, settings, video_source, edge_video):
    # .scratch/color-adjust/issues/02-sharpen-and-vignette.md
    video_source.video = edge_video
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), None)
    segments = candidate["segments"]

    def drawn(grade: dict | None) -> np.ndarray:
        if grade is None:
            return frame_at(client, settings, job, candidate, 0.5).astype(float)
        return frame_at(client, settings, job, candidate, 0.5, segments=[segments[0] | {"grade": grade}, segments[1]]).astype(float)

    plain, sharp, dark = drawn(None), drawn({"adjust": {"sharpen": 100}}), drawn({"adjust": {"vignette": 60}})
    # Across the edge between the dark and the light halves (about x 540): sharpened, the dark side
    # dips and the light side overshoots, so the span of the levels there widens.
    def edge_span(frame: np.ndarray) -> float:
        across = frame[700:800, 500:580].mean(axis=(0, 2))
        return float(across.max() - across.min())

    assert edge_span(sharp) > edge_span(plain) + 8, (edge_span(plain), edge_span(sharp))
    # Away from the edge, a flat patch stays as it was.
    assert abs(grey_patch(sharp) - grey_patch(plain)).max() < 4, (grey_patch(plain), grey_patch(sharp))

    # Vignette: a corner keeps a smaller share of its light than the centre.
    def corner(frame: np.ndarray) -> np.ndarray:
        return frame[0:60, 0:60].reshape(-1, 3).mean(axis=0)

    def centre(frame: np.ndarray) -> np.ndarray:
        return frame[930:990, 300:420].reshape(-1, 3).mean(axis=0)

    assert corner(plain).sum() > 30, corner(plain)
    kept_corner = corner(dark).sum() / corner(plain).sum()
    kept_centre = centre(dark).sum() / centre(plain).sum()
    assert kept_corner < 0.6 and kept_corner < kept_centre - 0.2, (kept_corner, kept_centre)


def test_a_neutral_grade_draws_the_same_pixels_as_none(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), None)
    neutral = graded(client, job, candidate, {"adjust": {"temperature": 6500, "saturation": 0}, "intensity": 50})
    assert np.array_equal(frame_at(client, settings, job, candidate, 0.5), frame_at(client, settings, job, neutral, 0.5))


def test_a_segments_grade_changes_only_its_frames_and_costs_little(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    job_dir = settings.data_dir / "jobs" / job["id"]

    def rendered_clip(candidate: dict) -> tuple[Path, float]:
        began = time.monotonic()
        render(client, job, [candidate["id"]])
        [clip] = [clip for clip in rendered(client, job, timeout=60)["clips"] if clip["candidate_id"] == candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        return job_dir / clip["output"]["video"], time.monotonic() - began

    plain = graded(client, job, add(client, job, "halo", "ya"), None)
    plain_video, plain_secs = rendered_clip(plain)
    grey = graded(client, job, plain, GREY)
    grey_video, grey_secs = rendered_clip(grey)
    planned = preview(client, job, grey)["plan"]
    [first, second] = [(segment["start"] + segment["end"]) / 2 for segment in planned["segments"]]

    # The first Segment's red is greyed; the second's isn't.
    assert np.ptp(red_patch(full_frame(settings, grey_video, first))) < 8
    assert np.abs(red_patch(full_frame(settings, grey_video, second)) - red_patch(full_frame(settings, plain_video, second))).max() < 4
    # Grading adds a few filters, not a second render.
    assert grey_secs < plain_secs * 1.5 + 2, (plain_secs, grey_secs)


@pytest.mark.anyio
async def test_merge_sets_one_dial_of_a_segments_grade_keeping_the_others_and_the_dry_run_lists_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "merge_candidate_items", **ids, segments=[
        {"id": "a", "start": 1.0, "end": 1.6, "grade": {"adjust": {"temperature": 7500, "contrast": 20}}},
        {"id": "b", "start": 0.1, "end": 0.9},
    ])
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "grade": {"adjust": {"exposure": 0.5}}}])
    adjust = merged["segments"][0]["grade"]["adjust"]
    assert (adjust["temperature"], adjust["contrast"], adjust["exposure"], adjust["saturation"]) == (7500, 20, 0.5, 0)
    assert "temperature" in await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "grade": {"adjust": {"temperature": 100}}}])

    # The dry run gives each Segment's Grade by the dials that aren't neutral; none for an ungraded one.
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    graded, plain = plan["segments"]
    assert graded["grade"] == {"adjust": {"temperature": 7500, "exposure": 0.5, "contrast": 20}}
    assert "grade" not in plain
    # The instructions give the dials' ranges.
    assert "2000..11000" in mcp.instructions and "temperature" in mcp.instructions
