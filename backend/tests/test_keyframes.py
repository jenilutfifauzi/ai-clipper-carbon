"""Keyframes and their Eases (.scratch/keyframes/issues/01-keyed-image-overlay.md): Seam K on the
sampling module, read from the Ease vectors both test suites share; Seam B on the planner; then
Seam A through the API, MCP and the real ffmpeg."""

import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import EASE_IN_OUT, LINEAR, Ease, Keyframe, MusicClip, Overlay, Transform
from app.config import FONTS_DIR, RenderTuning
from app.frames import PictureFrames
from app.keyframes import eased, value_at
from app.planner import Box, MediaInfo, Picture, on_frame, overlay_events, picture_at, plan_render
from app.renderer import Renderer
from app.video_source import SourceMetadata
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, full_frame, pixels, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

FIXTURES = Path(__file__).parent / "fixtures"

CLIP = "ab" * 16
STILL = "cd" * 16
SONG = "ef" * 16
WIDE = "12" * 16
BLUE = np.array([0, 0, 255])


# Seam K: the sampling module


VECTORS = json.loads((FIXTURES / "ease_vectors.json").read_text())


@pytest.mark.parametrize("vector", VECTORS["eases"], ids=lambda vector: vector["name"])
def test_each_ease_is_solved_as_the_shared_vectors_say(vector):
    ease = Ease(*vector["ease"])
    for x, y in vector["at"]:
        assert eased(ease, x) == pytest.approx(y, abs=VECTORS["tolerance"]), x


def test_the_value_holds_before_the_first_keyframe_and_after_the_last_and_eases_between():
    keys = [Keyframe(1.0, 200.0), Keyframe(3.0, 800.0, EASE_IN_OUT)]
    assert value_at([], 2.0, 540.0) == 540.0
    assert value_at(keys, 0.0, 540.0) == 200.0
    assert value_at(keys, 5.0, 540.0) == 800.0
    # Half way in time is half way for an in-out Ease; a quarter of the way is less than a quarter.
    assert value_at(keys, 2.0, 540.0) == pytest.approx(500.0)
    assert value_at(keys, 1.5, 540.0) == pytest.approx(200.0 + 600.0 * 0.129161931047)


def test_two_keyframes_a_frame_apart_step_within_that_frame():
    keys = [Keyframe(0.0, 0.0), Keyframe(1.0, 0.0), Keyframe(1.0 + 1 / 30, 1.0, LINEAR)]
    assert value_at(keys, 1.0, 0.5) == 0.0
    assert value_at(keys, 1.0 + 1 / 60, 0.5) == pytest.approx(0.5)
    assert value_at(keys, 1.0 + 1 / 30, 0.5) == 1.0


# Seam B: the planner


WIDE_ITEM = {WIDE: MediaInfo(1920, 1080, None, False)}


def test_a_keyed_overlay_plans_its_motion_in_timeline_time_with_its_drawn_size_at_scale_1():
    zoom = {"scale": [Keyframe(0.0, 1.0), Keyframe(2.0, 2.0, EASE_IN_OUT)]}
    overlay = Overlay("o1", WIDE, 1.0, 3.0, transform=Transform(scale=0.5, stretch_x=2), keys=zoom)
    [event] = overlay_events([overlay], 10, WIDE_ITEM)
    picture = event.picture
    assert picture.motion == {"scale": [Keyframe(1.0, 1.0), Keyframe(3.0, 2.0, EASE_IN_OUT)]}
    # 1920x1080 fits as 1080x607.5, stretched twice across.
    assert picture.unscaled == (2160.0, 607.5)
    # Its other fields are its constants', as an unkeyed picture's are.
    assert (picture.width, picture.height, picture.centre) == (1080, 304, (540, 960))
    [still] = overlay_events([Overlay("o1", WIDE, 1.0, 3.0, transform=Transform(scale=0.5, stretch_x=2))], 10, WIDE_ITEM)
    assert (still.picture.motion, still.picture.unscaled) == ({}, None)

    # Sampled half way, at 2 s into the Clip: scale 1.5 about the same centre.
    at = picture_at(picture, 2.0)
    assert (at.width, at.height, at.motion) == (3240.0, 911.25, {})
    assert (at.bounds.x, at.bounds.y, at.bounds.width, at.bounds.height) == (-1080, 504, 3240, 911)
    assert picture_at(picture, 0.0).width == 2160.0 and picture_at(picture, 9.0).width == 4320.0
    assert picture_at(still.picture, 2.0) is still.picture


