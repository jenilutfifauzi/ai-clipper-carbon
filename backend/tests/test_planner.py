"""Seam B: the Render Planner on synthetic input, without video."""

import math
from dataclasses import replace

import pytest
from pydantic import TypeAdapter

from app.candidates import CueEdit, Layout, LayoutOverride, TransitionKind, WordEdit
from app.config import CameraTuning
from app.styles import CaptionPosition, CaptionStyle, Highlight, HookAlign, HookPosition, HookShape, HookStyle
from app.canvas import PORTRAIT
from app.planner import (
    hook_width,
    kicker_widest,
    HOOK_PAD_X,
    HOOK_SIZE,
    HOOK_PAD_Y,
    Box,
    CaptionWord,
    CropPoint,
    Cue,
    Face,
    FrameFaces,
    HookEvent,
    Join,
    RenderPlan,
    Scene,
    SceneLayout,
    SegmentInput,
    fit_hook,
    match_edits,
    font_metrics,
    plan_render,
)
from app.transcript import Word
from app.video_source import SourceMetadata


def source(width: int, height: int, fps: float = 25) -> SourceMetadata:
    return SourceMetadata(duration=3600, fps=fps, width=width, height=height, codec="h264")


def only_panel(plan: RenderPlan):
    [scene] = plan.scenes
    [panel] = scene.panels
    return scene, panel


def test_a_landscape_source_gets_one_static_full_height_crop_from_the_centre():
    plan = plan_render(612.35, 655.8, source(1920, 1080, fps=29.97), canvas=PORTRAIT)

    assert (plan.start, plan.end, plan.duration) == (612.35, 655.8, pytest.approx(43.45))
    assert (plan.width, plan.height, plan.source_width, plan.source_height, plan.fps) == (1080, 1920, 1920, 1080, 29.97)
    scene, panel = only_panel(plan)
    # One scene over the whole Clip, on the Clip's own timeline.
    assert (scene.start, scene.end, scene.layout) == (0.0, 43.45, SceneLayout.TRACK)
    assert panel.area == Box(0, 0, 1080, 1920)
    assert (panel.crop_width, panel.crop_height) == (608, 1080)  # 1080 x 9/16 = 607.5, kept even
    assert panel.path == [CropPoint(0.0, 656, 0)]  # centred: 656 + 304 = 960
    assert (plan.captions, plan.hook) == ([], None)


@pytest.mark.parametrize(("width", "height"), [(1281, 721), (853, 480), (641, 359), (1080, 1080), (321, 181)])
def test_odd_and_unusual_sizes_still_give_an_even_centred_9_16_crop_inside_the_frame(width, height):
    _, panel = only_panel(plan_render(10, 40, source(width, height), canvas=PORTRAIT))
    [at] = panel.path

    assert all(value % 2 == 0 for value in (panel.crop_width, panel.crop_height, at.x, at.y))
    assert 0 <= at.x and at.x + panel.crop_width <= width
    assert 0 <= at.y and at.y + panel.crop_height <= height
    assert height - panel.crop_height <= 1  # full height, less an odd last row
    assert panel.crop_width / panel.crop_height == pytest.approx(9 / 16, abs=2 / panel.crop_height)
    assert at.x + panel.crop_width / 2 == pytest.approx(width / 2, abs=1)


@pytest.mark.parametrize(
    ("width", "height", "area"),
    [
        (1080, 1920, Box(0, 0, 1080, 1920)),
        (720, 1280, Box(0, 0, 1080, 1920)),  # scaled up to fill
        (1080, 1440, Box(0, 240, 1080, 1440)),  # 3:4: as wide as the frame, centred
        (721, 1281, Box(0, 0, 1080, 1920)),  # odd sizes: the last column and row are left out
        (480, 1080, Box(112, 0, 854, 1920)),  # narrower than 9:16: as tall as the frame, centred
    ],
)
def test_a_portrait_source_is_passed_through_whole(width, height, area):
    scene, panel = only_panel(plan_render(0, 30, source(width, height), canvas=PORTRAIT))

    assert scene.layout is SceneLayout.PASSTHROUGH
    assert (panel.crop_width, panel.crop_height) == (width - width % 2, height - height % 2)
    assert panel.path == [CropPoint(0.0, 0, 0)]
    assert panel.area == area


def test_the_plan_is_saved_and_read_back_as_json():
    plan = plan_render(5, 35.5, source(1920, 1080), canvas=PORTRAIT)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


@pytest.mark.parametrize(("start", "end"), [(10, 10), (10, 5), (-1, 5)])
def test_a_clip_must_run_forwards(start, end):
    with pytest.raises(ValueError):
        plan_render(start, end, source(1920, 1080), canvas=PORTRAIT)


# Face tracking (ticket 13). The Source is 1920x1080 at 25 fps, so the crop is 608 px wide, its dead-zone
# 152 px wide (76 px either side of the goal), and faces are sampled every 3rd frame (0.12 s).
FPS = 25
SAMPLE = 3 / FPS
CROP = 608
CAMERA = CameraTuning()
# The most the crop may move from one frame to the next, in Source pixels: about 0.7 px of the output
# per millisecond.
MAX_STEP = 40


def face(centre: float, size: float = 300, y: float = 300) -> Face:
    return Face(centre - size / 2, y, size, size, 0.95)


def sampled(*runs: tuple[float, list[list[Face]] | list[Face] | None], start: float = 0) -> list[FrameFaces]:
    """Sampled frames from `start`, each run being (seconds, faces): the same faces in every frame of
    the run, None meaning no face."""
    frames, at = [], start
    for secs, faces in runs:
        end = at + secs
        while at < end - 1e-9:
            frames.append(FrameFaces(round(at, 3), [] if faces is None else list(faces)))
            at += SAMPLE
    return frames


def tracked(
    faces: list[FrameFaces], secs: float, scenes: list[Scene] | None = None, layout: Layout = Layout.AUTO
) -> RenderPlan:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), scenes, faces, layout, canvas=PORTRAIT)


def crop_at(path: list[CropPoint], at: float) -> int:
    """The crop's left edge at `at` seconds: from the last change point at or before it."""
    return [point.x for point in path if point.at <= at + 1e-6][-1]


def per_frame(path: list[CropPoint], start: float, end: float) -> list[int]:
    return [crop_at(path, frame / FPS) for frame in range(round(start * FPS), round(end * FPS))]


def centred_on(centre: float) -> int:
    """The crop's left edge with `centre` in its middle, as the planner rounds it."""
    return min(max(2 * round((centre - CROP / 2) / 2), 0), 1920 - CROP)


def test_the_crop_follows_a_face_that_moves_smoothly_and_never_jumps():
    # The face glides from 500 to 1400 px in 3 s, then stays.
    glide = [FrameFaces(round(k * SAMPLE, 3), [face(500 + min(900, 300 * k * SAMPLE))]) for k in range(int(5 / SAMPLE))]
    plan = tracked(glide, 5)
    _, panel = only_panel(plan)

    xs = per_frame(panel.path, 0, 5)
    assert xs[0] == centred_on(500)
    assert max(abs(b - a) for a, b in zip(xs, xs[1:])) <= MAX_STEP
    # It settles with the face inside the dead-zone.
    assert abs(xs[-1] - centred_on(1400)) <= CAMERA.dead_zone * CROP / 2
    # Every point is a change, and the crop moves on frames between the sampled ones too.
    assert all(a.x != b.x for a, b in zip(panel.path, panel.path[1:]))
    assert any(round(point.at / SAMPLE, 3) % 1 for point in panel.path)
    assert all(point.y == 0 and point.x % 2 == 0 for point in panel.path)


def test_a_confirmed_jump_is_followed_without_overshoot_and_within_the_speed_limit():
    # The face is at 700 px for 1 s, then at 950 px (a jump: more than 76 px from the last sighting).
    faces = sampled((1, [face(700)]), (3, [face(950)]))
    plan = tracked(faces, 4)
    _, panel = only_panel(plan)

    xs = per_frame(panel.path, 0, 4)
    before, after = centred_on(700), centred_on(950)
    assert set(xs[:25]) == {before}
    # Monotonic, never past the new position, and settled on it.
    assert all(b >= a for a, b in zip(xs, xs[1:]))
    assert max(xs) == xs[-1] == after
    # It eases in and out, like a spring.
    steps = [b - a for a, b in zip(xs, xs[1:]) if b != a]
    assert max(steps) <= MAX_STEP
    assert steps[0] < max(steps) / 2 and steps[-1] <= 4
    # The camera starts moving only once the third detection at 950 px confirms the jump.
    third = [frame.at for frame in faces if frame.faces[0].centre_x == 950][2]
    assert next(point.at for point in panel.path if point.x != before) == third


def test_a_step_across_the_frame_is_never_overshot_or_crossed_too_fast():
    # The face jumps 280 px to the right four times (each a fresh jump the tracker still matches).
    runs = [(1, [face(400 + 280 * i)]) for i in range(5)]
    plan = tracked(sampled(*runs), 5)
    _, panel = only_panel(plan)

    xs = per_frame(panel.path, 0, 5)
    assert all(b >= a for a, b in zip(xs, xs[1:]))
    assert max(b - a for a, b in zip(xs, xs[1:])) <= MAX_STEP
    for i in range(5):
        # Within each second the crop never goes past that second's face.
        assert max(xs[25 * i : 25 * (i + 1)]) <= centred_on(400 + 280 * i)


def test_the_dead_zone_ignores_small_moves():
    # The face wobbles up to 70 px either side of 900 px: within the 76 px half-dead-zone.
    wobble = [FrameFaces(round(k * SAMPLE, 3), [face(900 + 70 * math.sin(k))]) for k in range(int(4 / SAMPLE))]
    _, panel = only_panel(tracked(wobble, 4))
    assert len(panel.path) == 1

    # Drifting 90 px away is followed.
    _, panel = only_panel(tracked(sampled((1, [face(900)]), (3, [face(990)])), 4))
    assert crop_at(panel.path, 3.9) == centred_on(990)


def test_a_single_wrong_detection_is_ignored():
    # One sampled frame puts the face 250 px away: near enough to be the same face, too far to be a move.
    plan = tracked(sampled((1, [face(700)]), (SAMPLE, [face(950)]), (2, [face(700)])), 3)
    _, panel = only_panel(plan)
    assert panel.path == [CropPoint(0.0, centred_on(700), 0)]

    # Two in a row are ignored too; it takes three.
    plan = tracked(sampled((1, [face(700)]), (2 * SAMPLE, [face(950)]), (2, [face(700)])), 3)
    assert only_panel(plan)[1].path == [CropPoint(0.0, centred_on(700), 0)]


def test_each_scene_starts_framed_on_its_face():
    # A cut at 2 s from a face at 500 px to one at 1500 px. In the second scene the face is only
    # found from its second sampled frame, but the scene still starts on it.
    faces = sampled((2, [face(500)])) + sampled((SAMPLE, None), (2, [face(1500)]), start=2)
    plan = tracked(faces, 4, [Scene(0, 2), Scene(2, 4)])

    first, second = plan.scenes
    assert (first.start, first.end, second.start, second.end) == (0, 2, 2, 4)
    assert all(scene.layout is SceneLayout.TRACK for scene in plan.scenes)
    assert first.panels[0].path == [CropPoint(0.0, centred_on(500), 0)]
    assert second.panels[0].path == [CropPoint(2.0, centred_on(1500), 0)]


def test_the_crop_holds_still_while_the_face_is_lost():
    # The face is seen at 1200 px, lost for 2 s, then seen there again. (The face is missing from
    # most of the Scene, which would make it Blur, so Track is forced.)
    plan = tracked(sampled((1, [face(1200)]), (2, None), (1, [face(1220)])), 4, layout=Layout.TRACK)
    assert only_panel(plan)[1].path == [CropPoint(0.0, centred_on(1200), 0)]

    # Lost mid-move, the crop finishes the move it had confirmed, then holds.
    plan = tracked(sampled((1, [face(700)]), (3 * SAMPLE, [face(950)]), (3, None)), 4.5, layout=Layout.TRACK)
    xs = per_frame(only_panel(plan)[1].path, 0, 4.5)
    assert xs[-1] == centred_on(950)
    assert len(set(xs[-50:])) == 1


def test_a_tracked_scene_without_faces_keeps_the_centre_crop():
    plan = tracked(sampled((3, None)), 3, layout=Layout.TRACK)
    assert only_panel(plan)[1].path == [CropPoint(0.0, 656, 0)]


