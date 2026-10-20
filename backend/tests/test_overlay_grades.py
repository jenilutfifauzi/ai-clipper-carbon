"""An Overlay's Grade, keyed pictures included (.scratch/color-adjust/issues/03-overlay-grade.md,
docs/adr/0013).

Seam B on the planner, then Seam A through the API and the real ffmpeg (a frame saved of a draft), on
pictures of known colours, keyed ones drawn by their frame processes too, and through MCP.
"""

import numpy as np
import pytest

from app.candidates import Adjust, Grade, Overlay
from app.planner import MediaInfo, overlay_events
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_segment_grades import frame_at
from test_media_segments import clips  # noqa: F401
from test_segments import ramp_video  # noqa: F401
from test_review import patch

VIDEO, IMAGE = "ab" * 16, "cd" * 16
WARM_DULL = {"adjust": {"temperature": 11000, "saturation": -60}}


# Seam B: the planner


def test_overlay_events_carry_their_grade_as_given():
    warm = Grade(Adjust(temperature=9000, contrast=20))
    items = {VIDEO: MediaInfo(640, 360, 4.0, True), IMAGE: MediaInfo(200, 100, None, False)}
    events = overlay_events([
        Overlay("v", VIDEO, 0.0, 1.0, grade=warm),
        Overlay("i", IMAGE, 0.0, 1.0),
    ], 10, items)
    assert [event.grade for event in events] == [warm, Grade()]


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def colours(tmp_path_factory) -> dict[str, bytes]:
    """A 4 s 320x180 video and a 320x180 PNG, each its left half grey (128) and its right half red;
    and a 320x180 PNG whose left half is transparent and whose right half is red."""
    folder = tmp_path_factory.mktemp("graded-overlays")
    lavfi = ("-f", "lavfi", "-i")
    halves = "color=c=0x808080:size=320x180:rate=30:duration=4,drawbox=x=160:y=0:w=160:h=180:color=0xD02020:t=fill"
    see_through = "color=c=0xD02020:size=320x180,format=rgba,geq=r=208:g=32:b=32:a='if(lt(X,160),0,255)'"
    return {
        "video": make(folder / "halves.mp4", *lavfi, halves, "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p"),
        "image": make(folder / "halves.png", *lavfi, halves, "-frames:v", "1"),
        "see_through": make(folder / "see_through.png", *lavfi, see_through, "-frames:v", "1"),
    }


# At scale 0.5 a 320x180 picture is drawn 540x304 about its centre (540, 700): its grey half from x 270
# to 540, its red half from 540 to 810, y 548 to 852.
SHOWN = {"start": 0.0, "secs": 2.0, "transform": {"x": 540, "y": 700, "scale": 0.5}}
# Its keyed form: the same transform, held by Keyframes, so that its frame process draws it.
HELD = {"start": 0.0, "secs": 2.0, "transform": {"x": 540, "y": 700}, "keys": {"scale": [{"at": 0, "value": 0.5}, {"at": 2, "value": 0.5}]}}


def grey_half(frame: np.ndarray) -> np.ndarray:
    return frame[650:750, 330:480].reshape(-1, 3).mean(axis=0)


def red_half(frame: np.ndarray) -> np.ndarray:
    return frame[650:750, 600:750].reshape(-1, 3).mean(axis=0)