def test_a_sampled_picture_stays_within_its_ranges_when_an_ease_overshoots():
    overshoot = Ease(0.34, 1.56, 0.64, 1)
    keys = {"opacity": [Keyframe(0.0, 0.0), Keyframe(1.0, 1.0, overshoot)], "x": [Keyframe(0.0, 540.0), Keyframe(1.0, 1080.0, overshoot)]}
    [event] = overlay_events([Overlay("o1", WIDE, 0.0, 2.0, keys=keys)], 10, WIDE_ITEM)
    at = picture_at(event.picture, 0.5)
    assert (at.opacity, at.centre[0]) == (1.0, 1080.0)


def test_a_keyed_picture_is_sampled_as_the_preview_samples_it():
    # The frontend's pictureAt is tested on the same file (frontend/src/pages/job/editor/picture.test.ts).
    keyed = json.loads((FIXTURES / "keyed_picture.json").read_text())
    picture = TypeAdapter(Picture).validate_python(keyed["picture"])
    for at in keyed["at"]:
        drawn = picture_at(picture, at["time"])
        assert drawn.centre == pytest.approx(tuple(at["centre"]), abs=1e-6)
        assert (drawn.width, drawn.height, drawn.rotation, drawn.opacity) == pytest.approx(
            (at["width"], at["height"], at["rotation"], at["opacity"]), abs=1e-6
        )
        assert TypeAdapter(Box).dump_python(drawn.bounds) == at["bounds"]


def test_a_keyed_zoomed_picture_is_planned_whole_not_trimmed_to_the_frame():
    zoomed = Transform(scale=3, x=200)
    [still] = overlay_events([Overlay("o1", WIDE, 0.0, 2.0, transform=zoomed)], 10, WIDE_ITEM)
    keys = {"x": [Keyframe(0.0, 200.0), Keyframe(2.0, 900.0)]}
    [moving] = overlay_events([Overlay("o1", WIDE, 0.0, 2.0, transform=zoomed, keys=keys)], 10, WIDE_ITEM)
    # Unkeyed, only what is on the frame is drawn; keyed, the part on the frame changes as it moves.
    assert on_frame(still.picture).crop != still.picture.crop
    assert on_frame(moving.picture) == moving.picture


def unkeyed_command() -> list[str]:
    """The encode of a Clip with an image and a video Overlay (neither keyed), a Music Clip and a
    hook, as the renderer writes it."""
    source = SourceMetadata(10.0, 30.0, 1920, 1080, "h264")
    items = {STILL: MediaInfo(200, 100, None, False), CLIP: MediaInfo(640, 360, 4.0, True), SONG: MediaInfo(0, 0, 30.0, True)}
    overlays = [
        Overlay("i", STILL, 0.5, 2.0, transform=Transform(x=300, y=400, scale=0.4, rotation=30, opacity=0.5)),
        Overlay("v", CLIP, 1.0, 1.5, transform=Transform(scale=0.3, flip_h=True)),
    ]
    music = [MusicClip("m", SONG, 0.0, 3.0, volume=0.5, fade_in=0.5)]
    plan = plan_render(2.0, 6.0, source, hook="Coba", overlays=overlays, music=music, media_info=items)
    files = {STILL: Path("/media/still.png"), CLIP: Path("/media/clip.mp4"), SONG: Path("/media/song.m4a")}
    renderer = Renderer(Path("/usr/bin/ffmpeg"), RenderTuning())
    out = Path("/out")
    command = renderer._command(Path("/jobs/source.mp4"), plan, None, "libx264", out / "v.mp4", out / "p.jpg", out / "s.ass", None, files)
    # The bundled fonts are wherever the checkout is.
    return [arg.replace(str(FONTS_DIR), "<fonts>") for arg in command]


