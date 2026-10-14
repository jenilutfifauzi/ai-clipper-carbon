"""Seam B: the Render Planner on synthetic input, without video."""

import math

import pytest
from pydantic import TypeAdapter

from app.candidates import Layout, WordEdit
from app.config import CameraTuning
from app.styles import CaptionPosition, CaptionStyle, Highlight, HookPosition, HookStyle
from app.planner import (
    HOOK_PAD_X,
    HOOK_SIZE,
    HOOK_WIDTH,
    LOWER_CAPTIONS,
    SAFE_AREA,
    SEAM_CAPTIONS,
    TOP_CAPTIONS,
    Box,
    CaptionEvent,
    CaptionWord,
    CropPoint,
    Face,
    FrameFaces,
    HookEvent,
    RenderPlan,
    Scene,
    SceneLayout,
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
              layout: Layout = Layout.AUTO, width: int = 1920, height: int = 1080) -> list[CaptionEvent]:
    return plan_render(100, 100 + secs, source(width, height, fps=FPS), scenes, faces, layout, words).captions


def shown(events: list[CaptionEvent]) -> list[str]:
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

    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, words=words)
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
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), hook=text, **options).hook


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
    assert long.size < HOOK_SIZE and HOOK_WIDTH - 2 < widest(long) <= HOOK_WIDTH
    # One Word wider than a line is set smaller on its own line.
    word = hooked("W" * 30)
    assert word.lines == ["W" * 30] and widest(word) <= HOOK_WIDTH
    for hook in (hooked(HOOK), hooked("Kenapa gagal?")):
        assert widest(hook) <= HOOK_WIDTH and hook.size == HOOK_SIZE
    # What Review asks: the lines, and whether they fit at the hook's size.
    assert fit_hook(HOOK) == (hooked(HOOK).lines, HOOK_SIZE)
    assert fit_hook(LONG_HOOK)[1] < HOOK_SIZE


def test_a_blank_hook_shows_nothing():
    for text in ("", "   ", "\n\t"):
        assert hooked(text) is None
        assert fit_hook(text) == ([], HOOK_SIZE)


def test_the_hook_sits_just_below_the_top_safe_zone_and_never_over_the_captions():
    faces, scenes = caption_scenes()
    words = said("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", 0.2, gap=0.2)
    plans = [
        plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, layout, words, text)
        for layout in Layout
        for text in ("Kenapa gagal?", HOOK, LONG_HOOK, "W" * 30)
    ]
    plans.append(plan_render(100, 106, source(1080, 1920, fps=FPS), words=words, hook=HOOK))
    # Every Layout's captions are there: the seam's band (Split) and the lower third.
    assert {e.area for plan in plans for e in plan.captions} == {SEAM_CAPTIONS, LOWER_CAPTIONS}
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
        assert area.y + area.height <= SEAM_CAPTIONS.y, hook
        for event in plan.captions:
            caption = event.area
            assert area.y + area.height <= caption.y or caption.y + caption.height <= area.y, (hook, event)
    # As short as its lines allow: one line takes a lower box than two.
    one, two = hooked("Kenapa gagal?").area, hooked(HOOK).area
    assert one.height < two.height <= 200

    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), scenes, faces, words=words, hook=HOOK)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Caption and Hook Styles (clip editor ticket 01). The defaults are v1's, which the tests above check.


def styled(words: list[Word], secs: float, style: CaptionStyle, **options) -> list[CaptionEvent]:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), words=words, caption_style=style, **options).captions


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

    assert areas(CaptionStyle()) == {SEAM_CAPTIONS, LOWER_CAPTIONS}
    assert areas(CaptionStyle(position=CaptionPosition.TOP)) == {TOP_CAPTIONS}
    assert areas(CaptionStyle(position=CaptionPosition.MIDDLE)) == {SEAM_CAPTIONS}
    assert areas(CaptionStyle(position=CaptionPosition.BOTTOM)) == {LOWER_CAPTIONS}
    # A custom height is the line's centre, kept inside the safe area.
    [custom] = areas(CaptionStyle(position=CaptionPosition.CUSTOM, y=700))
    assert custom == Box(130, 600, 820, 200)
    for y, top in ((0, SAFE_AREA.y), (1920, SAFE_AREA.y + SAFE_AREA.height - 200)):
        assert areas(CaptionStyle(position=CaptionPosition.CUSTOM, y=y)) == {Box(130, top, 820, 200)}
    # Where every line goes to one place, a Layout change doesn't move or cut a line.
    one_place = styled(words, 6, CaptionStyle(position=CaptionPosition.BOTTOM), scenes=scenes, faces=faces)
    assert shown(one_place) == shown(captioned(words, 6))
    # Top captions stay below a two-line hook at the top.
    assert TOP_CAPTIONS.y >= hooked(LONG_HOOK).area.y + hooked(LONG_HOOK).area.height


def test_a_caption_line_too_wide_for_its_area_is_set_smaller_at_the_styles_size():
    [fits] = styled([Word("halo", 0.0, 0.5)], 2, CaptionStyle(size=130))
    assert fits.size == 130
    [wide] = styled([Word("W" * 15, 0.0, 0.5)], 2, CaptionStyle(size=130, outline=10))
    assert wide.size < 130
    assert font_metrics().width(wide.text, wide.size) + 20 <= wide.area.width
    assert font_metrics().width(wide.text, wide.size + 0.2) + 20 > wide.area.width


def test_the_hook_goes_where_its_style_puts_it_at_its_size():
    top = hooked(HOOK)
    assert top.area.y == SAFE_AREA.y
    middle = hooked(HOOK, hook_style=HookStyle(position=HookPosition.MIDDLE)).area
    assert abs(middle.y + middle.height / 2 - 960) <= 1
    bottom = hooked(HOOK, hook_style=HookStyle(position=HookPosition.BOTTOM)).area
    assert bottom.y + bottom.height == SAFE_AREA.y + SAFE_AREA.height
    assert hooked(HOOK, hook_style=HookStyle(position=HookPosition.CUSTOM, y=700)).area.y == 700
    clamped = hooked(HOOK, hook_style=HookStyle(position=HookPosition.CUSTOM, y=1900)).area
    assert clamped.y + clamped.height == SAFE_AREA.y + SAFE_AREA.height
    # A smaller size: the same lines in a smaller box, and the text fits at that size.
    small = hooked(HOOK, hook_style=HookStyle(size=60))
    assert small.size == 60 and small.area.width < top.area.width and small.area.height < top.area.height
    assert fit_hook(HOOK, HookStyle(size=60)) == (small.lines, 60)
    # Too large for two lines: set smaller than the style's size.
    assert fit_hook(LONG_HOOK, HookStyle(size=120))[1] < 120


def test_the_plan_keeps_its_styles():
    caption, hook = CaptionStyle(colour="#FFE600", highlight=Highlight.BOX), HookStyle(box_opacity=1.0)
    plan = plan_render(100, 106, source(1920, 1080, fps=FPS), words=said("halo semua"), hook=HOOK,
                       caption_style=caption, hook_style=hook)
    assert (plan.caption_style, plan.hook_style) == (caption, hook)
    adapter = TypeAdapter(RenderPlan)
    assert adapter.validate_json(adapter.dump_json(plan)) == plan


# Word Edits (clip editor ticket 06). Their times are in seconds into the Clip, as candidate_plan gives them.


def edited(words: list[Word], edits: list, secs: float = 10, **options) -> list[CaptionEvent]:
    return plan_render(100, 100 + secs, source(1920, 1080, fps=FPS), words=words, word_edits=edits, **options).captions


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