# The Speaker Tracker picks one of several faces in a tracked Scene. Two faces would make it Split,
# so these force Track.
def test_the_tracker_sticks_with_its_speaker_unless_another_clearly_takes_over():
    # A (at 500 px) is seen first. B (at 1400 px) then appears beside it with 2.5x A's area, which
    # stays under the x3 stickiness: the crop stays on A.
    a, b = face(500, 200), face(1400, 200 * 2.5**0.5)
    plan = tracked(sampled((SAMPLE, [a]), (5, [a, b])), 5, layout=Layout.TRACK)
    assert only_panel(plan)[1].path == [CropPoint(0.0, centred_on(500), 0)]

    # With 4x A's area, B takes over, but only once the 30-frame cooldown (1.2 s) since A became the
    # target has passed. The move is then a jump, which three detections confirm.
    b = face(1400, 400)
    plan = tracked(sampled((SAMPLE, [a]), (5, [a, b])), 5, layout=Layout.TRACK)
    path = only_panel(plan)[1].path
    moved = next(point.at for point in path if point.x != centred_on(500))
    assert moved == pytest.approx(30 / FPS + 2 * SAMPLE, abs=SAMPLE)
    assert crop_at(path, 4.9) == centred_on(1400)
    # Even across the frame, the crop pans rather than jumps.
    xs = per_frame(path, 0, 5)
    assert max(b - a for a, b in zip(xs, xs[1:])) <= MAX_STEP


def test_the_cooldown_also_holds_back_a_switch_back():
    # B takes over from A at 1.2 s; A then grows to 10x B's area at 1.44 s, but can't take the target
    # back until 1.2 s after the switch.
    a, b, big_a = face(500, 200), face(1400, 400), face(500, 1000)
    faces = sampled((SAMPLE, [a]), (1.32, [a, b]), (4, [big_a, b]))
    path = only_panel(tracked(faces, 5.5, layout=Layout.TRACK))[1].path
    xs = per_frame(path, 0, 5.5)
    back = next(i for i, x in enumerate(xs) if i > 0 and x < xs[i - 1]) / FPS
    assert back == pytest.approx(30 / FPS + 30 / FPS + 2 * SAMPLE, abs=SAMPLE)
    assert xs[-1] == centred_on(500)


def test_a_face_far_from_the_target_is_someone_else():
    # The face at 500 px moves to 750 px: within 15% of the frame's width (288 px), so the same face,
    # followed once three detections confirm the jump.
    faces = sampled((1, [face(500)]), (3, [face(750)]))
    path = only_panel(tracked(faces, 4))[1].path
    third = [frame.at for frame in faces if frame.faces[0].centre_x == 750][2]
    assert next(point.at for point in path if point.x != centred_on(500)) == third

    # A face 900 px away is another person: followed only once the lost target's score has decayed
    # to under a third of the newcomer's, about a second later.
    faces = sampled((1, [face(500)]), (3, [face(1400)]))
    path = only_panel(tracked(faces, 4))[1].path
    third = [frame.at for frame in faces if frame.faces[0].centre_x == 1400][2]
    assert next(point.at for point in path if point.x != centred_on(500)) > third + 0.5
    assert crop_at(path, 3.9) == centred_on(1400)


def test_the_tracker_starts_afresh_in_every_scene():
    # A was the target in the first scene; after the cut the larger B, though under the x3
    # stickiness that would have kept A, is followed from the start.
    a, b = face(500, 200), face(1400, 300)
    faces = sampled((2, [a])) + sampled((2, [a, b]), start=2)
    plan = tracked(faces, 4, [Scene(0, 2), Scene(2, 4)], Layout.TRACK)
    assert plan.scenes[1].panels[0].path == [CropPoint(2.0, centred_on(1400), 0)]


def test_a_tracked_plan_is_saved_and_read_back_as_json():
    plan = tracked(sampled((1, [face(700)]), (2, [face(1300)])), 3, [Scene(0, 1.5), Scene(1.5, 3)])
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Layouts per scene (ticket 14). The same 1920x1080 Source at 25 fps: a Split panel's crop is half the
# frame's width at 9:8 (960x854), and Blur shows the whole frame 1080x608 over its blurred centre crop.
SPLIT_CROP = (960, 854)
TOP, BOTTOM = Box(0, 0, 1080, 960), Box(0, 960, 1080, 960)


def people(count: int) -> list[Face]:
    """`count` faces side by side, 300 px apart."""
    return [face(300 + 300 * i, 200) for i in range(count)]


def layouts(plan: RenderPlan) -> list[tuple[float, float, SceneLayout]]:
    return [(scene.start, scene.end, scene.layout) for scene in plan.scenes]


@pytest.mark.parametrize(
    ("count", "layout"),
    [(0, SceneLayout.BLUR), (1, SceneLayout.TRACK), (2, SceneLayout.SPLIT), (3, SceneLayout.BLUR), (5, SceneLayout.BLUR)],
)
def test_each_scene_is_laid_out_by_its_number_of_faces(count, layout):
    [scene] = tracked(sampled((3, people(count))), 3).scenes
    assert scene.layout is layout
    if layout is SceneLayout.TRACK:
        [panel] = scene.panels
        assert (panel.area, panel.crop_width, panel.crop_height) == (Box(0, 0, 1080, 1920), 608, 1080)
    elif layout is SceneLayout.SPLIT:
        assert [(p.area, p.crop_width, p.crop_height) for p in scene.panels] == [(TOP, *SPLIT_CROP), (BOTTOM, *SPLIT_CROP)]
    else:
        # The blurred centre crop fills the frame; the whole shot, as wide as the frame, is centred on it.
        background, shot = scene.panels
        assert (background.area, background.crop_width, background.crop_height, background.blur) == (
            Box(0, 0, 1080, 1920), 608, 1080, True
        )
        assert background.path == [CropPoint(0.0, 656, 0)]
        assert (shot.area, shot.crop_width, shot.crop_height, shot.blur) == (Box(0, 656, 1080, 608), 1920, 1080, False)
        assert shot.path == [CropPoint(0.0, 0, 0)]


def test_the_face_count_comes_from_five_frames_spread_through_the_scene():
    # Two faces, but the detector misses one of them now and then: still Split.
    flaky = sampled(*[(0.6, people(2)), (2 * SAMPLE, people(1)), (SAMPLE, [])] * 4)
    assert layouts(tracked(flaky, 4.3)) == [(0.0, 4.3, SceneLayout.SPLIT)]
    # One face, joined by a second for half a second of the four: still Track.
    visit = sampled((1.5, people(1)), (0.5, people(2)), (2, people(1)))
    assert layouts(tracked(visit, 4)) == [(0.0, 4.0, SceneLayout.TRACK)]


def test_the_layout_override_applies_to_every_scene():
    # Scenes with no face, one face (joined by a second for a moment) and two faces.
    faces = sampled((2, None), (1.5, people(1)), (0.5, people(2)), (2, people(2)))
    scenes = [Scene(0, 2), Scene(2, 4), Scene(4, 6)]
    assert [s.layout for s in tracked(faces, 6, scenes).scenes] == ["blur", "track", "split"]
    for layout in (Layout.TRACK, Layout.SPLIT, Layout.BLUR):
        plan = tracked(faces, 6, scenes, layout)
        assert layouts(plan) == [(0, 2, layout.value), (2, 4, layout.value), (4, 6, layout.value)]

    # A forced Split of a scene with fewer than two faces shows the frame's left half on top and its
    # right half below, centred in height; with two faces, each panel is on its face.
    plan = tracked(faces, 6, scenes, Layout.SPLIT)
    for scene in plan.scenes[:2]:
        top, bottom = scene.panels
        assert (top.area, top.crop_width, top.crop_height, top.path) == (TOP, *SPLIT_CROP, [CropPoint(scene.start, 0, 112)])
        assert (bottom.area, bottom.path) == (BOTTOM, [CropPoint(scene.start, 960, 112)])
    # (The faces at 300 and 600 px: the left one's crop goes no further left than the frame's edge.)
    top, bottom = plan.scenes[2].panels
    assert (top.path[0].x, bottom.path[0].x) == (0, 600 - 480)


def test_scenes_under_a_second_are_merged_into_a_neighbour_before_layouts_are_chosen():
    # A 0.4 s opening shot, a 0.6 s two-face flash inside a close-up, and a 0.5 s tail.
    scenes = [Scene(0, 0.4), Scene(0.4, 3), Scene(3, 3.6), Scene(3.6, 6), Scene(6, 6.5)]
    faces = sampled((3, people(1)), (0.6, people(2)), (2.9, people(1)))
    plan = tracked(faces, 6.5, scenes)
    # The opening shot joins the one after it, the others the one before them.
    assert layouts(plan) == [(0.0, 3.6, SceneLayout.TRACK), (3.6, 6.5, SceneLayout.TRACK)]
    assert plan.scenes[1].panels[0].path[0].at == 3.6

    # Several short shots in a row add up into one scene; a Clip under a second stays one scene.
    plan = tracked(sampled((4, people(2))), 4, [Scene(0, 0.4), Scene(0.4, 0.8), Scene(0.8, 1.2), Scene(1.2, 4)])
    assert layouts(plan) == [(0.0, 1.2, SceneLayout.SPLIT), (1.2, 4.0, SceneLayout.SPLIT)]
    assert layouts(tracked(sampled((0.8, people(1))), 0.8, [Scene(0, 0.3), Scene(0.3, 0.8)])) == [
        (0.0, 0.8, SceneLayout.TRACK)
    ]


def test_split_puts_the_left_face_on_top_and_follows_each_face_with_its_own_camera():
    # The right face is seen first and larger; the left one walks 350 px further left over the scene.
    right = face(1350, 320)
    faces = [
        FrameFaces(round(k * SAMPLE, 3), [right, face(900 - min(350, 175 * k * SAMPLE), 260)])
        for k in range(int(4 / SAMPLE))
    ]
    [scene] = tracked(faces, 4).scenes
    assert scene.layout is SceneLayout.SPLIT
    top, bottom = scene.panels
    assert (top.area, bottom.area) == (TOP, BOTTOM)

    # Each crop starts and ends with its face inside it, the top one's on the left face.
    def centre_at(panel, at: float) -> float:
        return crop_at(panel.path, at) + panel.crop_width / 2

    assert centre_at(top, 0) == pytest.approx(900, abs=2)
    assert abs(centre_at(top, 3.9) - 550) <= CAMERA.dead_zone * SPLIT_CROP[0] / 2
    assert len(bottom.path) == 1 and centre_at(bottom, 0) == pytest.approx(1350, abs=2)
    xs = per_frame(top.path, 0, 4)
    assert all(b <= a for a, b in zip(xs, xs[1:])) and max(a - b for a, b in zip(xs, xs[1:])) <= MAX_STEP
    # The faces sit a little above the middle of their panels, leaving the seam clear.
    for panel, seen in ((top, faces[0].faces[1]), (bottom, right)):
        y = panel.path[0].y
        assert (seen.centre_y - y) / panel.crop_height == pytest.approx(0.4, abs=0.01)
        assert all(point.y == y for point in panel.path)


def test_a_portrait_source_is_passed_through_whatever_its_faces_or_automatic_layout():
    faces = sampled((2, people(2)), (2, people(1)))
    # (Manual frames it by hand: test_manual_layout.py.)
    for layout in (layout for layout in Layout if layout is not Layout.MANUAL):
        plan = plan_render(0, 4, source(1080, 1920), [Scene(0, 2), Scene(2, 4)], faces, layout, canvas=PORTRAIT)
        scene, panel = only_panel(plan)
        assert (scene.start, scene.end, scene.layout) == (0.0, 4.0, SceneLayout.PASSTHROUGH)
        assert (panel.area, panel.path) == (Box(0, 0, 1080, 1920), [CropPoint(0.0, 0, 0)])


def test_a_plan_with_every_layout_is_saved_and_read_back_as_json():
    plan = tracked(sampled((2, None), (2, people(1)), (2, people(2))), 6, [Scene(0, 2), Scene(2, 4), Scene(4, 6)])
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Captions (ticket 15). Words are given in seconds into the Clip, as the render queue maps them.
SEAM = 960
LOWER_THIRD = 1920 * 2 / 3


def said(text: str, start: float = 0.0, secs_per_char: float = 0.06, gap: float = 0.05) -> list[Word]:
    """`text`'s words spoken one after another from `start`, each lasting secs_per_char per letter."""
    words, at = [], start
    for token in text.split():
        end = at + secs_per_char * len(token)
        words.append(Word(token, round(at, 3), round(end, 3)))
        at = end + gap
    return words


def captioned(words: list[Word], secs: float, scenes: list[Scene] | None = None, faces: list[FrameFaces] | None = None,
              layout: Layout = Layout.AUTO, width: int = 1920, height: int = 1080) -> list[Cue]:
    return plan_render(100, 100 + secs, source(width, height, fps=FPS), scenes, faces, layout, words, canvas=PORTRAIT).captions


def shown(events: list[Cue]) -> list[str]:
    return [event.text for event in events]