def test_an_unkeyed_clips_encode_is_the_one_it_was_before_keyframes():
    assert unkeyed_command() == json.loads((FIXTURES / "unkeyed_command.json").read_text())


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def stills(tmp_path_factory) -> dict[str, bytes]:
    """A blue 200x100 PNG, and a 200x200 PNG of four coloured quadrants: red top left, green top
    right, blue bottom left, yellow bottom right."""
    folder = tmp_path_factory.mktemp("keyed")
    lavfi = ("-f", "lavfi", "-i")
    quadrants = (
        "color=c=red:s=200x200[a];color=c=lime:s=100x100[b];color=c=blue:s=100x100[c];color=c=yellow:s=100x100[d];"
        "[a][b]overlay=100:0[ab];[ab][c]overlay=0:100[abc];[abc][d]overlay=100:100[out0]"
    )
    return {
        "blue": make(folder / "blue.png", *lavfi, "color=c=0x0000ff:size=200x100", "-frames:v", "1"),
        "quadrants": make(folder / "quadrants.png", *lavfi, quadrants, "-frames:v", "1"),
        "green": make(folder / "green.mp4", *lavfi, "color=c=0x00ff00:size=320x180:rate=30:duration=3", "-c:v", "libx264"),
    }


def test_keyframes_a_frame_apart_are_kept_with_their_eases_as_four_numbers_and_others_are_refused(client, stills):
    blue = upload(client, stills["blue"], "blue.png").json()
    green = upload(client, stills["green"], "green.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    shown = {"id": "o", "media": blue["id"], "start": 0.0, "secs": 4.0}

    def keyed(keys: dict, **fields):
        return client.patch(candidate_url(job, candidate), json={"overlays": [{**shown, **fields, "keys": keys}]})

    response = keyed({"scale": [{"at": 1 / 30, "value": 2, "ease": "ease_out"}, {"at": 0, "value": 1}], "opacity": []})
    assert response.status_code == 200, response.text
    # Sorted by time, the Ease kept as its numbers, and a property without Keyframes left out.
    assert response.json()["overlays"][0]["keys"] == {
        "scale": [{"at": 0, "value": 1, "ease": [0, 0, 1, 1]}, {"at": 1 / 30, "value": 2, "ease": [0, 0, 0.58, 1]}],
    }
    # A centre is brought onto the frame, as a Transform's is; an Ease is tidied.
    response = keyed({"x": [{"at": 0, "value": 1500, "ease": [-1, 5, 2, 0.5]}]})
    assert response.json()["overlays"][0]["keys"]["x"] == [{"at": 0, "value": 1080, "ease": [0, 3, 1, 0.5]}]
    # A video Overlay can have them, and so can a decorated one (02).
    response = keyed({"scale": [{"at": 0, "value": 1}]}, media=green["id"], secs=2.0, radius=0.2, border={"width": 4})
    assert response.status_code == 200, response.text

    many = [{"at": round(i / 30, 4), "value": 1} for i in range(101)]
    for keys, fields, message in (
        ({"scale": [{"at": 0, "value": 1}, {"at": 0.02, "value": 2}]}, {}, "scale Keyframes at 0 s and 0.02 s are closer than a frame"),
        ({"opacity": many}, {}, "Overlay o has 101 opacity Keyframes; a property has 100 at most"),
        ({"x": [{"at": 4.5, "value": 100}]}, {}, "Overlay o's x Keyframe at 4.5 s is past its length of 4 s"),
        ({"scale": [{"at": 0, "value": 9}]}, {}, "Overlay o's scale Keyframe at 0 s is 9; scale is 0.05 to 8"),
        ({"opacity": [{"at": 0, "value": -0.5}]}, {}, "opacity is 0 to 1"),
        ({"volume": [{"at": 0, "value": 1}]}, {}, "Overlay o has no volume Keyframes"),
        ({"scale": [{"at": 0, "value": 1, "ease": "bounce"}]}, {}, "An Ease is linear, ease_in, ease_out, ease_in_out or four numbers"),
    ):
        response = keyed(keys, **fields)
        assert response.status_code == 422 and message in response.text, (keys, response.text)


@pytest.mark.anyio
async def test_the_agent_merges_keys_by_property_is_refused_a_stranding_change_and_dry_runs_them(mcp, stills, tmp_path):
    picture = tmp_path / "blue.png"
    picture.write_bytes(stills["blue"])
    item = await call(mcp, "add_asset", kind="media", path=str(picture))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    zoom = {"scale": [{"at": 0, "value": 1}, {"at": 1, "value": 2, "ease": "ease_in_out"}]}
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "media": item["id"], "start": 0.5, "secs": 1, "keys": zoom}])

    # Only the properties given change: the scale Keyframes stay.
    fade = {"opacity": [{"at": 0.5, "value": 1}, {"at": 1, "value": 0, "ease": [0.3, 0, 0.2, 1]}]}
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "keys": fade}])
    keys = merged["overlays"][0]["keys"]
    assert (keys["scale"][1]["ease"], keys["opacity"][1]["ease"]) == ([0.42, 0, 0.58, 1], [0.3, 0, 0.2, 1])
    # A length that would leave a Keyframe past it is refused, naming it.
    message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "secs": 0.8}])
    assert "Overlay o1's scale Keyframe at 1 s is past its length of 0.8 s; send its keys too" in message, message

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [view] = plan["overlays"]
    # In Timeline time, from its start at 0.5 s, with the presets by name.
    assert view["keys"] == {
        "scale": [{"at": 0.5, "value": 1, "ease": "linear"}, {"at": 1.5, "value": 2, "ease": "ease_in_out"}],
        "opacity": [{"at": 1.0, "value": 1, "ease": "linear"}, {"at": 1.5, "value": 0, "ease": [0.3, 0, 0.2, 1]}],
    }
    # 200x100 fits as 1080x540 about the frame's centre: at scale 1, 1.5 (half way, eased in and out) and 2.
    assert view["bounds_at_keys"] == [
        {"at": 0.5, "bounds": {"x": 0, "y": 690, "width": 1080, "height": 540}},
        {"at": 1.0, "bounds": {"x": -270, "y": 555, "width": 1620, "height": 810}},
        {"at": 1.5, "bounds": {"x": -540, "y": 420, "width": 2160, "height": 1080}},
    ]
    # merge_candidate_items' [] clears a property.
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "keys": {"opacity": []}}])
    assert list(merged["overlays"][0]["keys"]) == ["scale"]


