"""Seam B: the Render Planner on synthetic input, without video.

Later tickets add their cases here: caption events (15) and the hook event (16).
"""

import math

import pytest
from pydantic import TypeAdapter

from app.candidates import Layout
from app.config import CameraTuning
from app.planner import Box, CropPoint, Face, FrameFaces, RenderPlan, Scene, SceneLayout, plan_render
from app.video_source import SourceMetadata


def source(width: int, height: int, fps: float = 25) -> SourceMetadata:
    return SourceMetadata(duration=3600, fps=fps, width=width, height=height, codec="h264")


def only_panel(plan: RenderPlan):
    [scene] = plan.scenes
    [panel] = scene.panels
    return scene, panel


def test_a_landscape_source_gets_one_static_full_height_crop_from_the_centre():
    plan = plan_render(612.35, 655.8, source(1920, 1080, fps=29.97))

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
    _, panel = only_panel(plan_render(10, 40, source(width, height)))
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
    scene, panel = only_panel(plan_render(0, 30, source(width, height)))

    assert scene.layout is SceneLayout.PASSTHROUGH
    assert (panel.crop_width, panel.crop_height) == (width - width % 2, height - height % 2)
    assert panel.path == [CropPoint(0.0, 0, 0)]
    assert panel.area == area


def test_the_plan_is_saved_and_read_back_as_json():
    plan = plan_render(5, 35.5, source(1920, 1080))
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


@pytest.mark.parametrize(("start", "end"), [(10, 10), (10, 5), (-1, 5)])
def test_a_clip_must_run_forwards(start, end):
    with pytest.raises(ValueError):
        plan_render(start, end, source(1920, 1080))


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
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), scenes, faces, layout)


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


def test_a_portrait_source_is_passed_through_whatever_its_faces_or_layout():
    faces = sampled((2, people(2)), (2, people(1)))
    for layout in Layout:
        plan = plan_render(0, 4, source(1080, 1920), [Scene(0, 2), Scene(2, 4)], faces, layout)
        scene, panel = only_panel(plan)
        assert (scene.start, scene.end, scene.layout) == (0.0, 4.0, SceneLayout.PASSTHROUGH)
        assert (panel.area, panel.path) == (Box(0, 0, 1080, 1920), [CropPoint(0.0, 0, 0)])


def test_a_plan_with_every_layout_is_saved_and_read_back_as_json():
    plan = tracked(sampled((2, None), (2, people(1)), (2, people(2))), 6, [Scene(0, 2), Scene(2, 4), Scene(4, 6)])
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan
