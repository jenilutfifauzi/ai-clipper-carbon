"""A Segment's Background (ADR 0015, ticket background-removal 04): a cut-out Source Segment's own
Background (the picture blurred, a colour or a Media Library image), and the image kind of a
Framing's Background, from the planner (Seam B) to the rendered frame through the API with the fake
matter (Seam A), and through MCP."""

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from mcp import Client

from app.candidates import Background, BackgroundKind, BackgroundRemoval, Framing, Layout, Segment, Transform, manual_candidate
from app.config import CameraTuning
from app.canvas import PORTRAIT
from app.planner import SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.video_source import SourceMetadata
from test_background_removal import client, cut_out, disc_video, matter, patch_mean, person_model, settled  # noqa: F401
from test_media_library import make, upload
from test_mcp import anyio_backend, call, fails, manual  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
from test_review import candidate_url, patch
from test_save_frame import pixels_of, saved_frame
from test_segments import ranges

SOURCE = SourceMetadata(width=640, height=360, duration=40.0, fps=25.0, codec="h264")
CUT = BackgroundRemoval()
IMAGE = "0123456789abcdef0123456789abcdef"
TEAL = Background(BackgroundKind.COLOUR, "#008080")


# Seam B: the planner


def test_the_background_in_force_is_the_segments_own_only_while_it_is_cut_out():
    planned = plan_render(10, 31, SOURCE, main_track=[
        SegmentInput(8, 12, background_removal=CUT, background=TEAL),
        SegmentInput(14, 16, background_removal=CUT),
        SegmentInput(20, 23, background=TEAL),
    ], canvas=PORTRAIT)
    own, blurred, off = planned.segments
    assert own.background == TEAL
    # None of its own: the picture blurred.
    assert blurred.background == Background()
    # Not cut out: none, whatever it has.
    assert off.background is None


def test_an_image_background_replaces_blurs_fill_in_the_plan():
    image = Background(BackgroundKind.IMAGE, image=IMAGE)
    planned = plan_render(10, 12, SOURCE, layout=Layout.BLUR, main_track=[SegmentInput(10, 12, background_removal=CUT, background=image)], canvas=PORTRAIT)
    assert planned.segments[0].background == image


def test_a_framings_image_background_is_its_scenes_image_and_no_blurred_panel():
    framing = Framing(Transform(scale=0.5), background=Background(BackgroundKind.IMAGE, image=IMAGE))
    [scene] = plan_render(10, 12, SOURCE, layout=Layout.MANUAL, framing=framing, canvas=PORTRAIT).scenes
    assert scene.image == IMAGE and scene.panels == [] and scene.colour is None
    # A colour's or a blur's Scene has none.
    [blurred] = plan_render(10, 12, SOURCE, layout=Layout.MANUAL, framing=replace(framing, background=Background()), canvas=PORTRAIT).scenes
    assert blurred.image is None and blurred.panels


def test_a_candidates_segment_brings_its_background_and_its_images_are_used(tmp_path):
    candidate = replace(
        manual_candidate("c1", 10, 26),
        segments=[Segment("a", 10, 12, background_removal=CUT, background=TEAL), Segment("b", 20, 22, background=Background(BackgroundKind.IMAGE, image=IMAGE))],
    )
    planned = candidate_plan(candidate, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning())
    assert [segment.background for segment in planned.segments] == [TEAL, None]
    assert candidate.media_ids() == {IMAGE}


def test_an_image_background_without_its_image_and_a_videos_own_background_are_refused():
    with pytest.raises(ValueError, match="An image Background needs its image"):
        Background(BackgroundKind.IMAGE)
    with pytest.raises(ValueError, match="Segment v shows a video, whose Background is its framing's"):
        Segment("v", 0, 1, media=IMAGE, framing=Framing(), background=TEAL)


# Seam A: the API and the real ffmpeg, with the fake matter


@pytest.fixture(scope="session")
def backdrops(tmp_path_factory) -> dict[str, bytes]:
    """A 400x200 PNG, blue on its left half and lime on its right; and a 1 s video."""
    folder = tmp_path_factory.mktemp("backdrops")
    halves = "color=c=blue:s=400x200[a];color=c=lime:s=200x200[b];[a][b]overlay=200:0"
    return {
        "halves": make(folder / "halves.png", "-f", "lavfi", "-i", halves, "-frames:v", "1"),
        "video": make(folder / "video.mp4", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=25:duration=1", "-c:v", "libx264"),
    }


def uploaded(client, data: bytes, name: str) -> dict:
    response = upload(client, data, name)
    assert response.status_code == 201, response.text
    return response.json()


def close(colour: np.ndarray, rgb: tuple[int, int, int], within: int = 12) -> bool:
    return bool(abs(colour - np.array(rgb)).max() <= within)


def test_a_cut_out_segments_colour_shows_outside_the_kept_area(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    saved = patch(client, job, candidate, layout="track", segments=[cut_out(first) | {"background": {"kind": "colour", "colour": "#008080"}}, second])
    assert saved["segments"][0]["background"] == {"kind": "colour", "colour": "#008080", "image": None}
    settled(client, job, saved)
    frame = pixels_of(settings, Path(saved_frame(client, job, saved, at=0.5)["path"]))
    # The disc (radius 373 about 540, 960) kept; teal outside it.
    red = patch_mean(frame, 940, 520)
    assert red[0] > 200 and red[1] < 40, red
    assert close(patch_mean(frame, 60, 60), (0, 128, 128)), patch_mean(frame, 60, 60)


def test_an_image_of_another_aspect_covers_the_frame_behind_a_cut_out_segment(client, settings, backdrops):
    image = uploaded(client, backdrops["halves"], "halves.png")
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    # In Blur, the image replaces the Layout's fill.
    background = {"kind": "image", "image": image["id"]}
    saved = patch(client, job, candidate, layout="blur", segments=[cut_out(first) | {"background": background}, second])
    settled(client, job, saved)
    frame = pixels_of(settings, Path(saved_frame(client, job, saved, at=0.5)["path"]))
    # 400x200 covers 1080x1920 at 9.6x, centred: its halves meet at the frame's middle, and every
    # corner is the image's, top and bottom too.
    for y in (20, 1860):
        assert close(patch_mean(frame, y, 20), (0, 0, 255)) and close(patch_mean(frame, y, 1020), (0, 255, 0)), (patch_mean(frame, y, 20), patch_mean(frame, y, 1020))
    # The kept area in Blur is the whole Source fitted across the frame (640x360 to 1080x608): the
    # disc (radius 118 about 540, 960) over it.
    red = patch_mean(frame, 940, 520)
    assert red[0] > 200 and red[1] < 40, red


def test_a_manual_framings_image_background_shows_where_the_picture_doesnt_cover(client, settings, backdrops):
    image = uploaded(client, backdrops["halves"], "halves.png")
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    framing = {"transform": {"scale": 1.0}, "background": {"kind": "image", "image": image["id"]}}
    saved = patch(client, job, candidate, layout="manual", framing=framing)
    assert preview(client, job, saved)["plan"]["scenes"][0]["image"] == image["id"]
    frame = pixels_of(settings, Path(saved_frame(client, job, saved, at=0.5)["path"]))
    # The Source fitted across the middle; the image above and below it.
    assert close(patch_mean(frame, 20, 20), (0, 0, 255)) and close(patch_mean(frame, 1860, 1020), (0, 255, 0))
    assert not close(patch_mean(frame, 940, 520), (0, 0, 255), 60)


def test_a_missing_image_or_one_that_isnt_an_image_is_refused_and_a_used_one_cant_be_deleted(client, backdrops):
    image = uploaded(client, backdrops["halves"], "halves.png")
    video = uploaded(client, backdrops["video"], "video.mp4")
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    [first] = ranges(job, ("halo", "kabar"))
    for media_id in ("f" * 32, video["id"]):
        refused = client.patch(candidate_url(job, candidate), json={"segments": [cut_out(first) | {"background": {"kind": "image", "image": media_id}}]})
        assert refused.status_code == 422 and f"Segment {first['id']}'s background: no image {media_id} in the Media Library" in refused.text, refused.text
    framing = {"background": {"kind": "image", "image": video["id"]}}
    refused = client.patch(candidate_url(job, candidate), json={"layout": "manual", "framing": framing})
    assert refused.status_code == 422 and f"Its framing's background: no image {video['id']}" in refused.text, refused.text
    refused = client.patch(candidate_url(job, candidate), json={"segments": [cut_out(first) | {"background": {"kind": "image"}}]})
    assert refused.status_code == 422 and "needs its image" in refused.text

    patch(client, job, candidate, segments=[cut_out(first) | {"background": {"kind": "image", "image": image["id"]}}])
    deleted = client.delete(f"/api/media/{image['id']}")
    assert deleted.status_code == 409 and candidate["id"] in deleted.text
    # Kept but unused (a colour now): deletable.
    patch(client, job, candidate, segments=[cut_out(first) | {"background": {"kind": "colour", "colour": "#000000"}}])
    assert client.delete(f"/api/media/{image['id']}").status_code == 204


# MCP


@pytest.fixture
async def mcp(client):
    async with Client(client.app.state.mcp) as session:
        yield session


@pytest.mark.anyio
async def test_the_agent_sets_a_segments_background_and_the_dry_run_shows_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 1.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [{"id": "a", "start": 1.0, "end": 1.6}, {"id": "b", "start": 0.1, "end": 0.9}]})
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[
        {"id": "a", "background_removal": {"subject": "person"}, "background": {"kind": "colour", "colour": "#112233"}},
    ])
    assert merged["segments"][0]["background"] == {"kind": "colour", "colour": "#112233", "image": None}

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    cut, plain = plan["segments"]
    assert cut["background"] == {"kind": "colour", "colour": "#112233"} and "background" not in plain

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "background": {"kind": "image", "image": "e" * 32}}])
    assert f"no image {'e' * 32} in the Media Library" in message
