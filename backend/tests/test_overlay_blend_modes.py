"""Blend Modes for Overlays (.scratch/video-effects/issues/07-overlay-blend-mode.md, ADR 0014): each
mode laid by the real ffmpeg; Seam B on the planner; then Seam A through the API, MCP and the real
ffmpeg: a light leak on black screened, a paper texture multiplied, keyed or not, and what is refused."""

import subprocess

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import BlendMode, Overlay
from app.canvas import PORTRAIT
from app.config import load_settings
from app.planner import MediaInfo, overlay_events
from app.renderer import _laid
from test_cutout_effects import BAND, RED, SCREEN, SHOWN, UNDER, colour, screens  # noqa: F401
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import upload
from test_render import add, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url
from test_segment_grades import frame_at

IMAGE = "cd" * 16
ITEMS = {IMAGE: MediaInfo(320, 180, None, False)}

# Each mode's colour of a picture `a` over `b`, both 0..1.
MIXED = {
    "multiply": lambda a, b: a * b,
    "screen": lambda a, b: 1 - (1 - a) * (1 - b),
    "add": lambda a, b: np.minimum(a + b, 1),
    "lighten": np.maximum,
    "darken": np.minimum,
}


# The modes


@pytest.mark.parametrize("mode", list(MIXED))
def test_each_mode_blends_the_picture_over_the_frame_only_within_its_alpha_and_span(mode):
    """A red 200x200 square, its right half at half alpha, over a plain grey-blue 1080x1920 frame for
    1 s at 10 fps, laid by `mode` from 0 to 0.5 s."""
    shows = "enable='between(t\\,0\\,0.5)'"
    picture = "color=c=0xD02020:size=200x200:rate=10:duration=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,100),255,128)'"
    laid = _laid("[0:v]", "pic", "x=540-overlay_w/2:y=960-overlay_h/2", f"{shows}:eof_action=pass", "[out]", BlendMode(mode), shows)
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error", "-f", "lavfi", "-i", "color=c=0x4a5560:size=1080x1920:rate=10:duration=1",
        "-f", "lavfi", "-i", picture, "-filter_complex", f"[1:v]format=rgba[pic];{laid};[out]format=rgb24[rgb]",
        "-map", "[rgb]", "-f", "rawvideo", "-",
    ]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(10, 1920, 1080, 3).astype(float)
    under = frames[0, 300, 300]
    mixed = MIXED[mode](np.array([0xD0, 0x20, 0x20]) / 255, under / 255) * 255
    # Within its alpha, the mode's colour; at half alpha, half way to it.
    assert np.abs(frames[2, 960, 480] - mixed).max() < 5, (frames[2, 960, 480], mixed)
    assert np.abs(frames[2, 960, 600] - (mixed + under) / 2).max() < 5, (frames[2, 960, 600], mixed, under)
    # Outside its alpha, and past its span, the frame as it was.
    assert (frames[2, 800, 540] == under).all() and (frames[2, 1100, 540] == under).all()
    assert (frames[8, 960, 480] == under).all()


def test_a_modes_work_runs_on_its_spans_frames_alone_and_draws_them_as_on_every_frame():
    """Screen of a moving picture over a moving frame, 3 s at 30 fps, from 1.21 to 1.9 s: the split,
    format changes, blend and masks get the span's frames alone (`_spanned`), and every frame is the
    one the same steps give run on every frame."""
    shows = "enable='between(t\\,1.210\\,1.900)'"
    at = "x=180-overlay_w/2:y=320-overlay_h/2"
    picture = "[1:v]format=rgba,setpts=PTS-STARTPTS+1.21/TB[pic]"
    graphs = {
        "spanned": _laid("[0:v]", "pic", at, f"{shows}:eof_action=pass", "[out]", BlendMode.SCREEN, shows, (1.21, 1.9, 30)),
        "every": _laid("[0:v]", "pic", at, f"{shows}:eof_action=pass", "[out]", BlendMode.SCREEN, shows),
    }
    assert "select='between(t" in graphs["spanned"] and "tpad=start=34" in graphs["spanned"], graphs["spanned"]
    assert "select" not in graphs["every"]

    def frames(graph: str) -> list[str]:
        command = [
            str(load_settings().ffmpeg_bin), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=3,format=yuv420p",
            "-f", "lavfi", "-i", "testsrc=size=160x120:rate=30:duration=0.7",
            "-filter_complex", f"{picture};{graph};[out]format=yuv420p[o]", "-map", "[o]", "-fps_mode", "passthrough", "-f", "framemd5", "-",
        ]
        listed = subprocess.run(command, capture_output=True, text=True, check=True).stdout
        return [line for line in listed.splitlines() if not line.startswith("#")]

    spanned, every_frame = frames(graphs["spanned"]), frames(graphs["every"])
    assert len(spanned) == 90 and spanned == every_frame


# Seam B: the planner


