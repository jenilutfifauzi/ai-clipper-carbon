"""Chroma key and Luma key (.scratch/video-effects/issues/06-chroma-key-and-luma-key.md, ADR 0014):
the keys run by the real ffmpeg, keeping an alpha; what is refused (a bad colour, a key on a Segment
or an Adjustment Layer); then Seam A through the API and the real ffmpeg, an Overlay keyed over the
Source's plain picture. Each effect's chain at its defaults, minimums and maximums keeping a 1 s
clip's size and length is run in test_video_effects.py."""

import subprocess

import numpy as np
import pytest

from app.config import load_settings
from app.video_effects import VideoEffect, catalogue, checked_video_effects, video_effect_chain
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import make, upload
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import frame_at
from test_segments import ranges

LAVFI = ("-f", "lavfi", "-i")
FRAME = "size=1080x1920"
# The plain Source under the Overlays (test_render's plain_video), as rendered.
UNDER = np.array([74, 85, 96])
# Broadcast green, Chroma key's default.
GREEN = "0x00B140"


# The keys


def keyed(screen: str, boxes: str, *stack: VideoEffect, frames: int = 30) -> np.ndarray:
    """The frames of 1 s of a 1080x1920 picture at 30 fps, the colour `screen` with the drawboxes
    `boxes` on it, through `stack`, RGBA."""
    chain = video_effect_chain(checked_video_effects(list(stack), "Overlay o", keyed=True), (1080, 1920))
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error", *LAVFI, f"color=c={screen}:{FRAME}:rate=30:duration=1,{boxes}",
        "-vf", ",".join([*chain, "format=rgba"]), "-f", "rawvideo", "-",
    ]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(frames, 1920, 1080, 4)


@pytest.mark.parametrize("corner", ["default", "min", "max"])
@pytest.mark.parametrize("effect", ["chroma-key", "luma-key"])
def test_each_key_keeps_an_alpha_over_a_1_s_clip(effect, corner):
    kind = next(kind for kind in catalogue() if kind["id"] == effect)
    params = {setting["key"]: setting.get(corner, setting["default"]) for setting in kind["settings"]}
    # Green, a red box and a black one.
    boxes = "drawbox=x=100:y=100:w=200:h=200:color=red:t=fill,drawbox=x=500:y=100:w=200:h=200:color=black:t=fill"
    frames = keyed(GREEN, boxes, VideoEffect(effect, params))
    assert frames.shape == (30, 1920, 1080, 4)
    # Every frame has part taken out, but at Luma key's extremes: none darker than 0, inverted none lighter than 100.
    alpha = frames[..., 3].reshape(30, -1)
    assert (alpha.min(axis=1) == (255 if effect == "luma-key" and corner != "default" else 0)).all()
    if corner == "default":
        # The red box kept; the green screen or the black box taken out.
        assert (frames[:, 200, 200, 3] == 255).all()
        assert (frames[:, 1000, 540, 3] == 0).all() if effect == "chroma-key" else (frames[:, 200, 600, 3] == 0).all()


def test_chroma_key_takes_out_its_colour_and_its_spill():
    boxes = "drawbox=x=100:y=100:w=200:h=200:color=red:t=fill,drawbox=x=500:y=100:w=200:h=200:color=0x60A070:t=fill"
    [frame] = keyed(GREEN, boxes, VideoEffect("chroma-key"))[:1]
    assert frame[1000, 540, 3] == 0 and frame[200, 200, 3] == 255
    # A greenish grey, kept at a narrow similarity, loses its lean to green with the spill.
    narrow = {"similarity": 5, "softness": 0}
    kept = keyed(GREEN, boxes, VideoEffect("chroma-key", narrow | {"spill": 0}))[0, 200, 600].astype(int)
    cleaned = keyed(GREEN, boxes, VideoEffect("chroma-key", narrow | {"spill": 100}))[0, 200, 600].astype(int)
    assert kept[3] == cleaned[3] == 255
    assert kept[1] - kept[0] > 40 and cleaned[1] - cleaned[0] < kept[1] - kept[0] - 30, (kept, cleaned)
    # Another key colour takes out that colour instead.
    [blue] = keyed("0x1030E0", boxes, VideoEffect("chroma-key", {"color": "#1030e0"}))[:1]
    assert blue[1000, 540, 3] == 0 and blue[200, 200, 3] == 255


