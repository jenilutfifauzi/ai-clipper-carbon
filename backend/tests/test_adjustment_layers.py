"""Adjustment Layers on the Adjust Track (.scratch/color-adjust/issues/07-adjustment-layers.md,
docs/adr/0013).

Seam B on the planner and candidate_plan, then the model and the API, then Seam A through the API and
the real ffmpeg (a frame saved of a draft), on pictures of known colours, and through MCP.
"""

from dataclasses import asdict, replace

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Adjust, AdjustmentLayer, Candidate, Grade, manual_candidate
from app.config import CameraTuning
from app.planner import AdjustmentEvent, SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from test_media_library import upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_overlay_grades import SHOWN, colours, grey_half  # noqa: F401
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import SOURCE, WARM, frame_at

GREY = Grade(Adjust(saturation=-100))


# Seam B: the planner


def test_adjustment_events_carry_their_times_grade_strength_and_fades():
    layers = [
        AdjustmentLayer("a", 1.0, 2.0, GREY, strength=60, fade_in=0.5, fade_out=1.0),
        AdjustmentLayer("b", 0.0, 4.0, Grade(Adjust(temperature=9000))),
    ]
    planned = plan_render(10, 23, SOURCE, adjustment_layers=layers)
    assert planned.adjustments == [
        AdjustmentEvent("a", 1.0, 3.0, GREY, 60, 0.5, 1.0),
        AdjustmentEvent("b", 0.0, 4.0, Grade(Adjust(temperature=9000)), 100, 0.0, 0.0),
    ]
    assert plan_render(10, 23, SOURCE).adjustments == []


def test_an_adjustment_layer_past_the_clips_end_is_cut_there_and_one_wholly_past_it_is_dropped():
    layers = [
        AdjustmentLayer("cut", 4.0, 4.0, GREY, fade_in=2.0, fade_out=2.0),
        AdjustmentLayer("past", 5.0, 2.0, GREY),
        AdjustmentLayer("at_end", 5.0, 1.0, GREY),
    ]
    # Two Segments of 2 s and 3 s: the Clip lasts 5 s.
    planned = plan_render(10, 23, SOURCE, main_track=[SegmentInput(10, 12), SegmentInput(20, 23)], adjustment_layers=layers)
    [cut] = planned.adjustments
    # Cut at 5 s: 1 s long, its fades each held to half of what is left.
    assert (cut.id, cut.start, cut.end, cut.fade_in, cut.fade_out) == ("cut", 4.0, 5.0, 0.5, 0.5)


