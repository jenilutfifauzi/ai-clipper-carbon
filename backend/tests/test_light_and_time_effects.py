"""Glow, Bloom pulse and Film grain (.scratch/video-effects/issues/05-light-and-time-effects.md,
ADR 0014): Seam A through the API and the real ffmpeg, each on a full-frame image Overlay (scale 1, so
that its sizes are drawn as given), unkeyed and keyed. The two that change with time count it from the
Overlay's start, and read a still image as a looping stream. Each effect's chain at its defaults,
minimums and maximums is run in test_video_effects.py."""

import numpy as np

from app.video_effects import Clock, VideoEffect, changes_with_time, video_effect_chain
from test_blur_distort_stylize_effects import pictures  # noqa: F401
from test_media_library import upload
from test_overlay_grades import HELD
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_segment_grades import frame_at

# The Clip's frame rate, which the plain video has.
FPS = 25


def frames(client, settings, picture: bytes, times: list[float], start: float = 0.0, keyed: bool = False, *stack: dict) -> list[np.ndarray]:
    """The frames at `times` (Timeline time) with `picture` as an Overlay filling the frame from
    `start` for 2 s (or, `keyed`, at half its size about (540, 700), held by Keyframes), through the
    Video Effects `stack`."""
    item = upload(client, picture, "picture.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    placed = HELD | {"start": start} if keyed else {"start": start, "secs": 2.0, "transform": {"scale": 1}}
    shown = {"id": "o", "media": item["id"], **placed, "video_effects": list(stack)}
    return [frame_at(client, settings, job, candidate, at, overlays=[shown]) for at in times]


def test_only_grain_and_pulse_change_with_time():
    assert changes_with_time([VideoEffect("film-grain", {"amount": 12})])
    assert changes_with_time([VideoEffect("gaussian-blur"), VideoEffect("bloom-pulse", {"amount": 50, "speed": 2})])
    assert not changes_with_time([VideoEffect("glow", {"amount": 45})])
    assert not changes_with_time([VideoEffect("film-grain", {"amount": 12}, enabled=False)])


def test_a_pulse_counts_its_time_from_its_clock():
    """The strength's sin is of the picture's own time: the frames' time less its start, times its rate."""
    [chain] = video_effect_chain([VideoEffect("bloom-pulse", {"amount": 50, "speed": 2})], (64, 64), clock=Clock(1.5, 0.5))[1:]
    assert "sin((T-1.5)*0.5*2)" in chain, chain


def test_a_pulses_weight_is_a_table_and_only_its_gain_changes_with_time_each_pulse_its_own():
    """No per-pixel `geq` (about 20× a plain render, ticket 10): the knee weight is a table of the luma,
    and each frame's strength a gain `sendcmd` sets on its own `colorchannelmixer`, named apart from
    another pulse's in the same graph."""
    pulse = VideoEffect("bloom-pulse", {"amount": 50, "speed": 2})
    [first] = video_effect_chain([pulse], (64, 64), label="a")[1:]
    [second] = video_effect_chain([pulse], (64, 64), label="b")[1:]
    assert "geq" not in first and "lutrgb=" in first
    assert "[expr] colorchannelmixer@a0_pulse rr 0.5000*(0.6+0.4*sin(T*2))" in first and "colorchannelmixer@a0_pulse=" in first
    assert "colorchannelmixer@b0_pulse" in second and "@a0_" not in second


def test_film_grain_makes_two_consecutive_frames_of_a_still_image_overlay_differ(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    times = [1.0, 1.0 + 1 / FPS]
    first, second = frames(client, settings, pictures["waves"], times)
    assert np.array_equal(first, second)
    first, second = frames(client, settings, pictures["waves"], times, 0.0, False, {"id": "film-grain", "params": {"amount": 30}})
    changed = np.abs(first - second).mean(axis=-1)
    assert (changed[100:1800] > 4).mean() > 0.3, (changed[100:1800] > 4).mean()


def test_a_keyed_image_overlay_with_film_grain_also_changes_from_frame_to_frame(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    times = [1.0, 1.0 + 1 / FPS]
    # The keyed picture's middle: half of the frame-filling picture, about (540, 700).
    area = (slice(500, 900), slice(340, 740))
    first, second = frames(client, settings, pictures["waves"], times, 0.0, True)
    assert np.array_equal(first[area], second[area])
    first, second = frames(client, settings, pictures["waves"], times, 0.0, True, {"id": "film-grain", "params": {"amount": 30}})
    changed = np.abs(first[area] - second[area]).mean(axis=-1)
    assert (changed > 4).mean() > 0.3, (changed > 4).mean()


def glow_beside(frame: np.ndarray) -> float:
    """How bright the black is just outside the box's left edge (x 340, y 760 to 1160): 4 to 12 px from it."""
    return float(frame[900:1020, 328:336].mean())


def test_glow_brightens_the_area_around_a_bright_shape(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    [plain] = frames(client, settings, pictures["box"], [1.0])
    [glowing] = frames(client, settings, pictures["box"], [1.0], 0.0, False, {"id": "glow", "params": {"amount": 100}})
    assert glow_beside(plain) < 4, glow_beside(plain)
    assert glow_beside(glowing) > 30, glow_beside(glowing)
    # The box itself stays white, the far black black.
    assert glowing[960, 540].min() > 240 and glowing[200, 100].max() < 6


def test_bloom_pulse_varies_with_its_period_and_moves_with_its_overlay(client, settings, video_source, plain_video, pictures):
    """At speed 5 a breath takes 2π / 5 s: strongest 0.32 s into it (sin 1.6) and weakest at 0.92 s (sin 4.6)."""
    video_source.video = plain_video
    pulse = {"id": "bloom-pulse", "params": {"amount": 100, "speed": 5}}
    strong, weak, later = (glow_beside(frame) for frame in frames(client, settings, pictures["box"], [0.32, 0.92, 0.72], 0.0, False, pulse))
    assert strong > 2 * weak and strong - weak > 10, (strong, weak)
    # Moved 0.4 s later, its breath is 0.4 s later too: at 0.72 s it is 0.32 s into it.
    [moved] = (glow_beside(frame) for frame in frames(client, settings, pictures["box"], [0.72], 0.4, False, pulse))
    assert abs(moved - strong) < 2 and abs(moved - later) > 5, (moved, strong, later)
