"""Keyed media Segments (.scratch/keyframes/issues/04-keyed-media-segment.md): Seam B on the
planner, then Seam A through the API, MCP and the real ffmpeg: a video's Segment whose Framing
moves, its Background showing wherever it leaves the frame, seen through a Transition, and its
sound's volume keyed."""

import numpy as np
import pytest

from app.candidates import Background, BackgroundKind, Framing, Keyframe, KeyProperty, Transform
from app.keyframes import value_at
from app.pictures import cover_scale
from app.canvas import PORTRAIT
from app.planner import SceneLayout, SegmentInput, plan_render
from test_keyframes import clip_of
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import upload
from test_media_segments import SOURCE, clips  # noqa: F401
from test_music import loudness_by_window
from test_render import add, full_frame, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segments import ramp_video  # noqa: F401

VIDEO = "ab" * 16
# A 1280x720 video covers the frame at this scale.
COVER = cover_scale(1280, 720, PORTRAIT.size)
RED = np.array([255, 0, 0])


# Seam B: the planner


def keyed_segment(keys: dict, framing: Framing = Framing()) -> SegmentInput:
    return SegmentInput(0, 2, media=VIDEO, width=1280, height=720, framing=framing, keys=keys, id="v")


def test_a_keyed_media_segment_moves_in_timeline_time_and_gets_its_background_unless_it_covers_the_frame_throughout():
    zoom_out = {KeyProperty.SCALE: [Keyframe(0, COVER), Keyframe(1.5, 1.0)]}
    covered = {KeyProperty.SCALE: [Keyframe(0, COVER + 0.4), Keyframe(2, COVER)], KeyProperty.X: [Keyframe(0, 560), Keyframe(2, 520)]}
    louder = {KeyProperty.VOLUME: [Keyframe(0.5, 1.0), Keyframe(1, 2.0)]}
    # After 2 s of the episode, so that its Keyframes are at 2 s plus their `at`.
    planned = plan_render(
        10, 12, SOURCE,
        main_track=[SegmentInput(10, 12), keyed_segment(zoom_out), keyed_segment(covered), keyed_segment(louder)], canvas=PORTRAIT,
    )
    [_, zooming, filled, heard] = planned.scenes
    assert zooming.layout is SceneLayout.MEDIA
    assert [(key.at, key.value) for key in zooming.picture.motion[KeyProperty.SCALE]] == [(2.0, COVER), (3.5, 1.0)]
    # 1280x720 fits as 1080x607.5 at scale 1, so a sampled scale gives its drawn size.
    assert zooming.picture.unscaled == pytest.approx((1080, 607.5))
    # Zooming out from cover, it leaves the frame's top and bottom: its blurred cover shows there.
    [background] = zooming.panels
    assert background.blur
    # Larger than the frame at every frame, a little off centre: its Background is never seen.
    assert (filled.panels, filled.colour) == ([], None)
    assert set(filled.picture.motion) == {KeyProperty.SCALE, KeyProperty.X}
    # A colour Background is left out as well; a sound's Keyframes don't move its picture.
    over_colour = plan_render(
        10, 12, SOURCE,
        main_track=[SegmentInput(10, 12), keyed_segment(covered, Framing(background=Background(BackgroundKind.COLOUR, "#123456")))], canvas=PORTRAIT,
    )
    assert (over_colour.scenes[1].panels, over_colour.scenes[1].colour) == ([], None)
    assert not heard.picture.motion and heard.panels
    # The Segment's volume Keyframes are its sound's gain track, in its own seconds.
    assert planned.segments[3].gain == louder[KeyProperty.VOLUME]
    assert [segment.id for segment in planned.segments] == ["", "v", "v", "v"]


def test_a_picture_turned_or_faded_doesnt_cover_the_frame():
    turned = {KeyProperty.ROTATION: [Keyframe(0, 0), Keyframe(2, 10)]}
    faded = {KeyProperty.OPACITY: [Keyframe(0, 1), Keyframe(2, 0.9)]}
    # Covering the frame by a good margin at every turn it takes, and opaque throughout.
    held = {KeyProperty.ROTATION: [Keyframe(0, 0), Keyframe(2, 10)], KeyProperty.SCALE: [Keyframe(0, 6)]}
    planned = plan_render(
        10, 12, SOURCE,
        main_track=[
            SegmentInput(10, 12),
            keyed_segment(turned, Framing(Transform(scale=COVER))),
            keyed_segment(faded, Framing(Transform(scale=COVER))),
            keyed_segment(held),
        ], canvas=PORTRAIT,
    )
    [_, tilted, fading, large] = planned.scenes
    assert tilted.panels and fading.panels and not large.panels