def clip_of(client, settings, job: dict, candidate: dict) -> Path:
    render(client, job, [candidate["id"]])
    [clip] = [clip for clip in rendered(client, job, timeout=90)["clips"] if clip["candidate_id"] == candidate["id"]]
    assert clip["status"] == "done", clip["error"]
    return settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]


def test_an_image_keyed_across_the_frame_is_where_its_keyframes_put_it_in_each_frame(client, settings, video_source, plain_video, stills):
    video_source.video = plain_video
    blue = upload(client, stills["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    # 200x100 fits as 1080x540: at 0.25, 270x135.
    slide = {"x": [{"at": 0, "value": 200}, {"at": 2, "value": 800, "ease": "ease_in_out"}]}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "o", "media": blue["id"], "start": 0.0, "secs": 2.5, "transform": {"y": 600, "scale": 0.25}, "keys": slide},
    ])
    [event] = preview(client, job, candidate)["plan"]["overlays"]
    assert event["picture"]["motion"]["x"][1] == {"at": 2.0, "value": 800.0, "ease": [0.42, 0.0, 0.58, 1.0]}

    video = clip_of(client, settings, job, candidate)
    # Times of frames (the Source is at 25 fps), where the Keyframes put it.
    keys = [Keyframe(0.0, 200.0), Keyframe(2.0, 800.0, EASE_IN_OUT)]
    for at, centre in ((0.0, 200.0), (0.6, value_at(keys, 0.6, 0)), (1.0, 500.0), (1.4, value_at(keys, 1.4, 0)), (2.2, 800.0)):
        rows, columns = pixels(full_frame(settings, video, at), BLUE, tolerance=60)
        assert abs(columns.mean() - centre) <= 2 and abs(rows.mean() - 600) <= 2, (at, columns.mean(), rows.mean())
        assert len(rows) > 0.9 * 270 * 135, at