def test_a_key_is_checked_its_colour_in_capitals_and_refused_on_a_picture_other_than_an_overlay():
    [key] = checked_video_effects([VideoEffect("chroma-key", {"color": "#00ff00"})], "Overlay o", keyed=True)
    assert key == VideoEffect("chroma-key", {"color": "#00FF00", "similarity": 30.0, "softness": 10.0, "spill": 50.0})
    for stack, item, message in (
        ([VideoEffect("chroma-key", {"color": "green"})], "Overlay o", "Overlay o's video_effects[0] (chroma-key) color is 'green'; it is a colour, #RRGGBB"),
        ([VideoEffect("chroma-key", {"color": 3})], "Overlay o", "Overlay o's video_effects[0] (chroma-key) color is 3; it is a colour, #RRGGBB"),
        ([VideoEffect("chroma-key", {"similarity": "30"})], "Overlay o", "Overlay o's video_effects[0] (chroma-key) similarity is '30'; it is 1 to 60"),
        ([VideoEffect("luma-key", {"invert": 2})], "Overlay o", "Overlay o's video_effects[0] (luma-key) invert is 2; it is 0 to 1"),
        ([VideoEffect("luma-key")], "Segment s", "Segment s's video_effects[0] (luma-key) is a key (Cutout): only an Overlay takes one"),
    ):
        with pytest.raises(ValueError) as refused:
            checked_video_effects(stack, item, keyed=item.startswith("Overlay"))
        assert message in str(refused.value), str(refused.value)


def test_the_catalogue_lists_the_key_colour_with_its_default():
    chroma = next(kind for kind in catalogue() if kind["id"] == "chroma-key")
    assert chroma["category"] == "Cutout"
    assert chroma["settings"][0] == {"key": "color", "label": "Key colour", "type": "color", "default": "#00B140", "intensity": False}
    assert [setting["key"] for setting in chroma["settings"] if setting["intensity"]] == ["similarity"]


# Seam A: the API and the real ffmpeg


@pytest.fixture(scope="session")
def screens(tmp_path_factory) -> dict[str, bytes]:
    """320x180 PNGs, each a 120 px wide red band down its middle (x 100 to 220) on a screen: broadcast
    green (`green`), black (`black`) or white (`white`); and the other way round, red with a green band
    (`framed`)."""
    folder = tmp_path_factory.mktemp("screens")
    band = "drawbox=x=100:y=0:w=120:h=180:color={}:t=fill"
    screens = {"green": (GREEN, RED), "black": ("black", RED), "white": ("white", RED), "framed": (RED, GREEN)}
    return {
        name: make(folder / f"{name}.png", *LAVFI, f"color=c={screen}:size=320x180,{band.format(banded)}", "-frames:v", "1")
        for name, (screen, banded) in screens.items()
    }


RED = "0xD02020"
# At scale 0.5 a 320x180 picture is drawn 540x304 about (540, 700): x 270 to 810, y 548 to 852; its
# band from x 439 to 641.
SHOWN = {"start": 0.0, "secs": 2.0, "transform": {"x": 540, "y": 700, "scale": 0.5}}
SCREEN = (slice(600, 800), slice(300, 400))
BAND = (slice(600, 800), slice(470, 610))


def overlaid(client, settings, picture: bytes, *stack: dict, **fields) -> np.ndarray:
    """The frame at 1 s with `picture` as an Overlay (SHOWN, with `fields`) drawn through `stack`."""
    item = upload(client, picture, "screen.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": item["id"], **SHOWN, **fields, "video_effects": list(stack)}
    return frame_at(client, settings, job, candidate, 1.0, overlays=[shown]).astype(int)


def colour(frame: np.ndarray, area: tuple[slice, slice]) -> np.ndarray:
    return frame[area].reshape(-1, 3).mean(axis=0)


def test_a_green_overlay_with_chroma_key_shows_the_frame_beneath_where_it_was_green(client, settings, video_source, plain_video, screens):
    video_source.video = plain_video
    plain = overlaid(client, settings, screens["green"])
    assert colour(plain, SCREEN)[1] > 140, colour(plain, SCREEN)
    frame = overlaid(client, settings, screens["green"], {"id": "chroma-key"})
    assert np.abs(colour(frame, SCREEN) - UNDER).max() < 8, colour(frame, SCREEN)
    band = colour(frame, BAND)
    assert band[0] > 170 and band[1] < 70, band


