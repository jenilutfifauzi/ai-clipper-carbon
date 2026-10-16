"""Keyed Manual Scenes (.scratch/keyframes/issues/05-keyed-manual-scene.md): Seam B on the planner,
then Seam A through the API, MCP and the real ffmpeg: a Manual Layout Override's Framing that moves,
its Keyframes in seconds from its Scene's start on the Source's timeline, so that every Segment
showing the Scene shows the same motion at the same moments of the Source."""

import subprocess

import numpy as np
import pytest

from app.candidates import Background, BackgroundKind, Framing, Keyframe, KeyProperty, Layout, LayoutOverride, Transform
from app.keyframes import value_at
from app.planner import Scene, SceneLayout, SegmentInput, plan_render
from app.pictures import cover_scale
from app.planner import FRAME
from test_keyframes import clip_of
from test_manual_layout import SOURCE
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, full_frame, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

OVER_BLUE = Framing(Transform(scale=0.5), background=Background(BackgroundKind.COLOUR, "#0000FF"))
# From x 300 to 800 over the Scene's first 4 s.
PAN = {KeyProperty.X: [Keyframe(0, 300), Keyframe(4, 800)]}


def by_hand(at: float, keys: dict = PAN, framing: Framing = OVER_BLUE) -> LayoutOverride:
    return LayoutOverride(at, Layout.MANUAL, framing, keys)


# Seam B: the planner


def test_a_manual_scenes_keyframes_come_out_in_timeline_time_in_every_segment_that_shows_its_scene():
    # The Source from 10 s to 20 s, cut at 12 s: the override (at 15 s) frames the shot from 12 s.
    whole = SegmentInput(10, 20, scenes=[Scene(0, 2), Scene(2, 10)], layout_overrides=[by_hand(5)])
    # Starting 2 s into that shot, and shown twice.
    later = SegmentInput(14, 18, scenes=[Scene(0, 4)], layout_overrides=[by_hand(1)])
    planned = plan_render(10, 20, SOURCE, main_track=[whole, later, whole])
    [_, first, middle, _, again] = planned.scenes
    assert {first.layout, middle.layout, again.layout} == {SceneLayout.MANUAL}
    # In Timeline time, from where the shot starts: 2 s in, 10 s less 2, and 14 s plus 2.
    xs = lambda scene: [(key.at, key.value) for key in scene.picture.motion[KeyProperty.X]]  # noqa: E731
    assert xs(first) == [(2, 300), (6, 800)]
    assert xs(again) == [(16, 300), (20, 800)]
    # The later Segment shows the motion from 2 s into it, its Keyframe before it kept in the track.
    assert (middle.start, middle.keys_from, xs(middle)) == (10, 8, [(8, 300), (12, 800)])
    assert value_at(middle.picture.motion[KeyProperty.X], middle.start, 0) == 550
    # Its Background is still drawn: the picture doesn't cover the frame.
    assert middle.colour == "#0000FF"


def test_a_manual_scene_covering_the_frame_throughout_has_no_background_and_its_keyframes_past_its_end_are_ignored():
    cover = cover_scale(1920, 1080, FRAME)
    push = {KeyProperty.SCALE: [Keyframe(0, cover + 0.1), Keyframe(2, cover + 0.5), Keyframe(9, 1)]}
    [scene] = plan_render(100, 103, SOURCE, layout_overrides=[by_hand(1, push, Framing())]).scenes
    # The 3 s Scene never reaches its Keyframe at 9 s, which is left out of its track.
    assert [key.at for key in scene.picture.motion[KeyProperty.SCALE]] == [0, 2]
    assert scene.ignored == {KeyProperty.SCALE: [Keyframe(9, 1)]}
    assert (scene.panels, scene.colour) == ([], None)
    # The Candidate's own Manual Framing and an unkeyed override stay still.
    for planned in (plan_render(100, 103, SOURCE, layout=Layout.MANUAL, framing=OVER_BLUE), plan_render(100, 103, SOURCE, layout_overrides=[by_hand(1, {})])):
        [still] = planned.scenes
        assert still.layout is SceneLayout.MANUAL and not still.picture.motion