def test_an_overlays_grade_changes_its_picture_but_not_its_border_nor_the_segment_under_it(
    client, settings, video_source, plain_video, colours,
):
    video_source.video = plain_video
    video = upload(client, colours["video"], "halves.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    framed = {"id": "o", "media": video["id"], **SHOWN, "border": {"width": 12, "colour": "#4080C0"}}
    candidate = patch(client, job, candidate, overlays=[framed])
    plain = frame_at(client, settings, job, candidate, 1.0)
    graded = frame_at(client, settings, job, candidate, 1.0, overlays=[framed | {"grade": WARM_DULL}])

    # Warmer and duller: the grey half's red up and its blue down, the red half less red.
    grey, warm = grey_half(plain), grey_half(graded)
    assert warm[0] > grey[0] + 8 and warm[2] < grey[2] - 8, (grey, warm)
    vivid, dull = (red_half(frame)[0] - red_half(frame)[1] for frame in (plain, graded))
    assert vivid > 100 and dull < vivid / 2, (red_half(plain), red_half(graded))
    # Its border keeps its colour: a strip along the inside of its top edge.
    border = lambda frame: frame[548 + 3 : 548 + 9, 350:730].reshape(-1, 3).mean(axis=0)
    assert np.abs(border(plain) - [0x40, 0x80, 0xC0]).max() < 12, border(plain)
    assert np.abs(border(graded) - border(plain)).max() < 4, (border(plain), border(graded))
    # The Segment under it, around the Overlay, is as it was.
    for area in ((slice(300, 500), slice(100, 980)), (slice(900, 1100), slice(100, 980)), (slice(560, 840), slice(40, 240))):
        assert np.abs(graded[area].astype(float) - plain[area]).mean() < 1, area


def test_a_graded_image_keeps_its_transparency_even_vignetted(client, settings, video_source, plain_video, colours):
    video_source.video = plain_video
    image = upload(client, colours["see_through"], "see_through.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": image["id"], **SHOWN}
    candidate = patch(client, job, candidate, overlays=[shown])
    plain = frame_at(client, settings, job, candidate, 1.0)
    graded = frame_at(client, settings, job, candidate, 1.0, overlays=[shown | {"grade": {"adjust": {"vignette": 80, "saturation": -100}}}])
    # Its transparent half still shows the Segment; its red half is greyed.
    see_through = (slice(650, 750), slice(330, 480))
    assert np.abs(graded[see_through].astype(float) - plain[see_through]).mean() < 2
    assert np.ptp(red_half(graded)) < 30 and np.ptp(red_half(plain)) > 100, (red_half(plain), red_half(graded))


@pytest.mark.parametrize("kind", ["video", "image"])
def test_a_keyed_overlay_with_a_grade_is_graded_like_its_unkeyed_form(client, settings, video_source, plain_video, colours, kind):
    video_source.video = plain_video
    item = upload(client, colours[kind], f"halves.{'mp4' if kind == 'video' else 'png'}").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    grade = {"adjust": {"temperature": 9500, "saturation": -60, "exposure": 1, "vignette": 40}}
    frames = {}
    for name, overlay in (("plain", SHOWN), ("still", SHOWN | {"grade": grade}), ("keyed", HELD | {"grade": grade})):
        frames[name] = frame_at(client, settings, job, candidate, 1.0, overlays=[{"id": "o", "media": item["id"], **overlay}]).astype(float)
    # Graded: far from the plain picture; keyed: as near the still one as its frame process draws it.
    assert np.abs(grey_half(frames["still"]) - grey_half(frames["plain"])).max() > 20
    for half in (grey_half, red_half):
        assert np.abs(half(frames["keyed"]) - half(frames["still"])).max() < 6, (kind, half(frames["still"]), half(frames["keyed"]))
    # A corner of the picture, darkened by the vignette, alike in both.
    corner = lambda frame: frame[552:572, 274:300].reshape(-1, 3).mean(axis=0)
    assert np.abs(corner(frames["keyed"]) - corner(frames["still"])).max() < 10, (corner(frames["still"]), corner(frames["keyed"]))


def test_a_keyed_media_segment_with_a_grade_is_graded_like_its_unkeyed_form(client, settings, video_source, ramp_video, colours):
    video_source.video = ramp_video
    video = upload(client, colours["video"], "halves.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]}
    # 320x180 fits the frame's width, 1080x607.5 about its centre (y 656 to 1264): grey left, red right.
    shown = {"id": "v", "start": 0, "end": 2, "media": video["id"], "framing": {"background": {"kind": "colour", "colour": "#000000"}}}
    held = shown | {"keys": {"scale": [{"at": 0, "value": 1}, {"at": 2, "value": 1}]}}
    grade = {"adjust": {"temperature": 9500, "saturation": -60, "exposure": 1}}
    candidate = patch(client, job, candidate, segments=[shown, episode])
    frames = {}
    for name, segment in (("plain", shown), ("still", shown | {"grade": grade}), ("keyed", held | {"grade": grade})):
        frames[name] = frame_at(client, settings, job, candidate, 1.0, segments=[segment, episode]).astype(float)
    grey = lambda frame: frame[860:1060, 100:440].reshape(-1, 3).mean(axis=0)
    red = lambda frame: frame[860:1060, 640:980].reshape(-1, 3).mean(axis=0)
    assert np.abs(grey(frames["still"]) - grey(frames["plain"])).max() > 20
    # Graded once, not twice: as near the still one as its frame process draws it.
    for half in (grey, red):
        assert np.abs(half(frames["keyed"]) - half(frames["still"])).max() < 6, (half(frames["still"]), half(frames["keyed"]))


# MCP


@pytest.mark.anyio
async def test_merge_sets_one_dial_of_an_overlays_grade_and_the_dry_run_lists_it(mcp, colours, tmp_path):
    path = tmp_path / "halves.png"
    path.write_bytes(colours["image"])
    image = await call(mcp, "add_asset", path=str(path), kind="media")
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "merge_candidate_items", **ids, overlays=[
        {"id": "o", "media": image["id"], "start": 0, "secs": 0.5, "grade": {"adjust": {"temperature": 7500}}},
        {"id": "p", "media": image["id"], "start": 0, "secs": 0.5},
    ])
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "grade": {"adjust": {"contrast": 30}}}])
    adjust = merged["overlays"][0]["grade"]["adjust"]
    assert (adjust["temperature"], adjust["contrast"], adjust["saturation"]) == (7500, 30, 0)

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    graded, plain = plan["overlays"]
    assert graded["grade"] == {"adjust": {"temperature": 7500, "contrast": 30}}
    assert "grade" not in plain