def test_a_keyed_picture_held_turned_and_faded_matches_the_still_one(client, settings, video_source, plain_video, stills):
    video_source.video = plain_video
    quadrants = upload(client, stills["quadrants"], "quadrants.png").json()
    job = reviewed(client)
    shown = {"media": quadrants["id"], "start": 0.0, "secs": 2.0}
    still = {"id": "o", **shown, "transform": {"x": 540, "y": 700, "scale": 0.3, "rotation": 90, "opacity": 0.5}}
    held = {"rotation": [{"at": 0, "value": 90}, {"at": 2, "value": 90}], "opacity": [{"at": 1, "value": 0.5}]}
    frames = []
    for overlay in (still, {**still, "transform": {"x": 540, "y": 700, "scale": 0.3}, "keys": held}):
        candidate = add(client, job, "Podcast", "ya", selected=False)
        candidate = patch(client, job, candidate, overlays=[overlay])
        frames.append(full_frame(settings, clip_of(client, settings, job, candidate), 1.0))
    # Its box, 324x324 about (540, 700), and a margin round it.
    area = (slice(700 - 172, 700 + 172), slice(540 - 172, 540 + 172))
    error = np.mean((frames[0][area] - frames[1][area]) ** 2)
    assert 10 * np.log10(255**2 / max(error, 1e-9)) > 32, error


def keyed_render(settings, plain_video, stills, tmp_path, encoders: tuple[str, ...]) -> str:
    """Render 2 s of the plain Source with a blue image keyed across it, with `encoders`."""
    image = tmp_path / "blue.png"
    image.write_bytes(stills["blue"])
    keys = {"x": [Keyframe(0.0, 200.0), Keyframe(2.0, 800.0)]}
    overlay = Overlay("o", STILL, 0.0, 2.0, transform=Transform(scale=0.25), keys=keys)
    plan = plan_render(0.0, 2.0, SourceMetadata(10.0, 25.0, 640, 360, "h264"), overlays=[overlay], media_info={STILL: MediaInfo(200, 100, None, False)})
    renderer = Renderer(settings.ffmpeg_bin, RenderTuning(encoders=encoders))
    return renderer.render(plain_video, plan, tmp_path / "clip.mp4", tmp_path / "clip.jpg", files={STILL: image})


def test_an_encode_that_fails_ends_its_frame_processes_and_the_next_encoder_draws_them_again(settings, plain_video, stills, tmp_path):
    assert keyed_render(settings, plain_video, stills, tmp_path, ("no_such_encoder", "libx264")) == "libx264"
    frame = full_frame(settings, tmp_path / "clip.mp4", 1.0)
    assert abs(pixels(frame, BLUE, tolerance=60)[1].mean() - 500) <= 2


def test_a_frame_process_that_fails_stops_the_encode_and_says_why(settings, plain_video, stills, tmp_path, monkeypatch):
    draw = PictureFrames.draw

    def broken(self, time: float):
        if time > 0.5:
            raise ValueError("no pixels")
        return draw(self, time)

    monkeypatch.setattr(PictureFrames, "draw", broken)
    with pytest.raises(RuntimeError, match="A keyed picture couldn't be drawn: no pixels"):
        keyed_render(settings, plain_video, stills, tmp_path, ("libx264",))
    assert not (tmp_path / "clip.mp4").exists()