# Seam A: the API and MCP


def test_picture_keyframes_on_a_source_segment_are_refused_and_a_videos_are_kept(client, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    push = {"scale": [{"at": 0, "value": 1}, {"at": 1.5, "value": 1.6, "ease": "ease_in_out"}], "volume": [{"at": 1, "value": 0.5}]}
    video = {"id": "v", "start": 0.25, "end": 1.75, "media": red["id"], "framing": {}, "keys": push}
    saved = patch(client, job, candidate, segments=[video, episode])
    assert saved["segments"][0]["keys"]["scale"][1] == {"at": 1.5, "value": 1.6, "ease": [0.42, 0, 0.58, 1]}
    assert saved["segments"][1]["keys"] == {}

    for segments, message in (
        ([video, episode | {"keys": {"x": [{"at": 0, "value": 300}]}}], "Segment e shows the episode, whose Layouts frame it: it has no x Keyframes"),
        # Its length is its range of the video: 1.5 s.
        ([video | {"end": 1.5}, episode], "Segment v's scale Keyframe at 1.5 s is past its length of 1.25 s; send its keys too"),
        ([video | {"keys": {"volume": [{"at": 0, "value": 3}]}}, episode], "volume is 0 to 2"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": segments})
        assert response.status_code == 422 and message in response.text, (segments, response.text)


@pytest.mark.anyio
async def test_the_agent_is_refused_a_range_that_strands_a_segments_keyframe_and_dry_runs_its_keys(mcp, clips, tmp_path):
    path = tmp_path / "red.mp4"
    path.write_bytes(clips["red"])
    item = await call(mcp, "add_asset", kind="media", path=str(path))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    episode = {"id": "e", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    push = {"scale": [{"at": 0, "value": 1}, {"at": 1, "value": 2, "ease": "ease_in"}], "volume": [{"at": 0.5, "value": 0.5}]}
    video = {"id": "v", "start": 0, "end": 1, "media": item["id"], "framing": {}, "keys": push}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [episode, video]})

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "start": 0.25}])
    assert "Segment v's scale Keyframe at 1 s is past its length of 0.75 s; send its keys too" in message, message
    # A longer range keeps them.
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "end": 1.5}])
    assert merged["segments"][1]["keys"]["scale"][1]["at"] == 1

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [_, scene] = plan["scenes"]
    # In Timeline time, from where the Segment starts: where the episode's ends.
    start = scene["start"]
    assert start == plan["scenes"][0]["end"] > 1
    assert scene["keys"] == {
        "scale": [{"at": start, "value": 1, "ease": "linear"}, {"at": round(start + 1, 3), "value": 2, "ease": "ease_in"}],
    }
    # 640x360 fits as 1080x607.5 about the frame's centre: at scale 1, then 2.
    assert [view["bounds"]["width"] for view in scene["bounds_at_keys"]] == [1080, 2160]
    [sound] = [sound for sound in plan["sounds"] if sound["id"] == "v"]
    assert sound == {"id": "v", "media": item["id"], "start": start, "end": round(start + 1.5, 3), "keys": {"volume": [{"at": round(start + 0.5, 3), "value": 0.5, "ease": "linear"}]}}


# Seam A: the real ffmpeg


def red_columns(frame: np.ndarray, row: int, tolerance: int = 60) -> np.ndarray:
    return np.nonzero(np.abs(frame[row] - RED).max(axis=1) <= tolerance)[0]