def test_caption_lines_hold_at_most_16_characters_or_1_4_seconds_and_as_many_words_as_fit():
    talk = "jadi waktu itu kita lagi ngobrol soal bisnis keluarga yang ternyata ketidakberdayaannya luar biasa ya"
    events = captioned(said(talk), 12)
    for event in events:
        assert len(event.text) <= 16 or " " not in event.text, event.text
        assert event.end - event.start <= 1.4 + 1e-9
    # Every Word is shown once, in order, and each line takes as many as fit.
    assert " ".join(shown(events)) == talk.upper()
    for line, after in zip(events, events[1:]):
        first = after.words[0]
        assert len(f"{line.text} {first.text}") > 16 or first.start + 0.06 * len(first.text) - line.start > 1.4
    # A Word longer than a line stands alone.
    assert "KETIDAKBERDAYAANNYA" in shown(events)

    # A slow speaker's lines are cut by time: 0.6 s a Word.
    slow = [Word(text, 0.6 * i, 0.6 * i + 0.55) for i, text in enumerate("satu dua tiga empat lima".split())]
    assert shown(captioned(slow, 4)) == ["SATU DUA", "TIGA EMPAT", "LIMA"]
    # A single Word that goes on for longer still leaves the screen after 1.4 s.
    [long] = captioned([Word("halooo", 1.0, 3.5)], 4)
    assert (long.start, long.end, long.words) == (1.0, 2.4, [CaptionWord("HALOOO", 1.0, 2.4)])


def test_captions_are_uppercase_without_the_punctuation_at_the_ends_of_words():
    words = said('halo, semua. "kenapa?" gila?! main-main ... 50% dari 2,5 juta (iya)')
    assert shown(captioned(words, 10)) == ["HALO SEMUA", "KENAPA?", "GILA?!", "MAIN-MAIN 50%", "DARI 2,5 JUTA", "IYA"]
    # (A sentence's end ends a line: after SEMUA, KENAPA? and GILA?!; "..." alone shows nothing.)


def test_each_word_is_highlighted_from_when_it_is_spoken_until_the_next_one_is():
    words = [
        Word("Tadi,", -0.6, -0.2),  # in the margin before the Clip: left out
        Word("podcast", 0.35, 0.8),
        Word("ini", 0.8, 1.0),
        Word("seru", 1.05, 1.35),
        Word("banget,", 1.4, 1.75),
        Word("ya", 1.95, 2.25),
        Word("terus", 3.0, 3.3),  # after a pause: a new line
        Word("oke", 3.9, 4.3),  # its middle is past the Clip's end: left out
    ]
    events = captioned(words, 4)
    assert [(e.text, e.start, e.end) for e in events] == [
        ("PODCAST INI SERU", 0.35, 1.4),  # until the next line starts
        ("BANGET YA", 1.4, 2.55),  # 0.3 s after its last Word
        ("TERUS", 3.0, 3.6),
    ]
    assert [[(w.text, w.start, w.end) for w in e.words] for e in events] == [
        [("PODCAST", 0.35, 0.8), ("INI", 0.8, 1.05), ("SERU", 1.05, 1.4)],
        [("BANGET", 1.4, 1.95), ("YA", 1.95, 2.55)],
        [("TERUS", 3.0, 3.6)],
    ]
    # A pause of half a second starts a new line, however short the line.
    assert shown(captioned([Word("oke", 0.0, 0.3), Word("terus", 0.8, 1.1)], 4)) == ["OKE", "TERUS"]
    assert shown(captioned([Word("oke", 0.0, 0.3), Word("terus", 0.75, 1.1)], 4)) == ["OKE TERUS"]
    # A Word the Clip's start cuts into starts at 0, and nothing is captioned without Words.
    [cut] = captioned([Word("halo", -0.1, 0.3)], 4)
    assert (cut.start, cut.words) == (0.0, [CaptionWord("HALO", 0.0, 0.6)])
    assert captioned([], 4) == []


def caption_scenes() -> tuple[list[FrameFaces], list[Scene]]:
    """No face for 2 s (Blur), one face for 2 s (Track), then two faces for 2 s (Split)."""
    return sampled((2, None), (2, people(1)), (2, people(2))), [Scene(0, 2), Scene(2, 4), Scene(4, 6)]


def test_captions_sit_on_the_seam_in_split_and_in_the_lower_third_otherwise():
    faces, scenes = caption_scenes()
    words = said("satu dua", 0.5) + said("tiga empat", 2.5) + said("lima enam", 4.5)
    events = captioned(words, 6, scenes, faces)
    assert shown(events) == ["SATU DUA", "TIGA EMPAT", "LIMA ENAM"]
    blur, track, split = (event.area for event in events)
    assert blur == track
    assert track.y >= LOWER_THIRD
    assert track.y >= 656 + 608  # below Blur's shot
    assert split.y + split.height / 2 == SEAM and split.height <= 200  # clear of the faces, at 40% of each panel
    for area in (blur, split):
        assert area.x + area.width / 2 == 540  # centred
    # Forced layouts follow their layout; a portrait Source has its captions in the lower third.
    assert {e.area for e in captioned(words, 6, scenes, faces, Layout.SPLIT)} == {split}
    assert {e.area for e in captioned(words, 6, scenes, faces, Layout.TRACK)} == {track}
    assert {e.area for e in captioned(words, 6, width=1080, height=1920)} == {track}

    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, words=words, canvas=PORTRAIT)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


def test_a_caption_line_moves_where_the_layout_changes():
    faces, scenes = caption_scenes()
    lower, seam = (e.area for e in captioned(said("satu", 2.5) + said("dua", 4.5), 6, scenes, faces))
    # A line still on screen at the cut to Split moves to the seam there, its Word still highlighted.
    words = [Word("jadi", 3.4, 3.7), Word("begitu", 3.75, 4.1)]
    before, after = captioned(words, 6, scenes, faces)
    assert (before.text, before.start, before.end, before.area) == ("JADI BEGITU", 3.4, 4.0, lower)
    assert (after.text, after.start, after.end, after.area) == ("JADI BEGITU", 4.0, 4.4, seam)
    assert [(w.start, w.end) for w in before.words] == [(3.4, 3.75), (3.75, 4.0)]
    assert [(w.start, w.end) for w in after.words] == [(4.0, 4.0), (4.0, 4.4)]
    # A Word spoken after the cut starts a new line there, rather than joining one on the other side;
    # a line whose Words have all been spoken goes at the cut rather than moving.
    words = [Word("jadi", 3.6, 3.9), Word("gitu", 4.05, 4.3)]
    assert [(e.text, e.start, e.end, e.area) for e in captioned(words, 6, scenes, faces)] == [
        ("JADI", 3.6, 4.0, lower), ("GITU", 4.05, 4.6, seam)
    ]
    # A line spoken from just before the cut is shown at the seam from its start, not for a moment below.
    [line] = captioned([Word("nah", 3.9, 4.3)], 6, scenes, faces)
    assert (line.start, line.end, line.area, line.words) == (3.9, 4.6, seam, [CaptionWord("NAH", 3.9, 4.6)])
    # From Blur to Track the captions stay where they are: the line isn't cut.
    [line] = captioned([Word("jadi", 1.6, 1.9), Word("begitu", 1.95, 2.3)], 6, scenes, faces)
    assert (line.start, line.end, line.area) == (1.6, 2.6, lower)


def test_captions_stay_inside_the_safe_zones():
    faces, scenes = caption_scenes()
    words = said("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", 0.2, gap=0.2)
    plans = [captioned(words, 6, scenes, faces, layout) for layout in Layout]
    plans.append(captioned(words, 6, width=1080, height=1920))
    for events in plans:
        assert events
        for event in events:
            area = event.area
            assert area.y >= 0.12 * 1920, event
            assert area.y + area.height <= 0.8 * 1920, event
            assert area.x + area.width <= 0.88 * 1080, event
            assert area.x >= 0


# The hook (ticket 16).
HOOK = "Setetes racun bisa bunuh perusahaan?"
LONG_HOOK = "Racun kecil yang dibiarkan lama-lama pasti mematikan perusahaan kamu sendiri tanpa terasa"


def hooked(text: str, secs: float = 10, **options) -> HookEvent | None:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), hook=text, **{"canvas": PORTRAIT, **options}).hook


def widest(hook: HookEvent) -> float:
    return max(font_metrics().width(line, hook.size) for line in hook.lines)


def test_the_hook_is_shown_for_the_first_3_seconds_in_at_most_two_lines():
    hook = hooked(HOOK)
    assert (hook.lines, hook.start, hook.end, hook.size) == (["Setetes racun bisa", "bunuh perusahaan?"], 0.0, 3.0, HOOK_SIZE)
    # A Clip shorter than that shows it throughout.
    assert (hooked(HOOK, secs=2.4).start, hooked(HOOK, secs=2.4).end) == (0.0, 2.4)
    # Text that fits on one line stays on one; spaces are collapsed as Review saves them.
    assert hooked("  Kenapa   gagal? ").lines == ["Kenapa gagal?"]
    # Two lines are broken where the longer of them is shortest.
    lines = HOOK.split()
    breaks = [max(font_metrics().width(" ".join(part), HOOK_SIZE) for part in (lines[:i], lines[i:])) for i in range(1, 5)]
    assert widest(hook) == min(breaks)
    # Too long for two lines at the hook's size: still two, set smaller so that they just fit.
    long = hooked(LONG_HOOK)
    assert len(long.lines) == 2 and " ".join(long.lines) == LONG_HOOK
    assert long.size < HOOK_SIZE and hook_width(PORTRAIT) - 2 < widest(long) <= hook_width(PORTRAIT)
    # One Word wider than a line is set smaller on its own line.
    word = hooked("W" * 30)
    assert word.lines == ["W" * 30] and widest(word) <= hook_width(PORTRAIT)
    for hook in (hooked(HOOK), hooked("Kenapa gagal?")):
        assert widest(hook) <= hook_width(PORTRAIT) and hook.size == HOOK_SIZE
    # What Review asks: the lines, and whether they fit at the hook's size.
    assert fit_hook(HOOK, canvas=PORTRAIT) == (hooked(HOOK).lines, HOOK_SIZE)
    assert fit_hook(LONG_HOOK, canvas=PORTRAIT)[1] < HOOK_SIZE


def test_a_blank_hook_shows_nothing():
    for text in ("", "   ", "\n\t"):
        assert hooked(text) is None
        assert fit_hook(text, canvas=PORTRAIT) == ([], HOOK_SIZE)


def test_the_hook_sits_just_below_the_top_safe_zone_and_never_over_the_captions():
    faces, scenes = caption_scenes()
    words = said("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", 0.2, gap=0.2)
    plans = [
        plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, layout, words, text, canvas=PORTRAIT)
        for layout in Layout
        for text in ("Kenapa gagal?", HOOK, LONG_HOOK, "W" * 30)
    ]
    plans.append(plan_render(100, 106, source(1080, 1920, fps=FPS), words=words, hook=HOOK, canvas=PORTRAIT))
    # Every Layout's captions are there: the seam's band (Split) and the lower third.
    assert {e.area for plan in plans for e in plan.captions} == {PORTRAIT.seam_captions, PORTRAIT.lower_captions}
    for plan in plans:
        hook, area = plan.hook, plan.hook.area
        # Inside the safe zones, at the top just below the top one, centred like the captions.
        assert 0.12 * 1920 <= area.y <= 0.12 * 1920 + 2, hook
        assert area.x >= 130 and area.x + area.width <= 0.88 * 1080, hook
        assert abs(area.x + area.width / 2 - 540) <= 0.5, hook
        # The box holds its lines, padded; two lines at most.
        assert 1 <= len(hook.lines) <= 2
        assert area.width >= widest(hook) + 2 * HOOK_PAD_X
        # Clear of every caption, in every Layout: above the highest the captions go.
        assert area.y + area.height <= PORTRAIT.seam_captions.y, hook
        for event in plan.captions:
            caption = event.area
            assert area.y + area.height <= caption.y or caption.y + caption.height <= area.y, (hook, event)
    # As short as its lines allow: one line takes a lower box than two.
    one, two = hooked("Kenapa gagal?").area, hooked(HOOK).area
    assert one.height < two.height <= 200

    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, words=words, hook=HOOK, canvas=PORTRAIT)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Caption and Hook Styles (clip editor ticket 01). The defaults are v1's, which the tests above check.


def styled(words: list[Word], secs: float, style: CaptionStyle, **options) -> list[Cue]:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), words=words, caption_style=style, **{"canvas": PORTRAIT, **options}).captions


def test_caption_lines_are_broken_by_the_styles_limits():
    talk = "jadi waktu itu kita lagi ngobrol soal bisnis keluarga yang ternyata luar biasa ya"
    words = said(talk)
    # Longer lines: every Word still shown once, in order, and each line as full as 30 characters allow.
    wide = styled(words, 12, CaptionStyle(max_chars=30, max_secs=5))
    assert " ".join(shown(wide)) == talk.upper()
    assert all(len(event.text) <= 30 for event in wide)
    assert len(wide) < len(captioned(words, 12))
    for line, after in zip(wide, wide[1:]):
        assert len(f"{line.text} {after.words[0].text}") > 30
    # At most two Words a line, however short they are.
    two = styled(said("a b c d e f g"), 4, CaptionStyle(max_words=2))
    assert shown(two) == ["A B", "C D", "E F", "G"]
    # By time: 0.6 s a Word, at most 1.2 s a line.
    slow = [Word(text, 0.6 * i, 0.6 * i + 0.55) for i, text in enumerate("satu dua tiga empat lima".split())]
    assert shown(styled(slow, 4, CaptionStyle(max_secs=1.0))) == ["SATU", "DUA", "TIGA", "EMPAT", "LIMA"]
    # A pause of 0.3 s starts a line when the style says 0.25 s does.
    paused = [Word("halo", 0.0, 0.4), Word("semua", 0.7, 1.1)]
    assert shown(styled(paused, 3, CaptionStyle())) == ["HALO SEMUA"]
    assert shown(styled(paused, 3, CaptionStyle(pause_secs=0.25))) == ["HALO", "SEMUA"]