def test_an_overlays_blend_mode_reaches_its_event_and_one_stored_without_it_is_normal():
    events = overlay_events([Overlay("s", IMAGE, 0.0, 1.0, blend=BlendMode.SCREEN), Overlay("m", IMAGE, 0.0, 1.0, blend=BlendMode.MULTIPLY)], 10, ITEMS, canvas=PORTRAIT)
    assert [event.blend for event in events] == [BlendMode.SCREEN, BlendMode.MULTIPLY]
    stored = TypeAdapter(Overlay).validate_python({"id": "o", "media": IMAGE, "start": 0.0, "secs": 1.0})
    assert stored.blend is BlendMode.NORMAL
    [event] = overlay_events([stored], 10, ITEMS, canvas=PORTRAIT)
    assert event.blend is BlendMode.NORMAL


# Seam A: the API and the real ffmpeg


def blended(client, settings, picture: bytes, at: float = 1.0, **fields) -> np.ndarray:
    """The frame at `at` with `picture` as an Overlay (SHOWN, from 0 to 2 s, with `fields`)."""
    item = upload(client, picture, "screen.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    return frame_at(client, settings, job, candidate, at, overlays=[{"id": "o", "media": item["id"], **SHOWN, **fields}]).astype(int)


def test_screen_over_a_dark_frame_lightens_it_and_black_leaves_it_as_it_was(client, settings, video_source, plain_video, screens):
    video_source.video = plain_video
    normal = blended(client, settings, screens["black"], blend="normal")
    assert colour(normal, SCREEN).max() < 10, colour(normal, SCREEN)
    frame = blended(client, settings, screens["black"], blend="screen")
    assert np.abs(colour(frame, SCREEN) - UNDER).max() < 6, colour(frame, SCREEN)
    band = colour(frame, BAND)
    assert (band > UNDER + 15).all() and band[0] > 200, band
    # Outside the picture, the frame as it was.
    outside = (slice(1200, 1400), slice(300, 800))
    assert np.abs(colour(frame, outside) - colour(normal, outside)).max() < 1, (colour(frame, outside), colour(normal, outside))


def test_multiply_over_the_frame_darkens_it_and_white_leaves_it_as_it_was(client, settings, video_source, plain_video, screens):
    video_source.video = plain_video
    frame = blended(client, settings, screens["white"], blend="multiply")
    assert np.abs(colour(frame, SCREEN) - UNDER).max() < 6, colour(frame, SCREEN)
    band = colour(frame, BAND)
    assert (band < UNDER - 10).all(), band
    # Past its span (0 to 2 s), the frame as it was.
    after = blended(client, settings, screens["white"], at=2.5, blend="multiply")
    assert np.abs(colour(after, BAND) - UNDER).max() < 4, colour(after, BAND)


def test_a_half_transparent_multiply_overlay_counts_the_frame_beneath_once(client, settings, video_source, plain_video, screens):
    """At opacity 0.5, Multiply gives half the frame and half the frame times the picture: the colour
    the mode blends is the picture's own, not already mixed with the frame's."""
    video_source.video = plain_video
    half = {**SHOWN["transform"], "opacity": 0.5}
    frame = blended(client, settings, screens["white"], blend="multiply", transform=half)
    red = np.array([0xD0, 0x20, 0x20]) / 255
    expected = 0.5 * UNDER + 0.5 * UNDER * red
    assert np.abs(colour(frame, BAND) - expected).max() < 4, (colour(frame, BAND), expected)
    # White multiplied leaves the frame as it was, at any opacity.
    assert np.abs(colour(frame, SCREEN) - UNDER).max() < 4, colour(frame, SCREEN)


def test_a_keyed_overlay_with_screen_blends_like_an_unkeyed_one(client, settings, video_source, plain_video, screens):
    video_source.video = plain_video
    held = {"keys": {"scale": [{"at": 0, "value": 0.5}, {"at": 2, "value": 0.5}]}}
    keyed = blended(client, settings, screens["black"], blend="screen", **held)
    unkeyed = blended(client, settings, screens["black"], blend="screen")
    assert np.abs(colour(keyed, SCREEN) - UNDER).max() < 6, colour(keyed, SCREEN)
    assert np.abs(colour(keyed, BAND) - colour(unkeyed, BAND)).max() < 6, (colour(keyed, BAND), colour(unkeyed, BAND))


def test_an_overlays_blend_mode_is_saved_and_an_unknown_one_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    overlay = {"id": "o", "media": IMAGE, "start": 0, "secs": 1, "blend": "overlay"}
    response = client.patch(candidate_url(job, candidate), json={"overlays": [overlay]})
    assert response.status_code == 422 and "blend" in response.text and "'screen'" in response.text, response.text


@pytest.mark.anyio
async def test_the_agent_sets_a_blend_mode_sees_it_in_the_dry_run_and_is_refused_an_unknown_one(mcp, screens, tmp_path):
    path = tmp_path / "leak.png"
    path.write_bytes(screens["black"])
    image = await call(mcp, "add_asset", path=str(path), kind="media")
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    added = await call(mcp, "edit_candidate", **ids, changes={"overlays": [{"id": "o", "media": image["id"], "start": 0, "secs": 0.5}]})
    assert added["overlays"][0]["blend"] == "normal"
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert "blend" not in plan["overlays"][0]
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "blend": "screen"}])
    assert merged["overlays"][0]["blend"] == "screen"
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["overlays"][0]["blend"] == "screen"
    message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "blend": "overlay"}])
    assert "blend" in message, message
    assert "Blend Mode" in mcp.instructions and "multiply" in mcp.instructions