def test_a_candidates_adjustment_layers_come_to_its_plan(tmp_path):
    layer = AdjustmentLayer("a", 1.0, 2.0, GREY, strength=40)
    candidate = replace(manual_candidate("c1", 10, 26), adjustment_layers=[layer])
    planned = candidate_plan(candidate, SOURCE, None, [None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert planned.adjustments == [AdjustmentEvent("a", 1.0, 3.0, GREY, 40, 0.0, 0.0)]


# The model and the API


def test_fades_over_half_an_adjustment_layers_length_are_refused():
    AdjustmentLayer("a", 0, 2.0, fade_in=1.0, fade_out=1.0)
    for fades in ({"fade_in": 1.1}, {"fade_out": 1.5}):
        with pytest.raises(ValidationError, match="half its length"):
            TypeAdapter(AdjustmentLayer).validate_python({"id": "a", "start": 0, "secs": 2.0, **fades})
    with pytest.raises(ValidationError, match="strength"):
        TypeAdapter(AdjustmentLayer).validate_python({"id": "a", "start": 0, "secs": 2.0, "strength": 120})


def test_a_candidate_saved_before_adjustment_layers_reads_with_none():
    stored = asdict(manual_candidate("c1", 10, 26))
    del stored["adjustment_layers"]
    assert TypeAdapter(Candidate).validate_python(stored).adjustment_layers == []


def test_a_layers_imported_look_counts_as_a_use():
    candidate = replace(manual_candidate("c1", 10, 26), adjustment_layers=[AdjustmentLayer("a", 0, 1, Grade(look="cine-teal"))])
    assert candidate.looks() == {"cine-teal": ["Adjustment Layer a"]}


def test_adjustment_layers_are_saved_validated_and_planned(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    layer = {"id": "a", "start": 0.5, "secs": 1.0, "grade": {"adjust": {"saturation": -100}}, "strength": 50, "fade_in": 0.25}
    saved = patch(client, job, candidate, adjustment_layers=[layer])
    assert saved["adjustment_layers"] == [{
        "id": "a", "start": 0.5, "secs": 1.0, "grade": {"adjust": asdict(Adjust(saturation=-100)), "look": None, "intensity": 100},
        "strength": 50, "fade_in": 0.25, "fade_out": 0,
    }]
    assert saved["edited"] and saved["revision"] == candidate["revision"] + 1
    [event] = preview(client, job, saved)["plan"]["adjustments"]
    assert (event["start"], event["end"], event["strength"], event["fade_in"]) == (0.5, 1.5, 50, 0.25)
    for bad, named in [({"fade_out": 0.6}, "half its length"), ({"grade": {"look": "no-such-look"}}, "no-such-look")]:
        refused = client.patch(candidate_url(job, saved), json={"adjustment_layers": [layer | bad]})
        assert refused.status_code == 422 and named in refused.text, refused.text
    twice = client.patch(candidate_url(job, saved), json={"adjustment_layers": [layer, layer]})
    assert twice.status_code == 422, twice.text


# Seam A: the real ffmpeg


def _around(frame: np.ndarray) -> np.ndarray:
    """The Clip's picture above the Overlay."""
    return frame[300:500, 100:980].reshape(-1, 3).mean(axis=0)


def _plate(frame: np.ndarray) -> np.ndarray:
    """The Text Layer's plate, beside its words."""
    return frame[1480:1520, 285:330].reshape(-1, 3).mean(axis=0)


PLATED = {
    "id": "t", "text": "HALO", "start": 0, "secs": 3, "transform": {"x": 540, "y": 1500},
    "style": {"size": 60, "plate": {"shape": "block", "colour": "#3060C0", "opacity": 1, "padding_x": 200, "padding_y": 60}},
}


def test_an_adjustment_layer_grades_the_picture_and_overlays_in_its_span_but_not_a_text_layer(
    client, settings, video_source, plain_video, colours,
):
    video_source.video = plain_video
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    candidate = patch(client, job, candidate, overlays=[{"id": "o", "media": image["id"], **SHOWN}], text_layers=[PLATED])
    layer = {"id": "a", "start": 0.5, "secs": 1.0, "grade": WARM}
    plain, inside = (frame_at(client, settings, job, candidate, 1.0, **draft) for draft in ({}, {"adjustment_layers": [layer]}))
    # Inside its span: the Clip's picture and the Overlay's are warmer (red up, blue down).
    for area in (_around, grey_half):
        assert area(inside)[0] > area(plain)[0] + 6 and area(inside)[2] < area(plain)[2] - 6, (area, area(plain), area(inside))
    # The Text Layer's plate keeps its colour.
    assert np.abs(_plate(plain) - [0x30, 0x60, 0xC0]).max() < 12, _plate(plain)
    assert np.abs(_plate(inside) - _plate(plain)).max() < 3, (_plate(plain), _plate(inside))
    # Outside its span, nothing changes.
    before, after = (frame_at(client, settings, job, candidate, 2.0, **draft) for draft in ({}, {"adjustment_layers": [layer]}))
    assert np.abs(after.astype(float) - before).max() < 3


def test_at_strength_0_an_adjustment_layer_changes_nothing_and_mid_fade_it_is_between(client, settings, video_source, plain_video):
    video_source.video = plain_video
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    whole = {"id": "a", "start": 0.5, "secs": 2.0, "grade": {"adjust": {"exposure": 1.5}}}
    plain = frame_at(client, settings, job, candidate, 1.0)
    full = frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole])
    none = frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole | {"strength": 0}])
    assert np.abs(none.astype(float) - plain).max() < 2
    # 1.0 s is half way through its 1 s fade in: about half the change.
    fading = frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole | {"fade_in": 1.0}])
    # Strength 50 alike.
    halved = frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole | {"strength": 50}])
    level = lambda frame: _around(frame).mean()
    change = level(full) - level(plain)
    assert change > 30, (level(plain), level(full))
    for between in (fading, halved):
        assert 0.35 * change < level(between) - level(plain) < 0.65 * change, (level(plain), level(between), level(full))


def test_overlapping_adjustment_layers_apply_in_list_order(client, settings, video_source, plain_video):
    video_source.video = plain_video
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    grey = {"id": "g", "start": 0.0, "secs": 2.0, "grade": {"adjust": {"saturation": -100}}}
    warm = {"id": "w", "start": 0.0, "secs": 2.0, "grade": WARM}
    # Greyed then warmed: warm. Warmed then greyed: grey.
    warm_last = _around(frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[grey, warm]))
    grey_last = _around(frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[warm, grey]))
    assert warm_last[0] > warm_last[2] + 15, warm_last
    assert np.ptp(grey_last) < 6, grey_last


# MCP


@pytest.mark.anyio
async def test_adjustment_layers_are_added_merged_and_removed_by_id_and_the_dry_run_lists_them(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    layer = {"id": "a", "start": 0.2, "secs": 0.6, "grade": {"adjust": {"temperature": 8000}}}
    edited = await call(mcp, "edit_candidate", **ids, changes={"adjustment_layers": [layer]})
    assert [item["id"] for item in edited["adjustment_layers"]] == ["a"]
    merged = await call(mcp, "merge_candidate_items", **ids, adjustment_layers=[
        {"id": "a", "strength": 40, "grade": {"adjust": {"saturation": -50}}},
        {"id": "b", "start": 0.0, "secs": 0.4, "fade_in": 0.1},
    ])
    first, second = merged["adjustment_layers"]
    assert (first["strength"], first["start"], first["grade"]["adjust"]["temperature"], first["grade"]["adjust"]["saturation"]) == (40, 0.2, 8000, -50)
    assert (second["id"], second["fade_in"], second["strength"]) == ("b", 0.1, 100)
    assert "half its length" in await fails(mcp, "merge_candidate_items", **ids, adjustment_layers=[{"id": "b", "fade_out": 0.3}])

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["adjustment_layers"] == [
        {"id": "a", "start": 0.2, "end": 0.8, "strength": 40, "grade": {"adjust": {"temperature": 8000, "saturation": -50}}},
        {"id": "b", "start": 0.0, "end": 0.4, "fade_in": 0.1},
    ]

    removed = await call(mcp, "remove_candidate_items", **ids, kind="adjustment_layers", keys=["a"])
    assert [item["id"] for item in removed["adjustment_layers"]] == ["b"]