def test_captions_keep_the_words_case_when_the_style_isnt_uppercase():
    words = said('Halo, semua. "Kenapa?" iPhone 50%')
    assert shown(styled(words, 10, CaptionStyle(uppercase=False))) == ["Halo semua", "Kenapa?", "iPhone 50%"]


def test_captions_go_where_the_style_puts_them_in_every_layout():
    faces, scenes = caption_scenes()
    words = said("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", 0.2, gap=0.2)

    def areas(style: CaptionStyle) -> set[Box]:
        return {event.area for event in styled(words, 6, style, scenes=scenes, faces=faces)}

    assert areas(CaptionStyle()) == {PORTRAIT.seam_captions, PORTRAIT.lower_captions}
    assert areas(CaptionStyle(position=CaptionPosition.TOP)) == {PORTRAIT.top_captions}
    assert areas(CaptionStyle(position=CaptionPosition.MIDDLE)) == {PORTRAIT.seam_captions}
    assert areas(CaptionStyle(position=CaptionPosition.BOTTOM)) == {PORTRAIT.lower_captions}
    # A custom height is the line's centre, kept inside the safe area.
    [custom] = areas(CaptionStyle(position=CaptionPosition.CUSTOM, y=700))
    assert custom == Box(130, 600, 820, 200)
    for y, top in ((0, PORTRAIT.safe_area.y), (1920, PORTRAIT.safe_area.y + PORTRAIT.safe_area.height - 200)):
        assert areas(CaptionStyle(position=CaptionPosition.CUSTOM, y=y)) == {Box(130, top, 820, 200)}
    # Where every line goes to one place, a Layout change doesn't move or cut a line.
    one_place = styled(words, 6, CaptionStyle(position=CaptionPosition.BOTTOM), scenes=scenes, faces=faces)
    assert shown(one_place) == shown(captioned(words, 6))
    # Top captions stay below a two-line hook at the top.
    assert PORTRAIT.top_captions.y >= hooked(LONG_HOOK).area.y + hooked(LONG_HOOK).area.height


def test_a_caption_line_too_wide_for_its_area_is_set_smaller_at_the_styles_size():
    [fits] = styled([Word("halo", 0.0, 0.5)], 2, CaptionStyle(size=130))
    assert fits.size == 130
    [wide] = styled([Word("W" * 15, 0.0, 0.5)], 2, CaptionStyle(size=130, outline=10))
    assert wide.size < 130
    assert font_metrics().width(wide.text, wide.size) + 20 <= wide.area.width
    assert font_metrics().width(wide.text, wide.size + 0.2) + 20 > wide.area.width


def test_the_hook_goes_where_its_style_puts_it_at_its_size():
    top = hooked(HOOK)
    assert top.area.y == PORTRAIT.safe_area.y
    middle = hooked(HOOK, hook_style=HookStyle(position=HookPosition.MIDDLE)).area
    assert abs(middle.y + middle.height / 2 - 960) <= 1
    bottom = hooked(HOOK, hook_style=HookStyle(position=HookPosition.BOTTOM)).area
    assert bottom.y + bottom.height == PORTRAIT.safe_area.y + PORTRAIT.safe_area.height
    assert hooked(HOOK, hook_style=HookStyle(position=HookPosition.CUSTOM, y=700)).area.y == 700
    clamped = hooked(HOOK, hook_style=HookStyle(position=HookPosition.CUSTOM, y=1900)).area
    assert clamped.y + clamped.height == PORTRAIT.safe_area.y + PORTRAIT.safe_area.height
    # A smaller size: the same lines in a smaller box, and the text fits at that size.
    small = hooked(HOOK, hook_style=HookStyle(size=60))
    assert small.size == 60 and small.area.width < top.area.width and small.area.height < top.area.height
    assert fit_hook(HOOK, HookStyle(size=60), canvas=PORTRAIT) == (small.lines, 60)
    # Too large for two lines: set smaller than the style's size.
    assert fit_hook(LONG_HOOK, HookStyle(size=120), canvas=PORTRAIT)[1] < 120


def test_the_plan_keeps_its_styles():
    caption, hook = CaptionStyle(colour="#FFE600", highlight=Highlight.BOX), HookStyle(box_opacity=1.0)
    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), words=said("halo semua"), hook=HOOK,
                       caption_style=caption, hook_style=hook, canvas=PORTRAIT)
    assert (plan.caption_style, plan.hook_style) == (caption, hook)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Word Edits (clip editor ticket 06). Their times are in seconds into the Clip, as candidate_plan gives them.


def edited(words: list[Word], edits: list, secs: float = 10, **options) -> list[Cue]:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), words=words, word_edits=edits, **{"canvas": PORTRAIT, **options}).captions


def test_a_word_edit_replaces_or_removes_its_word_keeping_its_timing():
    words = said("gue pernah rugi lima ratus juta")
    rugi, lima = words[2], words[3]
    lines = edited(words, [WordEdit(at=(rugi.start + rugi.end) / 2, text="Hermanto,"), WordEdit(at=lima.start, text="")])
    assert " ".join(shown(lines)) == "GUE PERNAH HERMANTO RATUS JUTA"
    # The new text keeps the Word's timing and highlight: HERMANTO from when "rugi" was said.
    word = next(w for line in lines for w in line.words if w.text == "HERMANTO")
    assert word.start == rugi.start
    # A Word kept as it is: text None.
    assert shown(edited(words, [WordEdit(at=rugi.start, text=None)])) == shown(captioned(words, 10))


def test_a_word_edit_can_start_a_line():
    words = said("satu dua tiga empat")
    assert shown(captioned(words, 5)) == ["SATU DUA TIGA", "EMPAT"]
    assert shown(edited(words, [WordEdit(at=words[1].start + 0.01, break_before=True)], 5)) == ["SATU", "DUA TIGA EMPAT"]


def test_an_edit_matches_the_word_holding_its_time_or_the_nearest_within_a_quarter_second():
    words = [Word("halo", 1.0, 1.4), Word("semua", 2.0, 2.4)]
    assert match_edits(words, [WordEdit(at=1.2, text="a")])[0].text == "a"
    # In the gap: the nearer Word within 0.25 s; further away, none.
    assert [e and e.text for e in match_edits(words, [WordEdit(at=1.6, text="b")])] == ["b", None]
    assert [e and e.text for e in match_edits(words, [WordEdit(at=1.85, text="c")])] == [None, "c"]
    assert match_edits(words, [WordEdit(at=1.7, text="d")]) == [None, None]
    assert match_edits(words, [WordEdit(at=9.0, text="e")]) == [None, None]
    # Of two edits of one Word, the later.
    assert match_edits(words, [WordEdit(at=1.1, text="x"), WordEdit(at=1.3, text="y")])[0].text == "y"


def test_word_edits_survive_a_new_transcription_with_slightly_different_timings():
    first = said("gue pernah rugi lima ratus juta")
    edit = WordEdit(at=(first[2].start + first[2].end) / 2, text="untung")
    # Transcribed again, each Word 80 ms later and a little shorter.
    again = [Word(w.text, w.start + 0.08, w.end + 0.04) for w in first]
    assert "UNTUNG" in " ".join(shown(edited(again, [edit])))
    assert "RUGI" not in " ".join(shown(edited(again, [edit])))


def test_edited_text_is_shown_like_a_words_in_capitals_without_end_punctuation_unless_the_style_keeps_case():
    words = said("halo semua")
    edit = WordEdit(at=words[1].start, text="ka-wan!")
    assert shown(edited(words, [edit])) == ["HALO KA-WAN!"]
    assert shown(edited(words, [edit], caption_style=CaptionStyle(uppercase=False))) == ["halo ka-wan!"]
    assert shown(edited(words, [WordEdit(at=words[1].start, text="...")])) == ["HALO"]


# Cues (captions-advanced ticket 01): each caption of the plan is a Cue.


def test_a_cue_is_one_line_keyed_by_the_middle_of_its_first_word_on_the_sources_timeline():
    words = [Word("halo,", 1.0, 1.4), Word("semua.", 1.4, 2.0), Word("apa", 3.0, 3.2), Word("kabar", 3.2, 3.6)]
    cues = captioned(words, 5)  # the Clip from 100 s of the Source
    assert [[[(w.text, w.start, w.end) for w in line] for line in cue.lines] for cue in cues] == [
        [[("HALO", 1.0, 1.4), ("SEMUA", 1.4, 2.3)]],
        [[("APA", 3.0, 3.2), ("KABAR", 3.2, 3.9)]],
    ]
    assert [(cue.key.at, cue.key.media, cue.edited) for cue in cues] == [(101.2, None, False), (103.1, None, False)]
    # A Word the Clip's start cuts into keys its Cue by its own middle.
    [cut] = captioned([Word("halo", -0.1, 0.3)], 4)
    assert cut.key.at == 100.1
    # A Cue moved at a Layout change is shown in two places, keyed alike.
    faces, scenes = caption_scenes()
    before, after = captioned([Word("jadi", 3.4, 3.7), Word("begitu", 3.75, 4.1)], 6, scenes, faces)
    assert before.area != after.area and before.key == after.key
    assert before.key.at == 103.55


def test_a_segments_cues_are_keyed_on_the_sources_timeline_whatever_its_speed():
    first = SegmentInput(10.0, 12.0, words=[Word("satu", 0.2, 0.6)])
    sped = SegmentInput(50.0, 54.0, words=[Word("dua", 1.0, 1.4), Word("tiga", 2.6, 3.0)], speed=2.0)
    cues = plan_render(10, 54, source(1920, 1080, fps=FPS), main_track=[first, sped], canvas=PORTRAIT).captions
    assert [(cue.text, cue.start, cue.key.at) for cue in cues] == [("SATU", 0.2, 10.4), ("DUA", 2.5, 51.2), ("TIGA", 3.3, 52.8)]


def test_a_cues_plain_lines_keep_the_words_case_and_punctuation_with_word_edits_applied():
    words = said('Halo, semua! "Kenapa?" gue😂 rugi lima')
    rugi, lima = words[4], words[5]
    cues = edited(words, [WordEdit(at=rugi.start, text="Hermanto,"), WordEdit(at=lima.start, text="")])
    assert shown(cues) == ["HALO SEMUA!", "KENAPA?", "GUE HERMANTO"]
    assert [cue.plain for cue in cues] == [["Halo, semua!"], ['"Kenapa?"'], ["gue😂 Hermanto,"]]
    # The Caption Style's case doesn't change them.
    kept = edited(words, [], caption_style=CaptionStyle(uppercase=False))
    assert [cue.plain for cue in kept][:2] == [["Halo, semua!"], ['"Kenapa?"']]


def test_a_cue_is_joinable_when_merging_it_into_the_one_before_would_fit_the_line_limits():
    # Parted by a pause, and by a sentence's end, each fitting one line with the one before.
    words = [Word("oke", 0.0, 0.3), Word("terus.", 1.0, 1.3), Word("ya", 1.4, 1.6), Word("ketidakberdayaannya", 2.5, 3.0)]
    cues = captioned(words, 4)
    assert shown(cues) == ["OKE", "TERUS", "YA", "KETIDAKBERDAYAANNYA"]
    # The first has none before it; YA KETIDAKBERDAYAANNYA is longer than 16 characters.
    assert [cue.joinable for cue in cues] == [False, True, True, False]
    # Nor when together they hold more Words than the style's max_words.
    one = styled(words[:2], 4, CaptionStyle(max_words=1))
    assert [cue.joinable for cue in one] == [False, False]


def test_cues_either_side_of_a_cut_or_a_layout_change_are_not_joinable():
    parts = [SegmentInput(10.0, 11.0, words=[Word("satu", 0.2, 0.6)]), SegmentInput(20.0, 21.0, words=[Word("dua", 0.1, 0.4)])]
    cues = plan_render(10, 21, source(1920, 1080, fps=FPS), main_track=parts, canvas=PORTRAIT).captions
    assert shown(cues) == ["SATU", "DUA"]
    assert [cue.joinable for cue in cues] == [False, False]
    faces, scenes = caption_scenes()
    cues = captioned([Word("jadi", 3.6, 3.9), Word("gitu", 4.05, 4.3)], 6, scenes, faces)
    assert shown(cues) == ["JADI", "GITU"]
    assert [cue.joinable for cue in cues] == [False, False]


# Hook timing (clip editor ticket 07).


def test_the_hook_shows_from_its_start_for_its_time_kept_in_the_clip():
    assert (hooked(HOOK).start, hooked(HOOK).end) == (0.0, 3.0)
    late = hooked(HOOK, hook_start=2.5, hook_secs=4)
    assert (late.start, late.end) == (2.5, 6.5)
    # Cut at the Clip's end; none when it would start at or after it.
    assert (hooked(HOOK, secs=5, hook_start=3, hook_secs=4).end) == 5.0
    assert hooked(HOOK, secs=5, hook_start=5) is None
    assert hooked(HOOK, secs=5, hook_start=7) is None
    # Where and how large doesn't depend on when.
    assert late.area == hooked(HOOK).area and late.lines == hooked(HOOK).lines


