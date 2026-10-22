"""Motion blur, Pixelate, Chromatic aberration, Fisheye and Posterize
(.scratch/video-effects/issues/04-blur-distort-and-stylize-effects.md, ADR 0014): Seam A through the
API and the real ffmpeg, each effect on a full-frame Overlay (scale 1, so that its sizes are drawn as
given) of a picture made to show what it does. Each effect's chain at its defaults, minimums and
maximums is run in test_video_effects.py."""

import numpy as np
import pytest

from app.audio_effects import NUMBER
from app.canvas import PORTRAIT
from app.video_effects import VideoEffect, effects, video_effect_chain
from test_media_library import make, upload
from test_overlay_grades import HELD
from test_render import add, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch
from test_segment_grades import frame_at
from test_segments import ramp_video, ranges  # noqa: F401
from test_video_effects import played

LAVFI = ("-f", "lavfi", "-i")
# An unkeyed Overlay's place, beside the keyed one's (HELD, about (540, 700)).
SHOWN_AT = {"transform": {"x": 540, "y": 1300, "scale": 0.3}}
FRAME = "size=1080x1920"
# Squares 24 px on a 120 px grid, white on black, the first at the top left corner.
SQUARES = "255*lt(mod(X\\,120)\\,24)*lt(mod(Y\\,120)\\,24)"


@pytest.fixture(scope="session")
def pictures(tmp_path_factory) -> dict[str, bytes]:
    """1080x1920 PNGs, each filling the frame at scale 1: a white box on black (`box`, x 340 to 740,
    y 760 to 1160); red waving across and green down, a period of 57 px (`waves`); red rising across
    and green rising down (`ramp`); white squares 24 px on a 120 px grid (`grid`); and three such
    squares (`dots`), at the top left and bottom right corners and about (640, 1060)."""
    folder = tmp_path_factory.mktemp("effect-pictures")
    black = f"color=c=black:{FRAME},format=rgb24"
    graphs = {
        "box": f"{black},drawbox=x=340:y=760:w=400:h=400:color=white:t=fill",
        "waves": f"{black},geq=r='128+100*sin(X/9)':g='128+100*sin(Y/9)':b=96",
        "ramp": f"{black},geq=r='X*255/1079':g='Y*255/1919':b=40",
        "grid": f"{black},geq=r='{SQUARES}':g='{SQUARES}':b='{SQUARES}'",
        "dots": f"{black}" + "".join(f",drawbox=x={x}:y={y}:w=24:h=24:color=white:t=fill" for x, y in ((0, 0), (1056, 1896), (628, 1048))),
    }
    return {name: make(folder / f"{name}.png", *LAVFI, graph, "-frames:v", "1") for name, graph in graphs.items()}


def drawn(client, settings, picture: bytes, *stack: dict) -> np.ndarray:
    """The frame at 1 s with `picture` as an Overlay filling it, through the Video Effects `stack`."""
    item = upload(client, picture, "picture.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": item["id"], "start": 0.0, "secs": 2.0, "transform": {"scale": 1}, "video_effects": list(stack)}
    return frame_at(client, settings, job, candidate, 1.0, overlays=[shown])


