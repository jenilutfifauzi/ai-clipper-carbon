"""Transitions between Segments of the Main Track (.scratch/advanced-edit/issues/08-transitions.md).

Seam B on the planner, then Seam A through the API and the real ffmpeg.
"""

import numpy as np
import pytest

from app.candidates import TransitionKind
from app.planner import Join, SegmentInput, SegmentPlan, TransitionEvent, plan_render
from app.transitions import RECIPES, Recipe
from app.transcript import Word
from app.video_source import SourceMetadata
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch
from test_segments import luma, ramp_video, ranges  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def test_every_kind_has_a_recipe_and_the_first_ten_are_xfades_of_their_names():
    assert set(RECIPES) == set(TransitionKind)
    # Saved Candidates' kinds keep their look: xfade's own transition of the same name, nothing around it.
    for kind in ["fade", "fadeblack", "fadewhite", "slideleft", "slideright", "slideup", "slidedown", "wipeleft", "zoomin", "circleopen"]:
        assert RECIPES[TransitionKind(kind)] == Recipe(xfade=kind)


def test_a_transition_overlaps_the_segments_either_side_and_shortens_the_clip():
    planned = plan_render(
        10, 32, SOURCE,
        main_track=[
            SegmentInput(10, 12, words=[Word("satu", 1.5, 1.9)]),
            SegmentInput(20, 23, join=Join(TransitionKind.FADE, 0.5), words=[Word("dua", 0.1, 0.4)]),
            SegmentInput(30, 32),
        ],
    )
    assert planned.segments == [
        SegmentPlan(0, 2, 10, 12, scenes=1), SegmentPlan(1.5, 4.5, 20, 23, scenes=1), SegmentPlan(4.5, 6.5, 30, 32, scenes=1),
    ]
    assert planned.duration == 6.5
    assert planned.transitions == [TransitionEvent(TransitionKind.FADE, 1.5, 2.0)]
    # Each side's captions stop or start at the transition's middle.
    [first, second] = planned.captions
    assert first.text == "SATU" and first.end <= 1.75 and second.text == "DUA" and second.start >= 1.75


def test_a_transition_is_at_most_half_the_shorter_segment():
    planned = plan_render(10, 23, SOURCE, main_track=[SegmentInput(10, 11), SegmentInput(20, 23, join=Join(TransitionKind.SLIDELEFT, 1.5))])
    assert planned.transitions == [TransitionEvent(TransitionKind.SLIDELEFT, 0.5, 1.0)]
    assert planned.duration == 3.5


def test_transitions_are_saved_and_dropped_with_their_join(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "fade", "secs": 0.4}, {"after": "s1", "kind": "wipeleft"},
    ])
    assert [(t["after"], t["kind"], t["secs"]) for t in candidate["transitions"]] == [("s0", "fade", 0.4), ("s1", "wipeleft", 0.5)]
    assert [event["kind"] for event in preview(client, job, candidate)["plan"]["transitions"]] == ["fade", "wipeleft"]
    for bad in ([{"after": "s0", "kind": "spin"}], [{"after": "s0", "kind": "fade", "secs": 3.5}]):
        response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": bad})
        assert response.status_code == 422, bad
    # Deleting s1, and moving s0 to the end, leaves neither join.
    moved = patch(client, job, candidate, segments=[pieces[2], pieces[0]])
    assert moved["transitions"] == []


def test_a_crossfade_renders_shorter_with_both_pieces_mixed_in_its_middle(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(
        client, job, candidate, layout="blur",
        segments=ranges(job, ("Podcast", "ya"), ("halo", "semua")),
        transitions=[{"after": "s0", "kind": "fade", "secs": 0.6}],
    )
    planned = preview(client, job, candidate)["plan"]
    [bright, dark] = planned["segments"]
    [fade] = planned["transitions"]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(dark["end"], abs=0.1)
    assert clip["output"]["transitions"] == candidate["transitions"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    before = luma(full_frame(settings, video, fade["start"] - 0.2))
    middle = luma(full_frame(settings, video, (fade["start"] + fade["end"]) / 2))
    after = luma(full_frame(settings, video, fade["end"] + 0.2))
    assert before > middle > after
    assert np.isfinite(middle)


# .scratch/transitions-expanded/issues/02: xfade's 31 built-ins.


def test_a_three_second_transition_overlaps_long_segments_by_three_seconds():
    planned = plan_render(10, 40, SOURCE, main_track=[SegmentInput(10, 20), SegmentInput(30, 40, join=Join(TransitionKind.COVERLEFT, 3.0))])
    assert planned.transitions == [TransitionEvent(TransitionKind.COVERLEFT, 7.0, 10.0)]
    assert planned.duration == 17.0


def test_a_sample_of_the_new_built_ins_render_a_middle_unlike_either_side_in_a_shorter_clip(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    job = reviewed(client)
    kinds = ["coverleft", "pixelize", "radial", "rectcrop"]
    candidates = {}
    for kind in kinds:
        candidate = add(client, job, "halo", "ya")
        # The bright end of the ramp into a dimmer moment of it.
        candidates[kind] = patch(
            client, job, candidate, layout="blur",
            segments=ranges(job, ("Podcast", "ya"), ("kita", "soal")),
            transitions=[{"after": "s0", "kind": kind, "secs": 0.6}],
        )
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=120)["clips"]}
    for kind, candidate in candidates.items():
        planned = preview(client, job, candidate)["plan"]
        [event] = planned["transitions"]
        assert event["kind"] == kind
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        # The two Segments overlap by the Transition's length.
        assert clip["output"]["duration"] == pytest.approx(planned["segments"][1]["end"], abs=0.1)
        assert event["end"] - event["start"] == pytest.approx(0.6)
        video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
        before = luma(full_frame(settings, video, event["start"] - 0.2))
        middle = luma(full_frame(settings, video, (event["start"] + event["end"]) / 2))
        after = luma(full_frame(settings, video, event["end"] + 0.2))
        assert abs(middle - before) > 8 and abs(middle - after) > 8, (kind, before, middle, after)


def test_a_transition_lasts_from_a_tenth_of_a_second_to_three(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "dissolve", "secs": 0.1}, {"after": "s1", "kind": "hlslice", "secs": 3.0},
    ])
    assert [(t["kind"], t["secs"]) for t in candidate["transitions"]] == [("dissolve", 0.1), ("hlslice", 3.0)]
    # Still half the shorter Segment at most.
    [first, second] = preview(client, job, candidate)["plan"]["transitions"]
    assert first["end"] - first["start"] == pytest.approx(0.1)
    shorter = min(piece["end"] - piece["start"] for piece in candidate["segments"][1:])
    assert second["end"] - second["start"] == pytest.approx(shorter / 2, abs=0.01)
    for secs, message in ((0.05, "greater than or equal to 0.1"), (3.5, "less than or equal to 3")):
        response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": [{"after": "s0", "secs": secs}]})
        assert response.status_code == 422, secs
        [error] = response.json()["detail"]
        assert error["loc"][-1] == "secs" and message in error["msg"], error