# Layout Overrides (clip editor ticket 09). Their times are in seconds into the Clip.


def overridden(overrides: list, layout: Layout = Layout.AUTO, secs: float = 6, words: list[Word] | None = None) -> RenderPlan:
    faces, scenes = caption_scenes()
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), scenes, faces, layout, words, layout_overrides=overrides, canvas=PORTRAIT)


def test_a_layout_override_changes_only_the_scene_holding_it():
    assert [s.layout for s in overridden([]).scenes] == ["blur", "track", "split"]
    assert [s.layout for s in overridden([LayoutOverride(3.0, Layout.BLUR)]).scenes] == ["blur", "blur", "split"]
    # At a cut, the Scene starting there; the last of several in one Scene.
    assert [s.layout for s in overridden([LayoutOverride(4.0, Layout.TRACK)]).scenes] == ["blur", "track", "track"]
    two = [LayoutOverride(0.5, Layout.SPLIT), LayoutOverride(1.5, Layout.TRACK)]
    assert [s.layout for s in overridden(two).scenes] == ["track", "track", "split"]
    # Outside the Clip: nothing.
    assert [s.layout for s in overridden([LayoutOverride(-1, Layout.TRACK), LayoutOverride(9, Layout.TRACK)]).scenes] == [
        "blur", "track", "split"
    ]


def test_a_layout_override_works_with_the_candidates_layout_forced_and_auto_chooses_by_faces():
    forced = overridden([LayoutOverride(5.0, Layout.BLUR)], Layout.TRACK)
    assert [s.layout for s in forced.scenes] == ["track", "track", "blur"]
    by_faces = overridden([LayoutOverride(5.0, Layout.AUTO)], Layout.TRACK)
    assert [s.layout for s in by_faces.scenes] == ["track", "track", "split"]


def test_captions_move_with_a_scenes_overridden_layout():
    words = said("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", 0.2, gap=0.2)
    plan = overridden([LayoutOverride(3.0, Layout.SPLIT)], words=words)
    areas = {(event.start >= 2 and event.end <= 4, event.area) for event in plan.captions}
    assert (True, PORTRAIT.seam_captions) in areas and (True, PORTRAIT.lower_captions) not in areas


# Hook Shapes, alignment and lines (hook-styles ticket 01).
HEADLINE = "Orang kantoran pasti iri anak SMP ini cuan enam juta dari bikin satu video klip di ternakklip"


def test_the_hook_takes_up_to_its_styles_max_lines_balanced_before_it_is_set_smaller():
    two = hooked(HEADLINE)
    assert len(two.lines) == 2 and two.size < HOOK_SIZE
    four = hooked(HEADLINE, hook_style=HookStyle(max_lines=4))
    assert " ".join(four.lines) == HEADLINE and four.size == HOOK_SIZE
    # The fewest lines that fit: three are too wide at 88, so four, as even as they can be.
    assert len(four.lines) == 4
    assert widest(four) <= hook_width(PORTRAIT)
    assert widest(four) - min(font_metrics().width(line, HOOK_SIZE) for line in four.lines) < 260
    # Short text stays on one line, and one line never breaks.
    assert hooked("Kenapa gagal?", hook_style=HookStyle(max_lines=4)).lines == ["Kenapa gagal?"]
    one = hooked(HOOK, hook_style=HookStyle(max_lines=1))
    assert one.lines == [HOOK] and one.size < HOOK_SIZE
    assert fit_hook(HEADLINE, HookStyle(max_lines=4), canvas=PORTRAIT) == (four.lines, HOOK_SIZE)


def test_a_hook_in_capitals_is_fitted_in_capitals():
    hook = hooked(HOOK, hook_style=HookStyle(uppercase=True))
    assert hook.lines == ["SETETES RACUN BISA", "BUNUH PERUSAHAAN?"]
    assert widest(hook) <= hook_width(PORTRAIT)


def text_edges(hook: HookEvent) -> list[tuple[float, float]]:
    """Each line's text, from its left edge to its right, as placed by its anchor."""
    return [
        (x - font_metrics().width(line, hook.size) / 2, x + font_metrics().width(line, hook.size) / 2)
        for line, (x, _) in zip(hook.lines, hook.anchors)
    ]


def test_a_block_hook_draws_one_box_holding_its_centred_lines():
    hook = hooked(HOOK)
    assert hook.boxes == [hook.area]
    assert [x for x, _ in hook.anchors] == [hook.area.x + hook.area.width / 2] * 2
    first, second = (baseline for _, baseline in hook.anchors)
    assert hook.area.y < first < second < hook.area.y + hook.area.height
    assert second - first == pytest.approx(0.82 * hook.size)


def test_strips_put_a_box_behind_each_line_as_wide_as_it_one_under_the_other():
    block = hooked(HOOK)
    hook = hooked(HOOK, hook_style=HookStyle(shape=HookShape.STRIPS))
    assert hook.lines == block.lines and len(hook.boxes) == 2
    for (left, right), box, (_, baseline) in zip(text_edges(hook), hook.boxes, hook.anchors):
        assert box.x < left and right < box.x + box.width < right + 0.6 * hook.size
        assert box.y < baseline < box.y + box.height
        assert abs(box.x + box.width / 2 - 540) <= 1
    upper, lower = hook.boxes
    assert upper.y + upper.height < lower.y < upper.y + upper.height + 0.1 * hook.size
    assert upper.width != lower.width
    # The area holds the strips and nothing more, at the top of the safe area.
    assert hook.area == Box(min(b.x for b in hook.boxes), PORTRAIT.safe_area.y, max(b.width for b in hook.boxes), lower.y + lower.height - upper.y)


def test_a_hook_without_a_box_is_set_like_a_block_with_nothing_behind_it():
    block = hooked(HOOK)
    bare = hooked(HOOK, hook_style=HookStyle(shape=HookShape.NONE))
    assert bare.boxes == []
    assert (bare.lines, bare.anchors, bare.area) == (block.lines, block.anchors, block.area)


def test_left_aligned_lines_start_together_and_the_hook_stays_centred():
    for shape in HookShape:
        hook = hooked(HOOK, hook_style=HookStyle(shape=shape, align=HookAlign.LEFT))
        lefts = [left for left, _ in text_edges(hook)]
        assert max(lefts) - min(lefts) < 1, shape
        assert abs(hook.area.x + hook.area.width / 2 - 540) <= 1, shape
        if shape is HookShape.STRIPS:
            assert len({box.x for box in hook.boxes}) == 1
        assert all(hook.area.x <= box.x and box.x + box.width <= hook.area.x + hook.area.width for box in hook.boxes)


# Emphasis, and emoji (hook-styles ticket 02).


def emphasised(hook: HookEvent) -> list[list[str]]:
    """Each line's emphasised text."""
    return [[line[start:end] for start, end in spans] for line, spans in zip(hook.lines, hook.emphasis)]


def test_words_between_asterisks_are_emphasised_and_the_asterisks_arent_shown():
    hook = hooked("Orang kantoran *pasti iri!* anak SMP ini cuan *6 juta*", hook_style=HookStyle(max_lines=3))
    assert " ".join(hook.lines) == "Orang kantoran pasti iri! anak SMP ini cuan 6 juta"
    # A run is the whole emphasised phrase, the space inside it included.
    assert emphasised(hook) == [["pasti iri!"], ["6 juta"]]
    assert hook.emphasis == [[(15, 25)], [(18, 24)]]
    # Fitted without the asterisks: as wide as the same text unmarked.
    plain = hooked("Orang kantoran pasti iri! anak SMP ini cuan 6 juta", hook_style=HookStyle(max_lines=3))
    assert (hook.lines, hook.size, hook.anchors) == (plain.lines, plain.size, plain.anchors)
    assert plain.emphasis == [[] for _ in plain.lines]
    assert fit_hook("Kenapa *gagal?*", canvas=PORTRAIT) == (["Kenapa gagal?"], HOOK_SIZE)


def test_emphasis_can_cover_part_of_a_word_and_an_unpaired_asterisk_is_shown():
    assert emphasised(hooked("Super*man* datang")) == [["man"]]
    hook = hooked("Diskon *50% hari ini")
    assert hook.lines == ["Diskon *50% hari ini"] and emphasised(hook) == [[]]
    # An empty pair is nothing.
    assert hooked("Halo ** semua").lines == ["Halo semua"]
    # Capitals keep the emphasis.
    assert emphasised(hooked("Ini *rahasia* kita", hook_style=HookStyle(uppercase=True))) == [["RAHASIA"]]


def test_emoji_are_left_out_of_the_hook():
    hook = hooked("Rahasia clipper pro 😱😱 bisa viral 🤔 tiap hari 👍🏽 ❤️")
    assert " ".join(hook.lines) == "Rahasia clipper pro bisa viral tiap hari"
    assert hooked("😱🔥") is None
    assert hooked("50% *off* ✨").lines == ["50% off"]


# The Kicker (hook-styles ticket 03).


def kicked(kicker: str, text: str = HOOK, **style) -> HookEvent:
    return hooked(text, hook_kicker=kicker, hook_style=HookStyle(**style))


def test_a_kicker_sits_in_its_pill_above_the_hook_which_moves_down_to_make_room():
    plain, hook = hooked(HOOK), kicked("Terbongkar!")
    kicker = hook.kicker
    assert (kicker.text, kicker.size) == ("Terbongkar!", pytest.approx(0.8 * HOOK_SIZE))
    # At the top of the hook, which still starts just below the top safe zone.
    assert hook.area.y == kicker.box.y == PORTRAIT.safe_area.y
    # The lines and their box are as before, lower by the pill and a gap of a quarter of the hook's size.
    [box] = hook.boxes
    assert box.y - (kicker.box.y + kicker.box.height) == round(0.25 * HOOK_SIZE)
    assert hook.lines == plain.lines and (box.width, box.height) == (plain.area.width, plain.area.height)
    assert hook.area.y + hook.area.height == box.y + box.height
    # The pill is centred over the lines, as wide as its padded text, and holds it.
    x, baseline = kicker.anchor
    width = font_metrics().width("Terbongkar!", kicker.size)
    assert abs(kicker.box.x + kicker.box.width / 2 - (box.x + box.width / 2)) <= 1 and x == kicker.box.x + kicker.box.width / 2
    assert width < kicker.box.width < width + 1.2 * kicker.size
    # Its letters, from the capitals' top to the descenders' bottom, are in the middle of the pill.
    metrics = font_metrics()
    above = baseline - metrics.cap_height / metrics.units * kicker.size - kicker.box.y
    below = kicker.box.y + kicker.box.height - (baseline + metrics.descent / metrics.units * kicker.size)
    assert above > 0 and abs(above - below) <= 1
    # No Kicker: v1's hook.
    assert hooked(HOOK, hook_kicker="  ").kicker is None and hooked(HOOK, hook_kicker="  ") == plain


def test_a_kicker_is_set_the_same_with_any_shape_and_a_quote_mark():
    for shape in ("block", "strips", "none"):
        for quote in (False, True):
            hook = kicked("Fakta", shape=shape, quote=quote)
            x, baseline = hook.kicker.anchor
            assert baseline - hook.kicker.box.y == pytest.approx(kicked("Fakta").kicker.anchor[1] - kicked("Fakta").kicker.box.y)


def test_a_kicker_follows_the_hooks_alignment_case_and_position_and_has_no_emoji():
    for shape in ("block", "strips"):
        hook = kicked("fakta 🔥", shape=shape, align="left", uppercase=True)
        assert hook.kicker.text == "FAKTA" and hook.kicker.box.x == hook.boxes[0].x
    bare = kicked("pov", shape="none", align="left")
    left = bare.anchors[0][0] - font_metrics().width(bare.lines[0], bare.size) / 2
    assert abs(bare.kicker.box.x - left) < 1
    bottom = kicked("Fakta", position="bottom").area
    assert bottom.y + bottom.height == PORTRAIT.safe_area.y + PORTRAIT.safe_area.height
    middle = kicked("Fakta", position="middle").area
    assert abs(middle.y + middle.height / 2 - 960) <= 1
    # Too wide for the captions' width: set smaller to fit.
    wide = kicked("W" * 24).kicker
    assert wide.size < 0.8 * HOOK_SIZE and wide.box.width <= 820


# The Quote Mark (hook-styles ticket 04).


def contains(outer: Box, inner: Box) -> bool:
    return (
        outer.x <= inner.x and inner.x + inner.width <= outer.x + outer.width
        and outer.y <= inner.y and inner.y + inner.height <= outer.y + outer.height
    )


