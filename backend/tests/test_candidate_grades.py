"""The Candidate's Grade (.scratch/color-adjust/issues/04-candidate-grade.md, docs/adr/0013).

Seam B on the planner and candidate_plan, then the model and the API, then Seam A through the API and
the real ffmpeg (a frame saved of a draft), on pictures of known colours, and through MCP.
"""

from dataclasses import asdict, replace

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Adjust, Candidate, Grade, Segment, manual_candidate
from app.canvas import PORTRAIT
from app.config import CameraTuning
from app.planner import SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from test_media_library import upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_overlay_grades import SHOWN, colours, grey_half  # noqa: F401
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch
from test_segment_grades import GREY, SOURCE, WARM, colour_video, frame_at, graded, grey_patch, red_patch  # noqa: F401


# Seam B: the planner


def test_the_plan_carries_the_candidates_grade_as_given():
    warm = Grade(Adjust(temperature=9000, contrast=20))
    assert plan_render(10, 23, SOURCE, grade=warm, canvas=PORTRAIT).grade == warm
    assert plan_render(10, 23, SOURCE, main_track=[SegmentInput(10, 12), SegmentInput(20, 23)], grade=warm, canvas=PORTRAIT).grade == warm
    assert plan_render(10, 23, SOURCE, canvas=PORTRAIT).grade == Grade()


def test_a_candidates_grade_comes_to_its_plan_with_segments_or_without(tmp_path):
    grey = Grade(Adjust(saturation=-100))
    presets = PresetStore(tmp_path / "presets.json")
    lone = replace(manual_candidate("c1", 10, 26), grade=grey)
    assert candidate_plan(lone, SOURCE, None, [None], presets, CameraTuning()).grade == grey
    cut = replace(lone, segments=[Segment("a", 10, 12), Segment("b", 20, 22)])
    assert candidate_plan(cut, SOURCE, None, [None, None], presets, CameraTuning()).grade == grey


def test_a_candidate_saved_before_its_grade_reads_with_a_neutral_one():
    stored = asdict(manual_candidate("c1", 10, 26))
    del stored["grade"]
    assert TypeAdapter(Candidate).validate_python(stored).grade == Grade()


def test_the_candidates_grade_is_saved_validated_and_planned(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    saved = patch(client, job, candidate, grade=WARM)
    assert saved["grade"] == {"adjust": asdict(Adjust(temperature=9500)), "look": None, "intensity": 100}
    # Its range stays a plain range: the Grade is the Candidate's, not a Segment's.
    assert saved["segments"] == []
    assert preview(client, job, saved)["plan"]["grade"]["adjust"]["temperature"] == 9500
    # Another edit keeps it.
    assert patch(client, job, saved, hook_text="Coba")["grade"]["adjust"]["temperature"] == 9500
    refused = client.patch(f"/api/jobs/{job['id']}/candidates/{saved['id']}", json={"grade": {"adjust": {"exposure": 4}}})
    assert refused.status_code == 422 and "exposure" in refused.text, refused.text


# Seam A: the real ffmpeg


def test_the_candidates_grade_is_stacked_on_a_segments_own(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), GREY)
    greyed = red_patch(frame_at(client, settings, job, candidate, 0.5))
    assert np.ptp(greyed) < 8, greyed
    # Warmed over the Segment's grey: the red patch, greyed first, is then warm (red over blue). Were the
    # Candidate's Grade drawn first, the Segment's would grey it again.
    warmed = red_patch(frame_at(client, settings, job, candidate, 0.5, grade=WARM))
    assert warmed[0] > warmed[2] + 15, (greyed, warmed)
    # And the other Segment, of no Grade of its own, is warmed too.
    planned = preview(client, job, candidate)["plan"]
    second = (planned["segments"][1]["start"] + planned["segments"][1]["end"]) / 2
    plain, warm = (grey_patch(frame_at(client, settings, job, candidate, second, **draft)) for draft in ({}, {"grade": WARM}))
    assert warm[0] > plain[0] + 8 and warm[2] < plain[2] - 8, (plain, warm)


def test_a_clip_of_one_range_is_graded_but_its_overlays_are_not(client, settings, video_source, plain_video, colours):
    video_source.video = plain_video
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), overlays=[{"id": "o", "media": image["id"], **SHOWN}])
    assert candidate["segments"] == []
    plain = frame_at(client, settings, job, candidate, 1.0)
    warm = frame_at(client, settings, job, candidate, 1.0, grade=WARM)
    # The Clip's picture around the Overlay is warmer: red up, blue down.
    around = lambda frame: frame[300:500, 100:980].reshape(-1, 3).mean(axis=0)
    assert around(warm)[0] > around(plain)[0] + 6 and around(warm)[2] < around(plain)[2] - 6, (around(plain), around(warm))
    # The Overlay's picture is as it was.
    assert np.abs(grey_half(warm) - grey_half(plain)).max() < 3, (grey_half(plain), grey_half(warm))


# MCP


@pytest.mark.anyio
async def test_merge_sets_one_dial_of_the_candidates_grade_and_the_dry_run_lists_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    edited = await call(mcp, "edit_candidate", **ids, changes={"grade": {"adjust": {"temperature": 7500, "contrast": 20}}})
    assert edited["grade"]["adjust"]["temperature"] == 7500
    merged = await call(mcp, "merge_candidate_items", **ids, grade={"adjust": {"exposure": 0.5}})
    adjust = merged["grade"]["adjust"]
    assert (adjust["temperature"], adjust["contrast"], adjust["exposure"], adjust["saturation"]) == (7500, 20, 0.5, 0)
    assert "temperature" in await fails(mcp, "merge_candidate_items", **ids, grade={"adjust": {"temperature": 100}})

    # The dry run gives the Candidate's Grade by the dials that aren't neutral.
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["grade"] == {"adjust": {"temperature": 7500, "exposure": 0.5, "contrast": 20}}
    neutral = await call(mcp, "edit_candidate", **ids, changes={"grade": {}}, dry_run=True)
    assert "grade" not in neutral
