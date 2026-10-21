"""Keyed video Overlays and decorated keyed pictures
(.scratch/keyframes/issues/02-keyed-video-overlay-and-decoration.md): Seam A through the API and
the real ffmpeg, a video decoded for its frame process, and corners, border and shadow drawn by it."""

import json
import math
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Keyframe, Overlay, Transform
from app.canvas import PORTRAIT
from app.config import RenderTuning
from app.keyframes import value_at
from app.planner import MediaInfo, Picture, picture_at, plan_render
from app.renderer import Renderer
from app.video_source import SourceMetadata
from test_keyframes import FIXTURES, clip_of
from test_media_library import make, upload
from test_render import add, full_frame, pixels, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import patch

BLUE = np.array([0, 0, 255])
# The frame-numbered video's frame rate, and how many bits of its number it shows.
NUMBERED_FPS = 30
BITS = 8


@pytest.fixture(scope="session")
def items(tmp_path_factory) -> dict[str, bytes]:
    """A 4 s 320x180 video at 30 fps whose top half is blue and whose bottom half shows its frame's
    number in BITS blocks across, the lowest bit first, white for a 1 and black for a 0; a blue
    200x100 PNG; and a 200x200 PNG of four coloured quadrants."""
    folder = tmp_path_factory.mktemp("keyed-pictures")
    lavfi = ("-f", "lavfi", "-i")
    bit = f"255*mod(floor(N/pow(2,floor(X/{320 // BITS}))),2)"
    numbered = (
        f"color=c=black:size=320x180:rate={NUMBERED_FPS}:duration=4,format=gbrp,"
        f"geq=r='if(lt(Y,90),0,{bit})':g='if(lt(Y,90),0,{bit})':b='if(lt(Y,90),255,{bit})'"
    )
    quadrants = (
        "color=c=red:s=200x200[a];color=c=lime:s=100x100[b];color=c=blue:s=100x100[c];color=c=yellow:s=100x100[d];"
        "[a][b]overlay=100:0[ab];[ab][c]overlay=0:100[abc];[abc][d]overlay=100:100[out0]"
    )
    return {
        "numbered": make(folder / "numbered.mp4", *lavfi, numbered, "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p"),
        "blue": make(folder / "blue.png", *lavfi, "color=c=0x0000ff:size=200x100", "-frames:v", "1"),
        "quadrants": make(folder / "quadrants.png", *lavfi, quadrants, "-frames:v", "1"),
    }


