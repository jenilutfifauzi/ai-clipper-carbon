"""Video Effects on Overlays (.scratch/video-effects/issues/01-gaussian-blur-on-an-overlay.md, ADR
0014): the catalogue run by the real ffmpeg over a 1 s 1080x1920 clip; Seam B on the planner; then
Seam A through the API, MCP and the real ffmpeg: what is drawn, and what is refused."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Overlay, Transform
from app.config import load_settings
from app.planner import MediaInfo, overlay_events, plan_render
from app.scaled_plan import scaled_plan
from app.video_effects import VideoEffect, catalogue, checked_video_effects, effects, video_effect_chain
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import upload
from test_overlay_grades import colours  # noqa: F401
from test_render import add, reviewed
from test_render_sizes import SOURCE
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import frame_at

VIDEO, IMAGE = "ab" * 16, "cd" * 16
ITEMS = {VIDEO: MediaInfo(640, 360, 10.0, True), IMAGE: MediaInfo(320, 180, None, False)}


# The catalogue


def played(filters: list[str]) -> tuple[tuple[int, int], int]:
    """The size and the number of frames of a 1 s 1080x1920 test clip at 30 fps through `filters`."""
    ffmpeg = str(load_settings().ffmpeg_bin)
    source = "testsrc2=size=1080x1920:rate=30:duration=1"
    command = [ffmpeg, "-v", "error", "-f", "lavfi", "-i", source, "-vf", ",".join([*filters, "format=rgb24"]), "-f", "rawvideo", "-"]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    frame = 1080 * 1920 * 3
    assert len(raw) % frame == 0, len(raw)
    return (1080, 1920), len(raw) // frame


@pytest.mark.parametrize("corner", ["default", "min", "max"])
@pytest.mark.parametrize("effect", effects(), ids=lambda effect: effect.id)
def test_each_effect_runs_at_its_default_minimum_and_maximum_and_keeps_a_1_s_clips_size_and_length(effect, corner):
    params = {setting.key: getattr(setting, corner) for setting in effect.settings}
    chain = video_effect_chain([VideoEffect(effect.id, params)], (1080, 1920))
    assert chain
    assert played(chain) == ((1080, 1920), 30)


def test_the_registry_lists_its_effects_under_the_video_kind_by_category(client):
    listed = client.get("/api/video-effects").json()
    assert [(effect["category"], effect["id"]) for effect in listed] == [
        ("Blur", "gaussian-blur"), ("Blur", "motion-blur"),
        ("Distort", "pixelate"), ("Distort", "chromatic-aberration"), ("Distort", "fisheye"),
        ("Stylize", "posterize"),
    ]
    assert all(effect["kind"] == "video" for effect in listed)
    blur = listed[0]
    assert blur["id"] == "gaussian-blur" and blur["kind"] == "video" and blur["category"] == "Blur"
    assert blur["settings"] == [{"key": "radius", "label": "Radius", "min": 1, "max": 50, "default": 10, "step": 1, "unit": "px", "intensity": True}]
    assert blur["name"] == "Gaussian blur" and blur["description"]


def test_the_catalogue_is_the_one_the_frontends_imitations_are_checked_against():
    """fixtures/video_effects.json, which the frontend's tests read, so that every effect has an imitation."""
    shared = json.loads((Path(__file__).parent / "fixtures" / "video_effects.json").read_text())
    assert catalogue() == shared


def test_a_stack_is_checked_its_defaults_filled_and_a_disabled_entry_adds_nothing():
    [blur] = checked_video_effects([VideoEffect("gaussian-blur")], "Overlay o")
    assert blur == VideoEffect("gaussian-blur", {"radius": 10.0})
    for stack, message in (
        ([VideoEffect("swirl")], "Overlay o's video_effects[0]: there is no video effect 'swirl'"),
        ([VideoEffect("gaussian-blur", {"sigma": 3})], "Overlay o's video_effects[0] (gaussian-blur) has no setting 'sigma': its settings are radius"),
        ([VideoEffect("gaussian-blur", {"radius": 51})], "Overlay o's video_effects[0] (gaussian-blur) radius is 51; it is 1 to 50"),
        ([blur, VideoEffect("gaussian-blur", enabled=False)], "Overlay o's video_effects[1] (gaussian-blur) is already in its stack, at 0"),
    ):
        with pytest.raises(ValueError) as refused:
            checked_video_effects(stack, "Overlay o")
        assert message in str(refused.value), str(refused.value)
    assert video_effect_chain([VideoEffect("gaussian-blur", {"radius": 10.0}, enabled=False)], (1080, 1920)) == []
    assert video_effect_chain([], (1080, 1920)) == []


