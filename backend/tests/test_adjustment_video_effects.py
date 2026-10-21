"""Video Effects on Adjustment Layers and on keyed pictures
(.scratch/video-effects/issues/03-effects-on-adjustment-layers-and-keyed-pictures.md, ADR 0014): an
Adjustment Layer's stack after its Grade, mixed back by its strength and fades, and a keyed
picture's stack in its frame process, before its sampled scale. Seam B on the planner, then Seam A
through the API, MCP and the real ffmpeg."""

from dataclasses import asdict, replace

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import AdjustmentLayer, Candidate, Grade, manual_candidate
from app.config import CameraTuning
from app.planner import AdjustmentEvent, plan_render
from app.rendering import candidate_plan
from app.scaled_plan import scaled_plan
from app.styles import PresetStore
from app.video_effects import VideoEffect
from test_adjustment_layers import PLATED
from test_media_library import upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_overlay_grades import HELD, SHOWN, colours  # noqa: F401
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import SOURCE, colour_video, frame_at  # noqa: F401
from test_segment_video_effects import edge_step
from test_video_effects import edge_width, redness

BLUR = VideoEffect("gaussian-blur", {"radius": 6})
OFF = VideoEffect("gaussian-blur", {"radius": 6}, enabled=False)


# Seam B: the planner


def test_an_adjustment_layers_enabled_effects_reach_its_event_at_the_frames_own_size():
    layers = [AdjustmentLayer("a", 1.0, 2.0, video_effects=[BLUR]), AdjustmentLayer("b", 0.0, 4.0, video_effects=[OFF])]
    planned = plan_render(10, 23, SOURCE, adjustment_layers=layers)
    # A neutral Grade with effects alone is a layer; a stack all off draws nothing.
    assert planned.adjustment_layers == [
        AdjustmentEvent("a", 1.0, 3.0, Grade(), video_effects=[BLUR]), AdjustmentEvent("b", 0.0, 4.0, Grade()),
    ]


def test_a_candidates_layers_bring_their_stacks_to_the_plan_and_a_smaller_render_scales_them(tmp_path):
    candidate = replace(manual_candidate("c1", 10, 26), adjustment_layers=[AdjustmentLayer("a", 1.0, 2.0, video_effects=[BLUR])])
    planned = candidate_plan(candidate, SOURCE, None, [None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert planned.adjustment_layers[0].video_effects == [BLUR]
    # At 720p, two thirds.
    assert scaled_plan(planned, (720, 1280)).adjustment_layers[0].video_effects == [VideoEffect("gaussian-blur", {"radius": 4.0})]


def test_a_layer_saved_before_effects_reads_with_none_and_a_stack_is_checked():
    stored = asdict(replace(manual_candidate("c1", 10, 26), adjustment_layers=[AdjustmentLayer("a", 0, 1)]))
    del stored["adjustment_layers"][0]["video_effects"]
    assert TypeAdapter(Candidate).validate_python(stored).adjustment_layers[0].video_effects == []
    assert AdjustmentLayer("a", 0, 1, video_effects=[VideoEffect("gaussian-blur")]).video_effects == [VideoEffect("gaussian-blur", {"radius": 10.0})]
    with pytest.raises(ValueError, match="Adjustment Layer a's video_effects\\[1\\] \\(gaussian-blur\\) is already in its stack, at 0"):
        AdjustmentLayer("a", 0, 1, video_effects=[BLUR, OFF])


# Seam A: the API and the real ffmpeg


def sharpness(frame: np.ndarray) -> float:
    """The largest step across the Overlay's grey-to-red edge (SHOWN's, about x 540, y 700)."""
    return float(np.abs(np.diff(redness(frame))).max())


def text(frame: np.ndarray) -> np.ndarray:
    """The Text Layer's words on its plate."""
    return frame[1460:1540, 400:680].astype(float)


BLURRED = {"id": "a", "start": 0.5, "secs": 1.0, "video_effects": [{"id": "gaussian-blur", "params": {"radius": 20}}]}


def test_a_blurred_layer_blurs_the_picture_and_an_overlay_in_its_span_but_not_a_text_layer(client, settings, video_source, colour_video, colours):
    # The Source's picture, fitted across the frame, has a grey-to-red edge at x 540 below the Overlay.
    video_source.video = colour_video
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    overlays = [{"id": "o", "media": image["id"], **SHOWN}]
    candidate = patch(client, job, candidate, layout="blur", overlays=overlays, text_layers=[PLATED])
    plain, inside = (frame_at(client, settings, job, candidate, 1.0, **draft) for draft in ({}, {"adjustment_layers": [BLURRED]}))
    # Inside its span: the Overlay's edge and the Clip's picture's are soft.
    assert sharpness(plain) > 40 and sharpness(inside) < sharpness(plain) / 4, (sharpness(plain), sharpness(inside))
    assert edge_step(plain) > 40 and edge_step(inside) < edge_step(plain) / 4, (edge_step(plain), edge_step(inside))
    # The Text Layer (drawn over it, as the captions are) keeps its words sharp.
    assert np.abs(text(inside) - text(plain)).mean() < 2, np.abs(text(inside) - text(plain)).mean()
    # Outside its span, nothing changes.
    before, after = (frame_at(client, settings, job, candidate, 2.0, **draft) for draft in ({}, {"adjustment_layers": [BLURRED]}))
    assert np.abs(after.astype(float) - before).max() < 3


def test_at_strength_0_a_blurred_layer_changes_nothing_and_mid_fade_it_is_between(client, settings, video_source, plain_video, colours):
    video_source.video = plain_video
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), overlays=[{"id": "o", "media": image["id"], **SHOWN}])
    whole = BLURRED | {"secs": 2.0}
    plain = frame_at(client, settings, job, candidate, 1.0)
    none = frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole | {"strength": 0}])
    assert np.abs(none.astype(float) - plain).max() < 2
    full = sharpness(frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole]))
    # 1.0 s is half way through its 1 s fade in: half the blurred picture over half the sharp one.
    fading = sharpness(frame_at(client, settings, job, candidate, 1.0, adjustment_layers=[whole | {"fade_in": 1.0}]))
    sharp = sharpness(plain)
    assert full < sharp / 4 and 0.35 * sharp < fading < 0.75 * sharp, (sharp, fading, full)