def test_a_quote_mark_overlaps_the_first_boxs_corner_within_its_padding_clear_of_the_text():
    assert hooked(HOOK).quote is None
    for shape, pad_x, pad_y in (("block", HOOK_PAD_X, 26), ("strips", 0.25 * HOOK_SIZE, 0.14 * HOOK_SIZE)):
        for align in ("center", "left"):
            hook = hooked(HOOK, hook_style=HookStyle(shape=shape, align=align, quote=True))
            badge, first = hook.quote, hook.boxes[0]
            assert badge.width == badge.height == round(0.9 * HOOK_SIZE)
            # Over the corner, reaching no further into the box than its padding.
            assert badge.x < first.x < badge.x + badge.width <= first.x + pad_x
            assert badge.y < first.y < badge.y + badge.height <= first.y + pad_y
            assert contains(hook.area, badge) and hook.area.y == badge.y == PORTRAIT.safe_area.y
            # The lines stay centred in the frame, and as they were, lower by what sticks out above.
            plain = hooked(HOOK, hook_style=HookStyle(shape=shape, align=align))
            assert [x for x, _ in hook.anchors] == [x for x, _ in plain.anchors]
            assert first.y == plain.boxes[0].y + first.y - badge.y
    # No box: just above and left of the first line's text.
    bare = hooked(HOOK, hook_style=HookStyle(shape="none", quote=True))
    x, baseline = bare.anchors[0]
    left = x - font_metrics().width(bare.lines[0], bare.size) / 2
    cap = font_metrics().cap_height / font_metrics().units * bare.size
    assert bare.quote.x + bare.quote.width <= left + 1 and bare.quote.y + bare.quote.height <= baseline - cap + 1
    assert left - (bare.quote.x + bare.quote.width) < 2 and contains(bare.area, bare.quote)


def test_a_quote_mark_stays_clear_of_the_kicker_and_inside_the_safe_area():
    hook = kicked("Fakta", quote=True, align="left")
    assert hook.quote.y >= hook.kicker.box.y + hook.kicker.box.height
    for position in ("top", "middle", "bottom"):
        area = kicked("Fakta", quote=True, position=position).area
        assert PORTRAIT.safe_area.y <= area.y and area.y + area.height <= PORTRAIT.safe_area.y + PORTRAIT.safe_area.height
    wide = hooked(LONG_HOOK, hook_style=HookStyle(quote=True))
    assert wide.quote.x >= 0 and wide.boxes[0].x + wide.boxes[0].width <= PORTRAIT.safe_area.x + PORTRAIT.safe_area.width


# Fixes from the hook-styles review.


def test_a_long_kicker_over_left_aligned_bare_text_stays_inside_the_safe_area():
    hook = kicked("W" * 24, shape="none", align="left")
    assert hook.kicker.box.x + hook.kicker.box.width <= PORTRAIT.safe_area.x + PORTRAIT.safe_area.width
    assert hook.area.x + hook.area.width <= PORTRAIT.safe_area.x + PORTRAIT.safe_area.width


def test_every_pictograph_is_left_out_but_text_symbols_stay():
    assert hooked("hi ⏰ ‼ ▶ ✅ 😀 ⬆ ⭐ ↔ ⌚").lines == ["hi"]
    assert hooked("Merek® dan © 2024™").lines == ["Merek® dan © 2024™"]


def test_emphasis_stays_on_its_letters_when_capitals_lengthen_a_word():
    hook = hooked("Das *groß* ist", hook_style=HookStyle(uppercase=True))
    assert hook.lines == ["DAS GROSS IST"] and emphasised(hook) == [["GROSS"]]


# Placed on the preview (preview-direct-edit ticket 01).


def shifted(box: Box, dx: int) -> Box:
    return Box(box.x + dx, box.y, box.width, box.height)


def test_the_hook_is_centred_on_its_styles_x_with_everything_in_it_moved_along():
    for style in ({}, {"quote": True}, {"shape": "strips", "align": "left"}):
        centred = hooked(HOOK, hook_kicker="Fakta", hook_style=HookStyle(**style))
        moved = hooked(HOOK, hook_kicker="Fakta", hook_style=HookStyle(x=400, **style))
        # Its middle (the Quote Mark's badge included) at x.
        assert abs(moved.area.x + moved.area.width / 2 - 400) <= 1
        dx = moved.area.x - centred.area.x
        assert moved.area == shifted(centred.area, dx) and moved.boxes == [shifted(b, dx) for b in centred.boxes]
        assert moved.anchors == [(x + dx, y) for x, y in centred.anchors]
        assert moved.kicker.box == shifted(centred.kicker.box, dx)
        assert moved.kicker.anchor == (centred.kicker.anchor[0] + dx, centred.kicker.anchor[1])
        assert moved.quote == (centred.quote and shifted(centred.quote, dx))
        assert moved.lines == centred.lines and moved.size == centred.size


def test_the_hook_is_kept_in_the_frame_whatever_its_x():
    for x, edge in ((0, "left"), (1080, "right")):
        area = hooked(HOOK, hook_style=HookStyle(x=x)).area
        assert (area.x == 0) if edge == "left" else (area.x + area.width == 1080)
    # Without an x, its lines are centred in the frame, as before; at 540, so is a hook without a badge.
    assert hooked(HOOK, hook_style=HookStyle(x=540)) == hooked(HOOK)


def test_caption_lines_are_centred_on_the_styles_x_and_kept_in_the_frame():
    words = said("halo semua apa kabar")
    for position in (CaptionPosition.AUTO, CaptionPosition.CUSTOM):
        centred = styled(words, 4, CaptionStyle(position=position, y=700))
        moved = styled(words, 4, CaptionStyle(position=position, y=700, x=400))
        # The same lines at the same size, in an area as wide, its middle at x.
        assert shown(moved) == shown(centred) and [e.size for e in moved] == [e.size for e in centred]
        assert [e.area for e in moved] == [shifted(e.area, -140) for e in centred]
    # At an edge, a line is moved in until it (with its outline) is in the frame.
    style = CaptionStyle(x=1080, outline=7)
    for event in styled(words, 4, style):
        width = font_metrics().width(event.text, event.size) + 2 * style.outline
        centre = event.area.x + event.area.width / 2
        assert abs(centre + width / 2 - 1080) <= 1
    assert styled(words, 4, CaptionStyle(x=540)) == styled(words, 4, CaptionStyle(x=None)) == styled(words, 4, CaptionStyle())


# Tracking and line height on the Hook and Caption Styles (text-advanced 13). At their defaults the
# tests above hold, and tests/test_styles.py checks that every built-in Preset plans as before.


def test_a_tracked_hook_is_fitted_counting_its_tracking():
    metrics = font_metrics()
    # One line at 88, 570 px wide; with 12 px after each of its 18 characters but the last, too wide.
    text = "Jangan lakukan ini"
    assert hooked(text).lines == [text]
    spaced = hooked(text, hook_style=HookStyle(tracking=12))
    assert spaced.lines == ["Jangan", "lakukan ini"] and spaced.size == HOOK_SIZE
    assert all(metrics.width(line, spaced.size, 12) <= hook_width(PORTRAIT) for line in spaced.lines)
    assert fit_hook(text, HookStyle(tracking=12), canvas=PORTRAIT) == (spaced.lines, spaced.size)
    # The block holds the tracked lines.
    longest = max(metrics.width(line, spaced.size, 12) for line in spaced.lines)
    assert spaced.area.width == math.ceil(longest) + 2 * HOOK_PAD_X
    # On one line at most, it is set smaller, until its tracked line just fits.
    one = hooked(text, hook_style=HookStyle(tracking=12, max_lines=1))
    assert one.lines == [text] and one.size < HOOK_SIZE
    assert hook_width(PORTRAIT) - 1 < metrics.width(text, one.size, 12) <= hook_width(PORTRAIT)
    # Pulled in, a line too wide untracked fits on one.
    tight = "Kenapa bisnis kamu gagal?"
    assert len(hooked(tight).lines) == 2
    assert hooked(tight, hook_style=HookStyle(tracking=-4)).lines == [tight]
    # The Kicker isn't tracked.
    kicked = hooked(text, hook_kicker="EPS 12", hook_style=HookStyle(tracking=12))
    assert kicked.kicker.box.width == hooked(text, hook_kicker="EPS 12").kicker.box.width


def test_line_height_sets_the_pitch_of_the_hooks_lines():
    default = hooked(HOOK)
    assert HookStyle().line_height == 0.82
    for line_height in (0.6, 1.3):
        hook = hooked(HOOK, hook_style=HookStyle(line_height=line_height))
        assert hook.lines == default.lines and hook.size == default.size
        (_, first), (_, second) = hook.anchors
        assert second - first == pytest.approx(line_height * hook.size)
        # The block grows or shrinks to hold them.
        assert hook.area.height - default.area.height == pytest.approx((line_height - 0.82) * hook.size, abs=1)
        assert hook.boxes == [hook.area]
    # Strips move apart, or together, by as much; never over each other.
    strips = HookStyle(shape=HookShape.STRIPS)
    upper, lower = hooked(HOOK, hook_style=strips).boxes
    for line_height in (1.3, 0.78):
        hook = hooked(HOOK, hook_style=replace(strips, line_height=line_height))
        spaced_upper, spaced_lower = hook.boxes
        assert (spaced_lower.y - spaced_upper.y) - (lower.y - upper.y) == round((line_height - 0.82) * hook.size)
        (_, first), (_, second) = hook.anchors
        assert second - first == spaced_lower.y - spaced_upper.y
    touching = hooked(HOOK, hook_style=replace(strips, line_height=0.5)).boxes
    assert touching[1].y == touching[0].y + touching[0].height


def test_tracked_caption_lines_break_earlier_and_are_set_to_fit_counting_their_tracking():
    metrics = font_metrics()
    talk = "jadi waktu itu kita lagi ngobrol soal bisnis keluarga yang ternyata luar biasa ya"
    words = said(talk)
    style = CaptionStyle(max_secs=10)
    plain = styled(words, 12, style)
    spaced = styled(words, 12, replace(style, tracking=10))
    assert " ".join(shown(spaced)) == " ".join(shown(plain)) == talk.upper()
    assert len(spaced) > len(plain)

    # max_chars counts a line's characters as wide as its tracking makes them.
    def counted(text: str, tracking: float) -> float:
        return len(text) * metrics.width(text, style.size, tracking) / metrics.width(text, style.size)

    for line, after in zip(spaced, spaced[1:]):
        assert counted(line.text, 10) <= style.max_chars < counted(f"{line.text} {after.words[0].text}", 10)
    # A line too wide for its area is set smaller until it fits, tracking and all.
    for event in spaced:
        assert metrics.width(event.text, event.size, 10) + 2 * style.outline <= event.area.width
    [untracked] = styled(said("ketidakberdayaannya"), 3, style)
    [tracked] = styled(said("ketidakberdayaannya"), 3, replace(style, tracking=10))
    assert tracked.size < untracked.size
    assert tracked.area.width - 1 < metrics.width(tracked.text, tracked.size, 10) + 2 * style.outline <= tracked.area.width
    # Pulled in, they hold more than max_chars.
    tight = styled(words, 12, replace(style, tracking=-8))
    assert len(tight) < len(plain) and max(len(event.text) for event in tight) > style.max_chars


# Box padding on the Hook Style (text-advanced 14). Unset, the Shape's own: the tests above hold, and
# tests/test_styles.py checks that every built-in Preset plans as before.


def test_the_hook_styles_padding_widens_and_heightens_its_block_round_the_same_lines():
    default = hooked(HOOK)
    padded = hooked(HOOK, hook_style=HookStyle(padding_x=60, padding_y=40))
    assert (padded.lines, padded.size) == (default.lines, default.size)
    assert padded.area.width == default.area.width + 2 * (60 - HOOK_PAD_X)
    assert padded.area.height == default.area.height + 2 * (40 - HOOK_PAD_Y)
    assert padded.boxes == [padded.area] and padded.area.x == (1080 - padded.area.width) // 2
    # Its lines in its middle across; the first's capitals its padding below its top.
    cap = font_metrics().cap_height / font_metrics().units * padded.size
    for (x, baseline), (_, default_baseline) in zip(padded.anchors, default.anchors):
        assert x == padded.area.x + padded.area.width / 2
        assert baseline - padded.area.y == pytest.approx(default_baseline - default.area.y + 40 - HOOK_PAD_Y)
    assert padded.anchors[0][1] - cap - padded.area.y == pytest.approx(40)
    # Left-aligned, they start padding_x in.
    left = hooked(HOOK, hook_style=HookStyle(padding_x=60, align=HookAlign.LEFT))
    metrics = font_metrics()
    assert all(x - metrics.width(line, left.size) / 2 == pytest.approx(left.area.x + 60) for line, (x, _) in zip(left.lines, left.anchors))


def test_the_hook_styles_padding_pads_each_strip():
    metrics = font_metrics()
    strips = hooked(HOOK, hook_style=HookStyle(shape=HookShape.STRIPS, padding_x=30, padding_y=20))
    size = strips.size
    height = math.ceil((metrics.cap_height + metrics.descent) / metrics.units * size + 40)
    for box, line, (x, baseline) in zip(strips.boxes, strips.lines, strips.anchors):
        assert (box.width, box.height) == (math.ceil(metrics.width(line, size) + 60), height)
        assert box.x + box.width / 2 == x and baseline - metrics.cap_height / metrics.units * size - box.y == pytest.approx(20)
    # Unset, a strip's own: a quarter of the size across.
    default = hooked(HOOK, hook_style=HookStyle(shape=HookShape.STRIPS))
    assert default.boxes[0].width == math.ceil(metrics.width(default.lines[0], size) + 2 * 0.25 * size)