def test_pixelate_makes_blocks_of_one_colour_of_the_planned_size(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    plain = drawn(client, settings, pictures["waves"])
    blocky = drawn(client, settings, pictures["waves"], {"id": "pixelate", "params": {"size": 32}})

    def spread(frame: np.ndarray, at: int = 0) -> np.ndarray:
        """The largest channel's spread within each 32 px square of an area, from `at` across and
        down, inset 4 px from its sides."""
        area = frame[192 + at : 512 + at, 64 + at : 1024 + at].reshape(10, 32, 30, 32, 3)[:, 4:28, :, 4:28]
        return area.std(axis=(1, 3)).max(axis=-1)

    # Blocks counted from the picture's top left, each one colour; the waves vary within any square.
    assert spread(blocky).max() < 2, spread(blocky).max()
    assert np.median(spread(plain)) > 30, np.median(spread(plain))
    # Squares straddling the blocks hold two or four colours.
    assert np.median(spread(blocky, 16)) > 30, np.median(spread(blocky, 16))


@pytest.mark.parametrize("levels", [3, 5])
def test_posterize_leaves_at_most_its_levels_in_each_channel(client, settings, video_source, plain_video, pictures, levels):
    video_source.video = plain_video
    steps = np.linspace(0, 255, levels)

    def near_a_step(frame: np.ndarray) -> list[float]:
        """For each channel, the share of an area's values within 12 of one of the steps (the rest
        are where bands meet, which the 4:2:0 frame softens)."""
        area = frame[100:1300].astype(float)
        off = np.abs(area[..., None] - steps).min(axis=-1)
        return [float((off[..., channel] < 12).mean()) for channel in range(3)]

    assert min(near_a_step(drawn(client, settings, pictures["ramp"]))[:2]) < 0.6
    banded = near_a_step(drawn(client, settings, pictures["ramp"], {"id": "posterize", "params": {"levels": levels}}))
    assert min(banded) > 0.98, banded


def edge_width(profile: np.ndarray) -> int:
    """How many pixels an edge's profile takes to rise from 10 % to 90 % of its height."""
    share = (profile - profile.min()) / (profile.max() - profile.min())
    return int(((share > 0.1) & (share < 0.9)).sum())


def test_motion_blur_at_angle_0_smears_a_vertical_edge_across_but_not_a_horizontal_one(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video

    def edges(frame: np.ndarray) -> tuple[int, int]:
        """The widths of the box's left edge (x 340), across, and of its top edge (y 760), down."""
        grey = frame.mean(axis=-1)
        return edge_width(grey[940:980, 300:380].mean(axis=0)), edge_width(grey[720:800, 520:560].mean(axis=1))

    assert edges(drawn(client, settings, pictures["box"])) == (0, 0)
    across, down = edges(drawn(client, settings, pictures["box"], {"id": "motion-blur", "params": {"length": 20, "angle": 0}}))
    assert across > 30 and down <= 1, (across, down)


def test_chromatic_aberration_parts_red_and_blue_more_at_the_edges_than_at_the_centre(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video

    def fringe(frame: np.ndarray, x: int, y: int) -> float:
        """How far red and blue differ about the grid's square at (x, y)."""
        apart = np.abs(frame[..., 0].astype(float) - frame[..., 2])
        return float(apart[y - 40 : y + 64, max(0, x - 40) : x + 64].sum())

    assert fringe(drawn(client, settings, pictures["grid"]), 0, 960) == 0
    split = drawn(client, settings, pictures["grid"], {"id": "chromatic-aberration", "params": {"shift": 24}})
    # The squares 48 px left of the centre, at the left edge and 432 px right of the centre.
    centre, left, right = fringe(split, 480, 960), fringe(split, 0, 960), fringe(split, 960, 960)
    assert left > 3 * centre and right > 3 * centre, (centre, left, right)


def test_fisheye_moves_the_middle_outward_and_keeps_the_corners(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video

    def square(frame: np.ndarray, top: int, left: int, size: int) -> tuple[float, float]:
        """The centre (x, y) of the white within the area `size` square from (left, top)."""
        ys, xs = np.nonzero(frame[top : top + size, left : left + size].mean(axis=-1) > 128)
        return left + xs.mean(), top + ys.mean()

    plain = drawn(client, settings, pictures["dots"])
    bulged = drawn(client, settings, pictures["dots"], {"id": "fisheye", "params": {"strength": 100}})
    # The square 100 px right of and down from the centre goes further out.
    x, y = square(bulged, 1000, 560, 320)
    assert square(plain, 1000, 560, 320) == (639.5, 1059.5)
    assert x > 700 and y > 1120, (x, y)
    # The corners' pixels are the picture's corners still, their squares close by.
    for top, left in ((0, 0), (1820, 980)):
        (x0, y0), (x1, y1) = square(plain, top, left, 100), square(bulged, top, left, 100)
        assert abs(x1 - x0) < 10 and abs(y1 - y0) < 10, ((x0, y0), (x1, y1))
    assert bulged[1, 1].min() > 200 and bulged[1918, 1078].min() > 200


def test_each_effect_runs_on_a_small_odd_sized_picture_and_within_a_span():
    """An Overlay drawn small, at odd sizes, and an Adjustment Layer's span (`enable`)."""
    for effect in effects():
        params = {setting.key: setting.max if setting.type == NUMBER else setting.default for setting in effect.settings}
        chain = video_effect_chain([VideoEffect(effect.id, params)], (37, 91), enable="between(t\\,0.2\\,0.6)", frame=PORTRAIT.size)
        assert played(["scale=37:91", *chain, "scale=1080:1920"]) == ((1080, 1920), 30), effect.id


def test_every_effect_at_once_renders_on_segments_overlays_a_keyed_overlay_and_a_layer(client, settings, video_source, ramp_video, pictures):
    """One graph with every effect on several pictures: their own filtergraphs' labels don't clash."""
    video_source.video = ramp_video
    image = upload(client, pictures["grid"], "grid.png").json()
    job = reviewed(client)
    # The keys (Cutout) are an Overlay's only.
    stack = [{"id": effect.id} for effect in effects() if not effect.keys]
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"))
    shown = {"media": image["id"], "start": 0.0, "secs": 1.5, "video_effects": stack}
    candidate = patch(
        client, job, add(client, job, "halo", "ya"),
        segments=[piece | {"video_effects": stack} for piece in pieces],
        transitions=[{"after": "s0", "kind": "fade", "secs": 0.4}],
        overlays=[{"id": "o", **shown, **SHOWN_AT}, {"id": "k", **shown, **HELD}],
        adjustment_layers=[{"id": "a", "start": 0.5, "secs": 1.0, "video_effects": stack}],
    )
    render(client, job)
    [clip] = [clip for clip in rendered(client, job, timeout=120)["clips"] if clip["candidate_id"] == candidate["id"]]
    assert clip["status"] == "done", clip["error"]