# Seam B: the planner


def test_an_overlays_enabled_effects_reach_its_event_their_sizes_times_its_scale():
    blur = VideoEffect("gaussian-blur", {"radius": 8})
    events = overlay_events([
        Overlay("v", VIDEO, 0.0, 1.0, transform=Transform(scale=0.5, stretch_x=3), video_effects=[blur]),
        Overlay("i", IMAGE, 0.0, 1.0, transform=Transform(scale=2), video_effects=[blur]),
        Overlay("off", IMAGE, 0.0, 1.0, video_effects=[VideoEffect("gaussian-blur", enabled=False)]),
        Overlay("plain", IMAGE, 0.0, 1.0),
    ], 10, ITEMS)
    # The larger of scale x stretch on each axis: 1.5 across; 2.
    assert [event.video_effects for event in events] == [
        [VideoEffect("gaussian-blur", {"radius": 12.0})],
        [VideoEffect("gaussian-blur", {"radius": 16.0})],
        [],
        [],
    ]


def test_a_plan_drawn_at_another_size_scales_its_overlays_effects_sizes_with_it():
    blurred = Overlay("i", IMAGE, 0.0, 1.0, video_effects=[VideoEffect("gaussian-blur", {"radius": 9})])
    plan = plan_render(10, 14, SOURCE, overlays=[blurred], media_info=ITEMS)
    [drawn] = scaled_plan(plan, (720, 1280)).overlays
    # At 720p, two thirds: 9 x 0.5 (its scale) x 2/3.
    assert drawn.video_effects == [VideoEffect("gaussian-blur", {"radius": 3.0})]


def test_an_overlay_stored_without_effects_has_none_and_plans_as_before():
    stored = {"id": "o", "media": IMAGE, "start": 0.0, "secs": 1.0}
    overlay = TypeAdapter(Overlay).validate_python(stored)
    assert overlay.video_effects == []
    [event] = overlay_events([overlay], 10, ITEMS)
    assert event.video_effects == []


# Seam A: the API and the real ffmpeg


# At scale 0.5 a 320x180 picture is drawn 540x304 about (540, 700): grey left of x 540, red right of it.
SHOWN = {"start": 0.0, "secs": 2.0, "transform": {"x": 540, "y": 700, "scale": 0.5}}


def redness(frame: np.ndarray) -> np.ndarray:
    """Red minus green along the rows 650 to 750, across x 380 to 700: 0 on the grey half, ~176 on the red."""
    band = frame[650:750, 380:700].astype(float)
    return (band[..., 0] - band[..., 1]).mean(axis=0)


def edge_width(frame: np.ndarray) -> int:
    """How many pixels the grey-to-red edge takes to rise from 10 % to 90 % of its height."""
    profile = redness(frame)
    low, high = profile[:40].mean(), profile[-40:].mean()
    share = (profile - low) / (high - low)
    return int(((share > 0.1) & (share < 0.9)).sum())


@pytest.mark.parametrize("kind", ["image", "video"])
def test_a_blurred_overlay_lowers_the_edge_contrast_of_its_picture(client, settings, video_source, plain_video, colours, kind):
    video_source.video = plain_video
    item = upload(client, colours[kind], f"halves.{'mp4' if kind == 'video' else 'png'}").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": item["id"], **SHOWN}
    candidate = patch(client, job, candidate, overlays=[shown])
    plain = frame_at(client, settings, job, candidate, 1.0)
    blurred = frame_at(client, settings, job, candidate, 1.0, overlays=[shown | {"video_effects": [{"id": "gaussian-blur", "params": {"radius": 20}}]}])
    sharp, soft = (np.abs(np.diff(redness(frame))).max() for frame in (plain, blurred))
    assert sharp > 40 and soft < sharp / 4, (sharp, soft)
    # The Segment around it is as it was.
    area = (slice(300, 500), slice(100, 980))
    assert np.abs(blurred[area].astype(float) - plain[area]).mean() < 1