def test_without_a_box_the_hook_styles_padding_changes_nothing():
    bare = HookStyle(shape=HookShape.NONE)
    assert hooked(HOOK, hook_style=replace(bare, padding_x=90, padding_y=60)) == hooked(HOOK, hook_style=bare)


def test_a_wider_padding_leaves_less_room_for_the_hooks_lines():
    metrics = font_metrics()
    # 728 px at 88: within hook_width(PORTRAIT)'s 748, the box as wide as the captions' area at 60 px either side.
    text = "Racun bisa bunuh kamu"
    assert hooked(text).lines == [text]
    padded = hooked(text, hook_style=HookStyle(padding_x=60))
    assert len(padded.lines) == 2 and padded.size == HOOK_SIZE
    assert padded.area.width <= kicker_widest(PORTRAIT)
    # On one line at most it is set smaller, its padding with it, until the box is as wide as that area.
    one = hooked(text, hook_style=HookStyle(padding_x=60, max_lines=1))
    assert one.lines == [text] and one.size < HOOK_SIZE
    assert kicker_widest(PORTRAIT) - 2 < metrics.width(text, one.size) + 2 * 60 * one.size / HOOK_SIZE <= kicker_widest(PORTRAIT)
    assert one.area.width == math.ceil(metrics.width(text, one.size) + 2 * 60 * one.size / HOOK_SIZE)
    assert fit_hook(text, HookStyle(padding_x=60, max_lines=1), canvas=PORTRAIT) == (one.lines, one.size)
    # A narrow padding leaves more.
    assert len(hooked("Setetes racun bisa bunuh").lines) == 2
    assert hooked("Setetes racun bisa bunuh", hook_style=HookStyle(padding_x=20)).lines == ["Setetes racun bisa bunuh"]


# Cues of up to three lines (captions-advanced ticket 03).
SENTENCE = CaptionStyle(max_lines=2, max_chars=24, max_secs=5, pause_secs=0.7)


def rows(cues: list[Cue]) -> list[list[str]]:
    return [[" ".join(word.text for word in line) for line in cue.lines] for cue in cues]


def test_sentence_limits_give_two_balanced_lines_ending_at_a_sentences_end_or_a_pause():
    talk = "satu dua tiga empat lima enam tujuh delapan. sembilan sepuluh"
    cues = styled(said(talk) + said("oke lanjut", 6.0), 8, SENTENCE)
    assert rows(cues) == [
        # 43 characters in two lines of at most 24: the split whose longer line is shortest (19 and
        # 23 characters, not the 24 and 18 of filling the first line).
        ["SATU DUA TIGA EMPAT", "LIMA ENAM TUJUH DELAPAN"],
        # After a sentence's end, a short sentence on one line; a pause of more than 0.7 s ends it.
        ["SEMBILAN SEPULUH"],
        ["OKE LANJUT"],
    ]
    assert cues[0].plain == ["satu dua tiga empat", "lima enam tujuh delapan."]
    # The Cue is shown from its first Word to after its last, for as long as max_secs allows.
    assert (cues[0].start, cues[0].words[-1].text) == (0.0, "DELAPAN")
    # What doesn't fit two lines of 24 characters goes on in the next Cue. Of two splits as long,
    # the one with the shorter first line.
    long = styled(said("jadi waktu itu kita lagi ngobrol soal bisnis keluarga yang ternyata luar biasa ya"), 8, SENTENCE)
    assert rows(long) == [["JADI WAKTU ITU KITA", "LAGI NGOBROL SOAL BISNIS"], ["KELUARGA YANG", "TERNYATA LUAR BIASA YA"]]


def test_a_break_starts_a_line_inside_a_cue_and_a_cue_when_the_cue_has_all_its_lines():
    words = said("satu dua tiga empat lima enam")
    breaks = lambda *i: [WordEdit(at=words[n].start + 0.01, break_before=True) for n in i]  # noqa: E731
    # Unbroken, balanced.
    assert rows(styled(words, 8, SENTENCE)) == [["SATU DUA TIGA", "EMPAT LIMA ENAM"]]
    # A break inside the Cue starts its second line, wherever balancing would have put it.
    assert rows(edited(words, breaks(1), 8, caption_style=SENTENCE)) == [["SATU", "DUA TIGA EMPAT LIMA ENAM"]]
    # A second break, with both lines taken, starts the next Cue.
    assert rows(edited(words, breaks(1, 4), 8, caption_style=SENTENCE)) == [["SATU", "DUA TIGA EMPAT"], ["LIMA ENAM"]]
    # On three lines, it is the third line.
    three = replace(SENTENCE, max_lines=3)
    assert rows(edited(words, breaks(1, 4), 8, caption_style=three)) == [["SATU", "DUA TIGA EMPAT", "LIMA ENAM"]]
    # With one line, a break starts a Cue as before.
    assert rows(edited(words, breaks(1), 8)) == [["SATU"], ["DUA TIGA EMPAT"], ["LIMA ENAM"]]


def test_max_chars_and_max_words_count_per_line_and_the_widest_line_sizes_and_places_the_cue():
    words = said("satu dua tiga empat lima enam tujuh")
    # Two Words a line, three lines a Cue.
    cues = styled(words, 8, CaptionStyle(max_lines=3, max_words=2, max_chars=40, max_secs=5))
    assert rows(cues) == [["SATU DUA", "TIGA EMPAT", "LIMA ENAM"], ["TUJUH"]]
    # Three lines a font size apart are taller than the area's 200 px: it grows about its middle.
    big = styled(words, 8, CaptionStyle(max_lines=3, max_words=2, max_chars=40, max_secs=5, size=200))[0]
    assert big.area.height == 2 * math.ceil(3 * big.size / 2) > PORTRAIT.lower_captions.height
    assert big.area.y + big.area.height / 2 == PORTRAIT.lower_captions.y + PORTRAIT.lower_captions.height / 2
    assert cues[1].area == PORTRAIT.lower_captions
    # A line too wide for the area shrinks the whole Cue to fit it.
    wide = styled(said("pendek ketidakberdayaannyaaaa"), 4, CaptionStyle(max_lines=2, max_chars=12, max_secs=5, size=200))
    assert rows(wide) == [["PENDEK", "KETIDAKBERDAYAANNYAAAA"]]
    assert wide[0].size == styled(said("ketidakberdayaannyaaaa"), 4, CaptionStyle(size=200))[0].size < 200


def test_a_cue_is_joinable_when_both_fit_the_cues_lines():
    # Parted by a sentence's end: "SATU DUA" and "TIGA EMPAT LIMA" fit two lines of 24 characters.
    words = said("satu dua. tiga empat lima")
    assert [(rows([cue]), cue.joinable) for cue in styled(words, 8, SENTENCE)] == [
        ([["SATU DUA"]], False), ([["TIGA EMPAT LIMA"]], True),
    ]
    # On one line of 20 characters, they don't.
    one = replace(SENTENCE, max_lines=1, max_chars=20)
    assert [cue.joinable for cue in styled(words, 8, one)] == [False, False]
    # A break before the later Cue's first Word doesn't stop it (merging lifts it); breaks inside
    # them, needing a third line, do.
    at = lambda n: WordEdit(at=words[n].start + 0.01, break_before=True)  # noqa: E731
    assert [cue.joinable for cue in edited(words, [at(2)], 8, caption_style=SENTENCE)] == [False, True]
    assert [cue.joinable for cue in edited(words, [at(1), at(3)], 8, caption_style=SENTENCE)] == [False, False]


# Cue Edits (captions-advanced ticket 07). Their times are on the Source's timeline.


def retimed(words: list[Word], cue_edits: list[CueEdit], secs: float = 5, **options) -> RenderPlan:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), words=words, cue_edits=cue_edits, **{"canvas": PORTRAIT, **options})


def spans(cues: list[Cue]) -> list[tuple[float, float]]:
    return [(cue.start, cue.end) for cue in cues]


def highlights(cue: Cue) -> list[tuple[str, float, float]]:
    return [(word.text, word.start, word.end) for word in cue.words]


TALK = [Word("halo,", 1.0, 1.4), Word("semua.", 1.4, 2.0), Word("apa", 3.0, 3.2), Word("kabar", 3.2, 3.6)]


def test_a_cue_edits_shift_moves_its_cue_and_highlight_and_its_deltas_move_only_its_edges():
    assert spans(retimed(TALK, []).captions) == [(1.0, 2.3), (3.0, 3.9)]
    moved = retimed(TALK, [CueEdit(at=103.1, shift=0.5)]).captions
    assert spans(moved) == [(1.0, 2.3), (3.5, 4.4)]
    assert highlights(moved[1]) == [("APA", 3.5, 3.7), ("KABAR", 3.7, 4.4)]
    assert [cue.edited for cue in moved] == [False, True]
    # Earlier at its start and later at its end: the Words are said when they were, the first
    # highlighted from when the Cue comes up.
    widened = retimed(TALK, [CueEdit(at=103.1, start_delta=-0.4, end_delta=0.5)]).captions
    assert spans(widened) == [(1.0, 2.3), (2.6, 4.4)]
    assert highlights(widened[1]) == [("APA", 2.6, 3.2), ("KABAR", 3.2, 4.4)]
    # Any time within its first Word names it.
    assert spans(retimed(TALK, [CueEdit(at=103.0, shift=0.5)]).captions) == spans(moved)


def test_a_retimed_cue_is_clamped_by_its_neighbours_and_the_clip():
    # Not before the Cue before ends: its start is cut there.
    assert spans(retimed(TALK, [CueEdit(at=103.1, shift=-1.0)]).captions) == [(1.0, 2.3), (2.3, 2.9)]
    # Not after the Cue after starts.
    assert spans(retimed(TALK, [CueEdit(at=101.2, end_delta=2.0)]).captions) == [(1.0, 3.0), (3.0, 3.9)]
    # Kept in the Clip, and shown CAPTION_MIN_SECS at least.
    assert spans(retimed(TALK, [CueEdit(at=103.1, shift=10.0)]).captions) == [(1.0, 2.3), (4.8, 5.0)]
    assert spans(retimed(TALK, [CueEdit(at=101.2, start_delta=-5.0)]).captions)[0] == (0.0, 2.3)
    assert spans(retimed(TALK, [CueEdit(at=101.2, start_delta=2.0, end_delta=-2.0)]).captions)[0] == (2.8, 3.0)
    # Of two edited Cues that reach for each other, the earlier keeps its place; one moved later
    # leaves the earlier room up to it.
    both = [CueEdit(at=101.2, end_delta=-0.3), CueEdit(at=103.1, start_delta=-9.0)]
    assert spans(retimed(TALK, both).captions) == [(1.0, 2.0), (2.0, 3.9)]
    later = [CueEdit(at=101.2, end_delta=2.0), CueEdit(at=103.1, shift=0.5)]
    assert spans(retimed(TALK, later).captions) == [(1.0, 3.5), (3.5, 4.4)]


def test_a_retimed_cue_short_of_room_keeps_the_minimum_and_isnt_dropped():
    # Moved past the Clip's end while the Cue before reaches for it: it keeps CAPTION_MIN_SECS
    # before the end, and the Cue before stops there.
    reaching = [CueEdit(at=101.2, end_delta=5.0), CueEdit(at=103.1, shift=10.0)]
    assert spans(retimed(TALK, reaching).captions) == [(1.0, 4.8), (4.8, 5.0)]
    # Spoken right before the next Cue, with the Cue before shown up to it: the Cue before gives
    # way, so it is shown CAPTION_MIN_SECS.
    quick = [Word("satu", 1.0, 1.9), Word("dua", 2.0, 2.05), Word("tiga", 2.1, 2.5)]
    one = CaptionStyle(max_words=1)
    assert spans(retimed(quick, [], caption_style=one).captions) == [(1.0, 2.0), (2.0, 2.1), (2.1, 2.8)]
    placed = retimed(quick, [CueEdit(at=102.025, x=300)], caption_style=one).captions
    assert spans(placed) == [(1.0, 1.9), (1.9, 2.1), (2.1, 2.8)]
    # With no more room than its Segment (shorter than the minimum), it fills it.
    first = SegmentInput(10.0, 12.0, words=[Word("satu", 0.2, 0.6)])
    tiny = SegmentInput(50.0, 50.15, words=[Word("dua", 0.0, 0.15)])
    cues = plan_render(10, 50.15, source(1920, 1080, fps=FPS), main_track=[first, tiny], cue_edits=[CueEdit(at=50.07, shift=0.5)], canvas=PORTRAIT).captions
    assert spans(cues) == [(0.2, 0.9), (2.0, 2.15)]