@pytest.mark.parametrize(("screen", "params"), [("black", {}), ("white", {"invert": 1, "threshold": 90})])
def test_luma_key_shows_the_frame_beneath_where_it_was_black_or_inverted_white(client, settings, video_source, plain_video, screens, screen, params):
    video_source.video = plain_video
    frame = overlaid(client, settings, screens[screen], {"id": "luma-key", "params": params})
    assert np.abs(colour(frame, SCREEN) - UNDER).max() < 8, colour(frame, SCREEN)
    band = colour(frame, BAND)
    assert band[0] > 170 and band[1] < 70, band


def test_a_keyed_overlay_keeps_its_rounded_corners_and_its_shadow_falls_from_what_the_key_kept(client, settings, video_source, plain_video, screens):
    video_source.video = plain_video
    shadow = {"blur": 0, "x": 0, "y": 40, "colour": "#000000", "opacity": 1}
    # Red with a green band keyed out; its corners rounded 0.2 of its 304 px side (61 px).
    frame = overlaid(client, settings, screens["framed"], {"id": "chroma-key"}, radius=0.2, shadow=shadow)
    # The key's alpha: the band shows what is under it.
    assert np.abs(colour(frame, BAND) - UNDER).max() < 8, colour(frame, BAND)
    assert colour(frame, SCREEN)[0] > 170, colour(frame, SCREEN)
    # The corners: the picture's top left corner is cut off.
    assert np.abs(colour(frame, (slice(550, 556), slice(272, 278))) - UNDER).max() < 12, frame[553, 275]
    # The shadow, 40 px down, falls below the picture's bottom (852) from the red alone, not the band.
    assert colour(frame, (slice(870, 885), slice(340, 400))).max() < 20, frame[878, 370]
    assert np.abs(colour(frame, (slice(870, 885), slice(480, 600))) - UNDER).max() < 8, frame[878, 540]


def test_a_key_on_a_segment_or_an_adjustment_layer_is_refused_by_the_api(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [segment] = ranges(job, ("halo", "kabar"))
    response = client.patch(candidate_url(job, candidate), json={"segments": [segment | {"video_effects": [{"id": "chroma-key"}]}]})
    assert response.status_code == 422 and "Segment s0's video_effects[0] (chroma-key) is a key (Cutout)" in response.text, response.text
    layer = {"id": "a", "start": 0.0, "secs": 1.0, "video_effects": [{"id": "luma-key"}]}
    response = client.patch(candidate_url(job, candidate), json={"adjustment_layers": [layer]})
    assert response.status_code == 422 and "Adjustment Layer a's video_effects[0] (luma-key) is a key (Cutout)" in response.text, response.text
    keyed = {"id": "o", "media": "ab" * 16, "start": 0, "secs": 1, "video_effects": [{"id": "chroma-key", "params": {"color": "#00B14"}}]}
    response = client.patch(candidate_url(job, candidate), json={"overlays": [keyed]})
    assert response.status_code == 422 and "color is '#00B14'; it is a colour, #RRGGBB" in response.text, response.text


@pytest.mark.anyio
async def test_the_agent_keys_an_overlay_and_is_refused_a_key_on_a_segment_or_an_adjustment_layer(mcp, screens, tmp_path):
    path = tmp_path / "green.png"
    path.write_bytes(screens["green"])
    image = await call(mcp, "add_asset", path=str(path), kind="media")
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [{"id": "o", "media": image["id"], "start": 0, "secs": 0.5}]})
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "video_effects": [{"id": "chroma-key", "params": {"color": "#00ff00"}}]}])
    assert merged["overlays"][0]["video_effects"] == [
        {"id": "chroma-key", "params": {"color": "#00FF00", "similarity": 30, "softness": 10, "spill": 50}, "enabled": True}
    ]
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["overlays"][0]["video_effects"] == [{"id": "chroma-key", "params": {"color": "#00FF00", "similarity": 30, "softness": 10, "spill": 50}}]

    segment = {"id": "s", "start": HALO_KABAR[0], "end": HALO_KABAR[1], "video_effects": [{"id": "chroma-key"}]}
    message = await fails(mcp, "edit_candidate", **ids, changes={"segments": [segment]})
    assert "Segment s's video_effects[0] (chroma-key) is a key (Cutout)" in message, message
    message = await fails(mcp, "merge_candidate_items", **ids, adjustment_layers=[{"id": "a", "start": 0, "secs": 0.5, "video_effects": [{"id": "luma-key"}]}])
    assert "Adjustment Layer a's video_effects[0] (luma-key) is a key (Cutout)" in message, message
    assert "chroma-key" in mcp.instructions and "for Overlays only" in mcp.instructions