def test_a_scaled_up_overlay_is_blurred_in_proportion(client, settings, video_source, plain_video, colours):
    video_source.video = plain_video
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    blur = [{"id": "gaussian-blur", "params": {"radius": 8}}]
    widths = {}
    for scale in (0.5, 1.0):
        shown = {"id": "o", "media": image["id"], "start": 0.0, "secs": 2.0, "transform": {"x": 540, "y": 700, "scale": scale}, "video_effects": blur}
        widths[scale] = edge_width(frame_at(client, settings, job, candidate, 1.0, overlays=[shown]))
    # Twice the scale, about twice as wide an edge.
    assert 1.6 < widths[1.0] / widths[0.5] < 2.4, widths


def test_an_overlays_stack_is_saved_with_its_defaults_filled_and_a_bad_one_is_refused(client, colours):
    image = upload(client, colours["image"], "halves.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": image["id"], "start": 0.0, "secs": 1.0}
    saved = patch(client, job, candidate, overlays=[shown | {"video_effects": [{"id": "gaussian-blur", "enabled": False}]}])
    assert saved["overlays"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 10}, "enabled": False}]
    for stack, message in (
        ([{"id": "swirl"}], "Overlay o's video_effects[0]: there is no video effect 'swirl'"),
        ([{"id": "gaussian-blur", "params": {"sigma": 1}}], "Overlay o's video_effects[0] (gaussian-blur) has no setting 'sigma'"),
        ([{"id": "gaussian-blur", "params": {"radius": 0}}], "Overlay o's video_effects[0] (gaussian-blur) radius is 0; it is 1 to 50"),
        ([{"id": "gaussian-blur"}, {"id": "gaussian-blur"}], "Overlay o's video_effects[1] (gaussian-blur) is already in its stack, at 0"),
    ):
        response = client.patch(candidate_url(job, saved), json={"overlays": [shown | {"video_effects": stack}]})
        assert response.status_code == 422 and message in response.text, (message, response.text)


# MCP


@pytest.mark.anyio
async def test_the_agent_lists_the_effects_sets_a_stack_sees_it_in_the_dry_run_and_is_refused_a_bad_one(mcp, colours, tmp_path):
    listed = await call(mcp, "list_assets", kind="video_effects")
    assert set(listed) == {"video_effects"}
    assert [effect["id"] for effect in listed["video_effects"]][:2] == ["gaussian-blur", "motion-blur"]

    path = tmp_path / "halves.png"
    path.write_bytes(colours["image"])
    image = await call(mcp, "add_asset", path=str(path), kind="media")
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    shown = {"media": image["id"], "start": 0, "secs": 0.5, "transform": {"scale": 0.5}}
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [
        {"id": "o", **shown, "video_effects": [{"id": "gaussian-blur"}]}, {"id": "p", **shown},
    ]})
    # A merge replaces an Overlay's stack as a whole, its other fields kept.
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "video_effects": [{"id": "gaussian-blur", "params": {"radius": 30}}]}])
    assert merged["overlays"][0]["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 30}, "enabled": True}]
    assert merged["overlays"][0]["transform"]["scale"] == 0.5

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    blurred, plain = plan["overlays"]
    # Scaled by its scale, 0.5.
    assert blurred["video_effects"] == [{"id": "gaussian-blur", "params": {"radius": 15}}]
    assert "video_effects" not in plain

    for stack, message in (
        ([{"id": "swirl"}], "Overlay o's video_effects[0]: there is no video effect 'swirl'"),
        ([{"id": "gaussian-blur", "params": {"sigma": 1}}], "Overlay o's video_effects[0] (gaussian-blur) has no setting 'sigma'"),
        ([{"id": "gaussian-blur", "params": {"radius": 99}}], "Overlay o's video_effects[0] (gaussian-blur) radius is 99; it is 1 to 50"),
        ([{"id": "gaussian-blur"}, {"id": "gaussian-blur"}], "Overlay o's video_effects[1] (gaussian-blur) is already in its stack, at 0"),
    ):
        message_given = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "video_effects": stack}])
        assert message in message_given, message_given
    assert "video_effects" in mcp.instructions and 'list_assets kind "video_effects"' in mcp.instructions