def test_a_keyed_media_segment_is_drawn_at_its_sampled_size_and_its_background_shows_where_it_leaves_the_frame(
    client, settings, video_source, ramp_video, clips,
):
    video_source.video = ramp_video
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    over_blue = {"background": {"kind": "colour", "colour": "#0000FF"}}
    # 640x360 fits as 1080x607.5: from half that wide to all of it, over blue; and zooming out from
    # cover to scale 1 over its blurred self.
    grow = {"scale": [{"at": 0, "value": 0.5}, {"at": 2, "value": 1}]}
    cover = cover_scale(640, 360, PORTRAIT.size)
    zoom_out = {"scale": [{"at": 0, "value": cover}, {"at": 1.5, "value": 1}]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "grow", "start": 0, "end": 2, "media": red["id"], "framing": over_blue, "keys": grow},
        {"id": "out", "start": 0, "end": 2, "media": red["id"], "framing": {}, "keys": zoom_out},
        {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
    ])
    [growing, zooming, _] = preview(client, job, candidate)["plan"]["scenes"]
    assert growing["picture"]["motion"]["scale"] and zooming["panels"]
    video = clip_of(client, settings, job, candidate)

    # The Clip is at the Source's 25 fps: frames at 0.52 s and 1.52 s.
    for at in (0.52, 1.52):
        frame = full_frame(settings, video, at)
        across = red_columns(frame, 960)
        expected = 1080 * value_at([Keyframe(0, 0.5), Keyframe(2, 1)], at, 0)
        assert abs(len(across) - expected) <= 4 and abs(across.mean() - 540) <= 2, (at, len(across), expected)
        assert np.abs(frame[960, 20] - [0, 0, 255]).max() < 40
    # Covering the frame at its start; zoomed out, its blurred cover shows above and below it, not black.
    covered = full_frame(settings, video, 2.0)
    assert np.abs(covered[20, 540] - RED).max() < 60
    zoomed = full_frame(settings, video, 3.4)
    for row in (60, 1860):
        r, g, b = zoomed[row, 540]
        assert r > 120 and max(g, b) < 60, (row, zoomed[row, 540])
    assert np.abs(zoomed[960, 540] - RED).max() < 60


def test_a_fade_into_a_keyed_media_segment_shows_its_moving_picture_and_its_volume_follows_its_keyframes(
    client, settings, video_source, ramp_video, clips,
):
    video_source.video = ramp_video
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    # At half its fitted size over blue, sliding right; its tone turned down to a quarter.
    slide = {"x": [{"at": 0, "value": 300}, {"at": 1, "value": 700}]}
    dip = {"volume": [{"at": 1.1, "value": 1}, {"at": 1.3, "value": 0.25}]}
    framing = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#0000FF"}}
    candidate = patch(
        client, job, candidate,
        segments=[
            {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
            {"id": "v", "start": 0, "end": 2, "media": red["id"], "framing": framing, "keys": slide | dip},
        ],
        transitions=[{"after": "e", "kind": "fade", "secs": 0.6}],
    )
    planned = preview(client, job, candidate)["plan"]
    [fade] = planned["transitions"]
    keyed = planned["segments"][1]
    assert keyed["start"] == fade["start"]
    video = clip_of(client, settings, job, candidate)

    # Half way through the fade, the red picture shows faded over the episode where its Keyframes
    # have it then (within a frame: xfade pairs the two sides' frames in order), not at its constant 540.
    middle = (fade["start"] + fade["end"]) / 2
    frame = full_frame(settings, video, middle)
    row = frame[960]
    redder = np.nonzero(row[:, 0] - row[:, 2] > 60)[0]
    keys = [Keyframe(0, 300), Keyframe(1, 700)]
    low, high = (value_at(keys, middle - keyed["start"] + step, 0) for step in (-0.08, 0.08))
    assert len(redder) > 200 and low - 2 <= redder.mean() <= high + 2, (redder.mean(), low, high)
    # After it, sharp and at its sampled place.
    after = full_frame(settings, video, keyed["start"] + 0.8)
    across = red_columns(after, 960)
    assert abs(across.mean() - value_at(keys, 0.8, 0)) <= 18, across.mean()

    # Its tone is a quarter as loud (12 dB down) once the dip is done.
    levels = loudness_by_window(settings, video)
    start = keyed["start"]
    before = levels[round((start + 0.7) * 10) : round((start + 1.0) * 10)].mean()
    dipped = levels[round((start + 1.4) * 10) : round((start + 1.8) * 10)].mean()
    assert 20 * np.log10(dipped / before) == pytest.approx(20 * np.log10(0.25), abs=1.0), (before, dipped)