def test_a_keyed_video_overlay_moves_as_keyed_and_shows_the_frame_of_its_time(client, settings, video_source, plain_video, items):
    video_source.video = plain_video
    numbered = upload(client, items["numbered"], "numbered.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 320x180 fits as 1080x607.5: at 0.5, 540x304, its blue half 152 high above its centre.
    start, offset = 0.31, 1.0
    slide = {"x": [{"at": 0, "value": 200}, {"at": 2, "value": 800}]}
    shown = {"id": "o", "media": numbered["id"], "start": start, "secs": 2.4, "offset": offset}
    candidate = patch(client, job, candidate, overlays=[{**shown, "transform": {"y": 600, "scale": 0.5}, "keys": slide}])
    video = clip_of(client, settings, job, candidate)

    keys = [Keyframe(start, 200.0), Keyframe(start + 2, 800.0)]
    for at in (1.0, 2.0):
        frame = full_frame(settings, video, at)
        rows, columns = pixels(frame, BLUE, tolerance=60)
        centre = value_at(keys, at, 0)
        assert abs(columns.mean() - centre) <= 2 and abs(rows.mean() - (600 - 76)) <= 2, (at, columns.mean(), rows.mean())
        # The video from its first frame at its offset, one frame of it every 1/30 s since its start.
        expected = math.ceil(offset * NUMBERED_FPS) + math.floor((at - start) * NUMBERED_FPS)
        left, row = columns.mean() - 270, 600 + 76
        shown_bits = [frame[row, round(left + (i + 0.5) * 540 / BITS)].mean() > 128 for i in range(BITS)]
        assert sum(bit << i for i, bit in enumerate(shown_bits)) == expected, (at, shown_bits)


def test_a_keyed_decorated_picture_held_at_its_constants_matches_the_still_one(client, settings, video_source, plain_video, items):
    video_source.video = plain_video
    quadrants = upload(client, items["quadrants"], "quadrants.png").json()
    job = reviewed(client)
    decoration = {
        "radius": 0.25,
        "border": {"width": 6, "colour": "#FFFFFF"},
        "shadow": {"blur": 24, "x": 12, "y": 18, "colour": "#200040", "opacity": 0.7},
    }
    shown = {"id": "o", "media": quadrants["id"], "start": 0.0, "secs": 2.0, **decoration}
    still = {**shown, "transform": {"x": 540, "y": 700, "scale": 0.3, "rotation": 90, "opacity": 0.8}}
    held = {
        "scale": [{"at": 0, "value": 0.3}, {"at": 2, "value": 0.3}],
        "rotation": [{"at": 0, "value": 90}, {"at": 2, "value": 90}],
        "opacity": [{"at": 1, "value": 0.8}],
    }
    frames = []
    for overlay in (still, {**shown, "transform": {"x": 540, "y": 700}, "keys": held}):
        candidate = add(client, job, "Podcast", "ya", selected=False)
        candidate = patch(client, job, candidate, overlays=[overlay])
        frames.append(full_frame(settings, clip_of(client, settings, job, candidate), 1.0))
    # Its box, 324x324 about (540, 700), its shadow's room, and a margin round them. Turned a
    # quarter, the still chain's picture lands on whole pixels as the frame process's does (at other
    # angles it is up to half a pixel off, which its border's hard edges make 30 dB); and a shadow
    # turned with the picture would fall -18, 12 from it, not 12, 18.
    area = (slice(700 - 290, 700 + 290), slice(540 - 290, 540 + 290))
    error = np.mean((frames[0][area] - frames[1][area]) ** 2)
    assert 10 * np.log10(255**2 / max(error, 1e-9)) > 40, error


def test_a_keyed_pictures_border_is_as_wide_in_pixels_at_half_its_size_as_at_its_whole(client, settings, video_source, plain_video, items):
    video_source.video = plain_video
    blue = upload(client, items["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 200x100 fits as 1080x540: 540x270 at 0.5 until 1 s, then 1080x540 from 1.5 s.
    zoom = {"scale": [{"at": 0, "value": 0.5}, {"at": 1, "value": 0.5}, {"at": 1.5, "value": 1}]}
    overlay = {"id": "o", "media": blue["id"], "start": 0.0, "secs": 2.5, "border": {"width": 8, "colour": "#FF0000"}, "keys": zoom}
    video = clip_of(client, settings, job, patch(client, job, candidate, overlays=[overlay]))

    widths = []
    for at, across in ((0.5, 540), (2.0, 1080)):
        frame = full_frame(settings, video, at)
        # Along the picture's middle row: red at both its edges, blue between.
        row = frame[960]
        red = (row[:, 0] > 128) & (row[:, 2] < 128)
        assert np.count_nonzero((row[:, 2] > 128) & (row[:, 0] < 128)) >= across - 2 * 8 - 4, at
        left = 540 - across // 2
        widths += [np.count_nonzero(red[max(left - 4, 0) : left + 20]), np.count_nonzero(red[left + across - 20 : left + across + 4])]
    assert all(abs(width - 8) <= 1 for width in widths), widths


def test_a_keyed_pictures_corners_are_rounded_in_step_with_its_size():
    # The preview reads the same file (frontend/src/pages/job/editor/picture.test.ts).
    keyed = json.loads((FIXTURES / "keyed_picture.json").read_text())
    picture = TypeAdapter(Picture).validate_python(keyed["picture"])
    assert picture.radius > 0
    for at in keyed["at"]:
        drawn = picture_at(picture, at["time"], frame=PORTRAIT.size)
        assert drawn.radius == pytest.approx(picture.radius * min(drawn.width, drawn.height) / min(picture.width, picture.height))
        assert drawn.radius == pytest.approx(at["radius"], abs=1e-6)


def test_a_keyed_video_that_cant_be_decoded_stops_the_encode_and_says_why(settings, plain_video, tmp_path):
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    keys = {"x": [Keyframe(0.0, 200.0), Keyframe(1.0, 800.0)]}
    overlay = Overlay("o", "v", 0.0, 1.0, transform=Transform(scale=0.25), keys=keys)
    plan = plan_render(0.0, 2.0, SourceMetadata(10.0, 25.0, 640, 360, "h264"), overlays=[overlay], media_info={"v": MediaInfo(320, 180, 4.0, False)}, canvas=PORTRAIT)
    renderer = Renderer(settings.ffmpeg_bin, RenderTuning(encoders=("libx264",)))
    with pytest.raises(RuntimeError, match="A keyed picture couldn't be drawn: The video broken.mp4 couldn't be decoded"):
        renderer.render(plain_video, plan, tmp_path / "clip.mp4", tmp_path / "clip.jpg", files={"v": broken})
    assert not (tmp_path / "clip.mp4").exists()