def test_each_cue_says_where_a_cue_edit_keeps_it_and_which_cue_edits_it_has():
    # Bounds: its Segment (here the Clip), the Cue before's end and the Cue after's start.
    plain = retimed(TALK, []).captions
    assert [(cue.low, cue.high, cue.speed) for cue in plain] == [(0.0, 3.0, 1.0), (2.3, 5.0, 1.0)]
    assert [cue.word_ats for cue in plain] == [[101.2, 101.7], [103.1, 103.4]]
    assert [cue.cue_edit_ats for cue in plain] == [[None, None], [None, None]]
    # A Cue moved later leaves the one before room up to it; its own bounds are what it was kept in.
    later = retimed(TALK, [CueEdit(at=101.2, end_delta=2.0), CueEdit(at=103.1, shift=0.5)]).captions
    assert [(cue.low, cue.high) for cue in later] == [(0.0, 3.5), (3.5, 5.0)]
    # A Cue Edit is named by its `at` as given: early in a long first Word, past WORD_EDIT_REACH_SECS
    # of the Word's middle, it still applies, and the Cue says it is its own.
    long = [Word("halooo", 1.0, 1.8), Word("apa", 3.0, 3.2)]
    early = retimed(long, [CueEdit(at=101.05, shift=0.2)]).captions
    assert early[0].edited and early[0].cue_edit_ats == [101.05]
    # A join that took is named on its Word; one that didn't, on the Cue it starts.
    join = CueEdit(at=103.15, join=True)
    assert retimed(TALK, [join], caption_style=SENTENCE).captions[0].cue_edit_ats == [None, None, 103.15, None]
    kept = retimed(TALK, [join], caption_style=replace(SENTENCE, max_lines=1, max_chars=12)).captions
    assert kept[1].cue_edit_ats == [103.15, None] and not kept[1].edited
    # In Segments: each between its cuts (a Transition's at its middle), at its Speed, keyed on
    # its timeline.
    first = SegmentInput(10.0, 12.0, words=[Word("satu", 0.2, 0.6)])
    sped = SegmentInput(50.0, 54.0, words=[Word("dua", 1.0, 1.4), Word("tiga", 2.6, 3.0)], speed=2.0, join=Join(TransitionKind.FADE, 0.4))
    cues = plan_render(10, 54, source(1920, 1080, fps=FPS), main_track=[first, sped], canvas=PORTRAIT).captions
    assert [(cue.low, cue.high, cue.speed) for cue in cues] == [(0.0, 1.8, 1.0), (1.8, 2.9, 2.0), (2.6, 3.6, 2.0)]
    assert [cue.word_ats for cue in cues] == [[10.4], [51.2], [52.8]]


def test_cue_edits_are_divided_by_their_segments_speed_and_kept_in_their_segment():
    first = SegmentInput(10.0, 12.0, words=[Word("satu", 0.2, 0.6)])
    sped = SegmentInput(50.0, 54.0, words=[Word("dua", 1.0, 1.4), Word("tiga", 2.6, 3.0)], speed=2.0)

    def cues(*edits: CueEdit) -> list[Cue]:
        return plan_render(10, 54, source(1920, 1080, fps=FPS), main_track=[first, sped], cue_edits=list(edits), canvas=PORTRAIT).captions

    assert spans(cues()) == [(0.2, 0.9), (2.5, 3.0), (3.3, 3.8)]
    # 0.4 s of the Source is 0.2 s at 2x.
    assert spans(cues(CueEdit(at=51.2, shift=0.4))) == [(0.2, 0.9), (2.7, 3.2), (3.3, 3.8)]
    assert spans(cues(CueEdit(at=51.2, start_delta=-0.4))) == [(0.2, 0.9), (2.3, 3.0), (3.3, 3.8)]
    # Not out of its Segment, at either end.
    assert spans(cues(CueEdit(at=51.2, start_delta=-2.0)))[1] == (2.0, 3.0)
    assert spans(cues(CueEdit(at=52.8, end_delta=4.0)))[2] == (3.3, 4.0)


def test_a_cue_edits_word_starts_a_cue_whatever_the_line_limits():
    words = said("satu dua tiga empat lima enam")
    empat = words[3]
    edit = CueEdit(at=100 + (empat.start + empat.end) / 2)
    assert rows(styled(words, 8, SENTENCE)) == [["SATU DUA TIGA", "EMPAT LIMA ENAM"]]
    assert rows(retimed(words, [edit], 8, caption_style=SENTENCE).captions) == [["SATU DUA TIGA"], ["EMPAT LIMA ENAM"]]
    # Longer lines, or one short line a Cue: EMPAT still starts one, keyed by it.
    for style in (replace(SENTENCE, max_chars=40), CaptionStyle(), CaptionStyle(max_chars=8)):
        cues = retimed(words, [edit], 8, caption_style=style).captions
        [started] = [cue for cue in cues if cue.edited]
        assert started.words[0].text == "EMPAT" and started.key.at == edit.at


def test_a_cue_edit_whose_word_isnt_shown_is_unused_and_applies_again_once_it_is():
    edit = CueEdit(at=103.1, shift=0.5)
    # Trimmed out of the Clip's range: unused, and nothing moves.
    trimmed = retimed(TALK, [edit], 2.5)
    assert (spans(trimmed.captions), trimmed.unused_cue_edits) == ([(1.0, 2.3)], [edit])
    # The range restored: it applies again.
    restored = retimed(TALK, [edit])
    assert (spans(restored.captions)[1], restored.unused_cue_edits) == ((3.5, 4.4), [])
    # So in a Segment of its range; a Word removed by a Word Edit isn't shown either.
    part = lambda end: SegmentInput(100.0, end, words=[w for w in TALK if w.end <= end - 100])  # noqa: E731
    plan = lambda end, **options: plan_render(100, end, source(1920, 1080, fps=FPS), main_track=[part(end)], cue_edits=[edit], **{"canvas": PORTRAIT, **options})  # noqa: E731
    assert plan(102.5).unused_cue_edits == [edit]
    assert plan(105).unused_cue_edits == []
    removed = SegmentInput(100.0, 105, words=TALK, word_edits=[WordEdit(at=3.1, text="")])
    assert plan_render(100, 105, source(1920, 1080, fps=FPS), main_track=[removed], cue_edits=[edit], canvas=PORTRAIT).unused_cue_edits == [edit]
    # A Cue Edit of a Media Library item doesn't apply on the Source's timeline.
    elsewhere = CueEdit(at=103.1, media="ab" * 16, shift=0.5)
    assert retimed(TALK, [elsewhere]).unused_cue_edits == [elsewhere]


def test_a_media_segments_cue_edits_are_on_its_items_timeline():
    media = "ab" * 16
    # A video's Segment from 0.5 s into it, saying "halo semua. apa" (in seconds into the Segment).
    talking = SegmentInput(0.5, 4.0, media=media, width=720, height=1280, words=[Word("halo", 0.5, 0.9), Word("apa", 2.5, 2.9)])
    plan = lambda *edits: plan_render(0, 10, source(1920, 1080, fps=FPS), main_track=[talking], cue_edits=list(edits), canvas=PORTRAIT)  # noqa: E731
    assert [(cue.start, cue.key.at, cue.key.media) for cue in plan().captions] == [(0.5, 1.2, media), (2.5, 3.2, media)]
    # Keyed at its Word's middle on the item's timeline: 3.2 s into the video.
    moved = plan(CueEdit(at=3.2, media=media, shift=0.3))
    assert [(cue.start, cue.edited) for cue in moved.captions] == [(0.5, False), (2.8, True)]
    # The Source's Cue Edit at that time doesn't touch it.
    source_edit = CueEdit(at=3.2, shift=0.3)
    assert plan(source_edit).unused_cue_edits == [source_edit]


# A Cue's own place and size (captions-advanced ticket 08).


def test_a_cue_edits_place_moves_only_its_cue_and_keeps_it_in_the_frame():
    plain = retimed(TALK, []).captions
    assert {cue.area for cue in plain} == {PORTRAIT.lower_captions}
    # Centred on (300, 700), as a custom position puts captions; the Cue before stays put.
    placed = retimed(TALK, [CueEdit(at=103.1, x=300, y=700)]).captions
    assert placed[0].area == PORTRAIT.lower_captions
    assert placed[1].area == Box(300 - 410, 600, 820, 200)
    assert placed[1].edited
    # Only a height: the style's x (centred); only an x: the style's height.
    assert retimed(TALK, [CueEdit(at=103.1, y=700)]).captions[1].area == Box(130, 600, 820, 200)
    assert retimed(TALK, [CueEdit(at=103.1, x=600)]).captions[1].area == replace(PORTRAIT.lower_captions, x=600 - 410)
    # Off the frame, it is kept in the safe area's height and with its line in the frame's width.
    [_, far] = retimed(TALK, [CueEdit(at=103.1, x=1080, y=1920)]).captions
    assert far.area.y == PORTRAIT.safe_area.y + PORTRAIT.safe_area.height - 200
    half = font_metrics().width("APA KABAR", far.size) / 2 + CaptionStyle().outline
    assert far.area.x + far.area.width / 2 == round(1080 - half)


def test_a_cue_edits_scale_multiplies_the_styles_size_and_follows_it():
    edit = [CueEdit(at=103.1, scale=1.5)]
    cues = retimed(TALK, edit).captions
    assert [cue.size for cue in cues] == [110, 165]
    # The style's size changed: the Cue stays 1.5 times as big.
    bigger = retimed(TALK, edit, caption_style=CaptionStyle(size=120)).captions
    assert [cue.size for cue in bigger] == [120, 180]
    # Then a line too wide for its area is still set smaller.
    long = [Word("halo", 1.0, 1.4), Word("W" * 14, 3.0, 3.6)]
    [_, wide] = retimed(long, edit, caption_style=CaptionStyle(max_chars=30)).captions
    assert wide.size < 165
    assert wide.size == retimed(long, [], caption_style=CaptionStyle(max_chars=30)).captions[1].size


# A `join` Cue Edit (captions-advanced ticket 09).


def test_a_join_keeps_two_cues_parted_by_a_pause_together_but_not_past_the_line_limits():
    # "halo, semua." and "apa kabar" are parted by a sentence's end and a pause of a second.
    join = CueEdit(at=103.1, join=True)
    apart = retimed(TALK, [], caption_style=SENTENCE).captions
    assert rows(apart) == [["HALO SEMUA"], ["APA KABAR"]]
    assert [(cue.joinable, cue.needs_join) for cue in apart] == [(False, False), (True, True)]
    joined = retimed(TALK, [join], caption_style=SENTENCE)
    assert rows(joined.captions) == [["HALO SEMUA APA KABAR"]]
    assert spans(joined.captions) == [(1.0, 3.9)] and not joined.captions[0].edited and joined.unused_cue_edits == []
    # A join cancels only the break before its own Word: the longest Cue still counts from the
    # Cue's first Word, so the Words after it break off where max_secs would part them. The joined
    # Word is shown to its end, but the Cue lingers no longer.
    short = replace(SENTENCE, max_secs=1.5)
    assert rows(retimed(TALK, [], caption_style=short).captions) == [["HALO SEMUA"], ["APA KABAR"]]
    once = retimed(TALK, [join], caption_style=short).captions
    assert rows(once) == [["HALO SEMUA APA"], ["KABAR"]]
    assert spans(once) == [(1.0, 3.2), (3.2, 3.9)]
    assert highlights(once[0]) == [("HALO", 1.0, 1.4), ("SEMUA", 1.4, 3.0), ("APA", 3.0, 3.2)]
    # What is left still fits and needs a join of its own; merged again, it is one Cue.
    assert (once[1].joinable, once[1].needs_join) == (True, True)
    twice = retimed(TALK, [join, CueEdit(at=103.4, join=True)], caption_style=short).captions
    assert rows(twice) == [["HALO SEMUA APA KABAR"]] and spans(twice) == [(1.0, 3.6)]
    # Past max_chars times max_lines they stay two, not joinable, and the join moves nothing. (It
    # keeps only its own Word with the Cue before: at 16 characters "HALO SEMUA APA" would fit.)
    narrow = replace(SENTENCE, max_lines=1, max_chars=12)
    kept = retimed(TALK, [join], caption_style=narrow).captions
    assert rows(kept) == [["HALO SEMUA"], ["APA KABAR"]] and spans(kept) == spans(retimed(TALK, [], caption_style=narrow).captions)
    assert [cue.joinable for cue in kept] == [False, False] and not kept[1].edited
    # In two lines of 10 characters it fits again: joinable agrees.
    two = replace(SENTENCE, max_lines=2, max_chars=10)
    assert [cue.joinable for cue in retimed(TALK, [], caption_style=two).captions] == [False, True]
    assert rows(retimed(TALK, [join], caption_style=two).captions) == [["HALO SEMUA", "APA KABAR"]]


def test_a_cue_parted_only_by_a_cue_edit_needs_no_join():
    words = said("satu dua tiga empat lima enam")
    empat = words[3]
    split = retimed(words, [CueEdit(at=100 + (empat.start + empat.end) / 2)], 8, caption_style=SENTENCE).captions
    assert rows(split) == [["SATU DUA TIGA"], ["EMPAT LIMA ENAM"]]
    assert [(cue.joinable, cue.needs_join) for cue in split] == [(False, False), (True, False)]
