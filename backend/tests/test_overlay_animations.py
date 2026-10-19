"""Overlays animate in and out (.scratch/transitions-expanded/issues/10-overlay-animations.md): an
Overlay comes on and goes off as a Text Layer does (Fade, Pop, Slide), on top of its keyed values,
its sound left alone.

Seam B on the model and the picture drawn at a time, then Seam A through the API and the real
ffmpeg, and the agent through MCP.
"""

import numpy as np
import pytest
from pydantic import TypeAdapter, ValidationError

from app.candidates import Animation, Overlay
from app.planner import MediaInfo, overlay_events, picture_at
from app.renderer import overlay_at
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import make as make_file
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import upload
from test_overlays import pictures  # noqa: F401
from test_render import add, full_frame, pixels, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

_OVERLAY = TypeAdapter(Overlay)
STILL = "cd" * 16
ITEMS = {STILL: MediaInfo(200, 100, None, False)}


def overlay(**fields) -> Overlay:
    return _OVERLAY.validate_python({"id": "o1", "media": STILL, "start": 1.0, "secs": 2.0, **fields})


def event_of(**fields):
    [event] = overlay_events([overlay(**fields)], 10, ITEMS)
    return event


# Seam B: the model and the picture drawn at a time


def test_an_overlay_stored_without_animations_reads_with_none_and_its_length_is_bounded():
    stored = overlay()
    assert (stored.animation_in, stored.animation_out, stored.animation_ms) == (Animation.NONE, Animation.NONE, 300)
    assert overlay(animation_in="pop", animation_out="slide", animation_ms=2000).animation_in == Animation.POP
    for ms in (99, 2001):
        with pytest.raises(ValidationError):
            overlay(animation_ms=ms)
    # Unanimated, it is drawn as its picture says, whenever.
    still = event_of()
    assert overlay_at(still, 1.0) == still.picture


def test_an_overlays_animations_are_stacked_on_its_keyed_values():
    keys = {
        "y": [{"at": 0, "value": 800}, {"at": 2, "value": 1000}],
        "scale": [{"at": 0, "value": 0.5}, {"at": 2, "value": 0.25}],
        "opacity": [{"at": 0, "value": 0.5}],
    }
    popped = event_of(keys=keys, radius=0.5, animation_in="pop", animation_out="slide", animation_ms=400)
    # Half way in: half its keyed opacity, 85% of its keyed scale (its corners with it), at its keyed place.
    keyed, drawn = picture_at(popped.picture, 1.2), overlay_at(popped, 1.2)
    assert drawn.opacity == pytest.approx(0.25)
    assert (drawn.width, drawn.height, drawn.radius) == pytest.approx((keyed.width * 0.85, keyed.height * 0.85, keyed.radius * 0.85))
    assert drawn.centre == pytest.approx(keyed.centre)
    # Half way out: half its keyed opacity, 30 px below its keyed place, at its keyed scale.
    keyed, drawn = picture_at(popped.picture, 2.8), overlay_at(popped, 2.8)
    assert drawn.opacity == pytest.approx(0.25)
    assert drawn.centre == pytest.approx((keyed.centre[0], keyed.centre[1] + 30))
    assert (drawn.width, drawn.height) == pytest.approx((keyed.width, keyed.height))
    # In between, as keyed.
    assert overlay_at(popped, 2.0) == picture_at(popped.picture, 2.0)
    # A keyed opacity of 0.5 fading in reaches 0.5, not 1.
    faded = event_of(keys=keys, animation_in="fade", animation_ms=500)
    assert overlay_at(faded, 1.0).opacity == 0
    assert overlay_at(faded, 1.25).opacity == pytest.approx(0.25)
    assert overlay_at(faded, 1.5).opacity == pytest.approx(0.5)


def test_each_end_of_an_overlays_animation_is_at_most_half_its_length():
    # 2000 ms each way on a 1 s Overlay: in over its first half, out over its second.
    short = event_of(secs=1.0, animation_in="pop", animation_out="pop", animation_ms=2000)
    assert overlay_at(short, 1.25).opacity == pytest.approx(0.5)
    assert overlay_at(short, 1.5).opacity == pytest.approx(1.0)
    assert overlay_at(short, 1.75).opacity == pytest.approx(0.5)


# Seam A: the real ffmpeg

BLUE = np.array([0, 0, 255])


def changed(frame: np.ndarray, plain: np.ndarray, x: int, y: int, reach: int = 220) -> tuple[np.ndarray, np.ndarray]:
    """The rows and columns of the frame's pixels within `reach` of (x, y) that aren't as the Clip's
    `plain` frame (one without Overlays) has them."""
    rows, columns = np.nonzero(np.abs(frame - plain).max(axis=2) > 15)
    near = (abs(rows - y) <= reach) & (abs(columns - x) <= reach)
    return rows[near], columns[near]