@pytest.mark.parametrize("kind", ["image", "video"])
def test_a_keyed_overlay_shows_the_blur_of_its_unkeyed_form_at_the_same_scale(client, settings, video_source, plain_video, colours, kind):
    video_source.video = plain_video
    item = upload(client, colours[kind], f"halves.{'mp4' if kind == 'video' else 'png'}").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    blur = {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 12}}]}
    # Held at 0.5 by Keyframes; and at 0.5 until 1 s, then growing to 1, so its frames are made at scale 1.
    growing = HELD | {"keys": {"scale": [{"at": 0, "value": 0.5}, {"at": 1, "value": 0.5}, {"at": 2, "value": 1.0}]}}
    widths = {}
    for name, shown in (("still", SHOWN), ("held", HELD), ("growing", growing), ("sharp", SHOWN | {"video_effects": []})):
        overlay = {"id": "o", "media": item["id"], **blur, **shown}
        widths[name] = edge_width(frame_at(client, settings, job, candidate, 0.5, overlays=[overlay]))
    assert widths["still"] > widths["sharp"] + 6, widths
    for keyed in ("held", "growing"):
        assert abs(widths[keyed] - widths["still"]) <= max(3, widths["still"] * 0.2), widths


def test_a_layers_stack_is_saved_planned_and_a_bad_one_is_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    saved = patch(client, job, candidate, adjustment_layers=[BLURRED])
    assert saved["adjustment_layers"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 20}, "enabled": True}]
    [event] = preview(client, job, saved)["plan"]["adjustment_layers"]
    assert event["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 20}, "enabled": True}]
    bad = BLURRED | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 99}}]}
    refused = client.patch(candidate_url(job, saved), json={"adjustment_layers": [bad]})
    assert refused.status_code == 422 and "Adjustment Layer a's video_effects[0] (gaussian-blur) radius is 99; it is 1 to 50" in refused.text


# MCP


@pytest.mark.anyio
async def test_the_agent_sets_a_layers_stack_sees_it_in_the_dry_run_and_is_refused_a_bad_one(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"adjustment_layers": [
        {"id": "a", "start": 0.0, "secs": 0.5, "strength": 60, "video_effects": [{"id": "gaussian-blur"}]},
        {"id": "b", "start": 0.0, "secs": 0.5, "grade": {"adjust": {"saturation": -100}}},
    ]})
    # A merge replaces a layer's stack as a whole, its other fields kept.
    merged = await call(mcp, "merge_candidate_items", **ids, adjustment_layers=[{"id": "a", "video_effects": [{"id": "gaussian-blur", "params": {"radius": 30}}]}])
    assert merged["adjustment_layers"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 30}, "enabled": True}]
    assert merged["adjustment_layers"][0]["strength"] == 60

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    blurred, greyed = plan["adjustment_layers"]
    assert blurred["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 30}}]
    assert "video_effects" not in greyed

    message = await fails(mcp, "merge_candidate_items", **ids, adjustment_layers=[{"id": "a", "video_effects": [{"id": "swirl"}]}])
    assert "Adjustment Layer a's video_effects[0]: there is no video effect 'swirl'" in message, message
    assert "An Adjustment Layer's `video_effects`" in mcp.instructions