def test_overlays_come_on_and_go_off_as_animated_on_top_of_their_keyed_values(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    blue = upload(client, pictures["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 200x100 fits as 1080x540: at this scale, 300x150. Each from 0.6 s (a frame at 25 and 30 fps) for 1.6 s.
    shown = {"media": blue["id"], "start": 0.6, "secs": 1.6}
    at = lambda x, y: {"x": x, "y": y, "scale": 300 / 1080}  # noqa: E731
    candidate = patch(client, job, candidate, overlays=[
        {"id": "fade", **shown, "transform": at(270, 400), "animation_in": "fade", "animation_ms": 500},
        {"id": "pop", **shown, "transform": at(810, 400), "animation_in": "pop", "animation_ms": 800},
        {"id": "slide", **shown, "transform": at(270, 1000), "animation_out": "slide", "animation_ms": 800},
        {"id": "keyed", **shown, "transform": at(810, 1000), "animation_in": "fade", "animation_ms": 400,
         "keys": {"opacity": [{"at": 0, "value": 0.5}]}},
    ])
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert [(event["animation_in"], event["animation_out"], event["animation_ms"]) for event in planned] == [
        ("fade", "none", 500), ("pop", "none", 800), ("none", "slide", 800), ("fade", "none", 400),
    ]
    video = clip_of(client, settings, job, candidate)
    plain = full_frame(settings, video, 0.2)

    # Faded in: transparent at its first frame, wholly shown once its animation is over.
    assert len(changed(full_frame(settings, video, 0.6), plain, 270, 400)[0]) == 0
    rows, _ = pixels(full_frame(settings, video, 1.2), BLUE, tolerance=40)
    assert ((rows > 300) & (rows < 500)).sum() > 0.8 * 300 * 150

    # Popped in: a quarter of the way on (at 0.8 s) 77.5% of its width, wholly shown at its middle.
    _, early = changed(full_frame(settings, video, 0.8), plain, 810, 400)
    _, middle = changed(full_frame(settings, video, 1.4), plain, 810, 400)
    assert abs((middle.max() - middle.min()) - 300) <= 4
    assert abs((early.max() - early.min()) - 300 * 0.775) <= 6

    # Sliding out: three quarters of the way off (at 2 s), 45 px below its place.
    rows_end, _ = changed(full_frame(settings, video, 2.0), plain, 270, 1000)
    rows_middle, _ = changed(full_frame(settings, video, 1.4), plain, 270, 1000)
    assert abs((rows_end.mean() - rows_middle.mean()) - 45) <= 3

    # Keyed at half opacity and faded in: once on, half and half with the picture under it, not whole.
    frame = full_frame(settings, video, 1.2)
    assert np.abs(frame[1000, 810] - (BLUE + plain[1000, 810]) / 2).max() <= 25


def test_a_video_overlays_sound_is_heard_whole_while_it_fades_in(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    green = upload(client, pictures["green"], "green.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # Its 1500 Hz tone turned up, fading in and out over half its length each.
    talk = {"id": "v", "media": green["id"], "start": 0.4, "secs": 2.0, "volume": 1.0, "transform": {"scale": 0.3},
            "animation_in": "fade", "animation_out": "fade", "animation_ms": 1000}
    video = clip_of(client, settings, job, patch(client, job, candidate, overlays=[talk]))
    middle = tone_level(settings, video, 1500, 1.4)
    assert middle > 0
    for start in (0.45, 0.7, 2.2):
        level = tone_level(settings, video, 1500, start)
        assert abs(20 * np.log10(level / middle)) <= 1, (start, level / middle)


# The agent


@pytest.mark.anyio
async def test_the_agent_animates_an_overlay_alone_and_the_dry_run_shows_it(mcp, tmp_path):
    picture = make_file(tmp_path / "wide.png", "-f", "lavfi", "-i", "color=c=red:size=320x180", "-frames:v", "1")
    item = await call(mcp, "add_asset", kind="media", path=str(picture))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "media": item["id"], "start": 0, "secs": 1, "transform": {"scale": 0.5}}])
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert "animation_in" not in plan["overlays"][0]

    # Its animation alone: the rest of it kept.
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "animation_in": "pop", "animation_ms": 600}])
    [overlay] = merged["overlays"]
    assert (overlay["animation_in"], overlay["animation_out"], overlay["animation_ms"]) == ("pop", "none", 600)
    assert (overlay["secs"], overlay["transform"]["scale"]) == (1, 0.5)
    assert "animation_ms" in await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "animation_ms": 50}])

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert (plan["overlays"][0]["animation_in"], plan["overlays"][0]["animation_ms"]) == ("pop", 600)
    assert "animation_out" not in plan["overlays"][0]
