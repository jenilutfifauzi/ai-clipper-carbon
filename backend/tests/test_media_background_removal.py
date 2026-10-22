"""Background removal on Media Library items (ADR 0015, ticket background-removal 06): a video's
Segment and an Overlay (a video's or an image's) cut out by their item's Matte, kept beside the item;
from the planner (Seam B) to the rendered frame through the API with the fake matter (Seam A), the
editor's Preview Plan, the sweep, and MCP."""

import subprocess
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from mcp import Client
from pydantic import TypeAdapter

from app.candidates import BackgroundRemoval, Candidate, Framing, Overlay, Segment, Transform, manual_candidate
from app.config import CameraTuning
from app.matte import Mattes
from app.media import MediaKind
from app.planner import MediaInfo, SegmentInput, plan_render
from app.rendering import candidate_plan, matte_wanted
from app.styles import PresetStore
from app.video_source import SourceMetadata
from test_background_removal import client, cut_out, disc_video, matter, patch_mean, person_model, reds, settled  # noqa: F401
from test_media_library import make
from test_mcp import anyio_backend, call, fails, manual  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, reviewed
from test_review import patch
from test_save_frame import pixels_of, saved_frame
from test_segment_backgrounds import close, uploaded
from test_segments import ranges

SOURCE = SourceMetadata(width=640, height=360, duration=40.0, fps=25.0, codec="h264")
VIDEO, IMAGE = "ab" * 16, "cd" * 16
ITEMS = {VIDEO: MediaInfo(320, 180, 4.0, True), IMAGE: MediaInfo(320, 180, None, False)}
CUT = BackgroundRemoval(feather=6)


# Seam B: the planner


def test_an_overlays_background_removal_reaches_its_event_with_the_feather_times_its_scale():
    overlays = [
        Overlay("v", VIDEO, 0.5, 1.0, transform=Transform(scale=0.5), background_removal=CUT),
        Overlay("i", IMAGE, 0.5, 1.0, transform=Transform(scale=2.0, stretch_x=1.5), background_removal=CUT, behind=True),
        Overlay("p", VIDEO, 0.5, 1.0),
    ]
    planned = plan_render(10, 14, SOURCE, overlays=overlays, media_info=ITEMS)
    video, plain = planned.overlays
    [image] = planned.behind
    assert video.background_removal == BackgroundRemoval(feather=3.0)
    # Its scale times its larger stretch, as its Video Effects' sizes are (0014's rule).
    assert image.background_removal == BackgroundRemoval(feather=18.0)
    assert plain.background_removal is None
    # Its pieces are its item's, found by the renderer.
    assert video.matte == [] and video.matte_files == []


def test_a_media_segments_background_removal_reaches_its_plan_its_background_its_framings():
    framing = Framing(Transform(scale=0.5))
    planned = plan_render(10, 31, SOURCE, main_track=[
        SegmentInput(0, 2, media=VIDEO, width=320, height=180, framing=framing, background_removal=CUT),
        SegmentInput(20, 23, background_removal=CUT),
    ])
    media, source = planned.segments
    assert media.background_removal == BackgroundRemoval(feather=3.0)
    # Its Background is its Scene's, its Framing's; its pieces are its item's.
    assert media.background is None and media.matte == []
    assert source.background_removal == CUT and source.matte == [20]


def test_a_candidate_saved_before_it_plans_exactly_as_before(tmp_path):
    candidate = replace(manual_candidate("c1", 10, 16), segments=[Segment("a", 10, 12)], overlays=[Overlay("o", IMAGE, 0.5, 2.0)])
    stored = asdict(candidate)
    del stored["overlays"][0]["background_removal"]
    old = TypeAdapter(Candidate).validate_python(stored)
    assert old.overlays[0].background_removal is None

    class Media:
        def find(self, media_id):
            return SimpleNamespace(id=media_id, width=320, height=180, kind=MediaKind.IMAGE, duration=None, has_audio=False)

    plan = lambda given: candidate_plan(given, SOURCE, None, [None], PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Media())
    assert plan(old) == plan(candidate) and plan(old).overlays[0].background_removal is None


def test_a_feather_out_of_range_is_refused_naming_its_overlay():
    with pytest.raises(ValueError, match="Overlay o's background_removal feather is 41; it is 0 to 40"):
        Overlay("o", IMAGE, 0, 1, background_removal=BackgroundRemoval(feather=41))


def test_each_cut_out_item_reads_its_own_items_pieces_and_an_image_its_one(tmp_path):
    source = Mattes(tmp_path / "source", tmp_path / "source.mp4", (640, 360, 25.0), 40.0)
    video = Mattes(tmp_path / "video", tmp_path / "video.mp4", (320, 180, 30.0), 14.0)
    image = Mattes(tmp_path / "image", tmp_path / "image.png", (320, 180, 30.0), 0.0, still=True)
    candidate = replace(
        manual_candidate("c1", 10, 16),
        segments=[Segment("s", 10, 12, background_removal=CUT), Segment("m", 8, 12, media=VIDEO, framing=Framing(), background_removal=CUT)],
        overlays=[
            Overlay("v", VIDEO, 0.0, 2.0, offset=9.0, reverse=True, background_removal=CUT),
            Overlay("i", IMAGE, 0.0, 2.0, background_removal=CUT),
            Overlay("p", VIDEO, 0.0, 2.0),
        ],
    )
    wanted = matte_wanted(candidate, source, {VIDEO: video, IMAGE: image}.get)
    parts = {id: [(mattes.folder.name, part) for mattes, _, part in found] for id, found in wanted.items()}
    assert parts["s"] == [("source", 10)] and parts["m"] == [("video", 0), ("video", 10)] and parts["i"] == [("image", 0)]
    # A reversed one's pieces, then its reversed copy.
    assert [part for _, part in parts["v"]][:2] == [0, 10] and parts["v"][2][1].start == 9.0
    assert "p" not in parts
    assert image.path(CUT.subject, "fake-1", 0).name == "person-fake-1.png"


# Seam A: the API and the real ffmpeg, with the fake matter (it keeps what is red)


@pytest.fixture(scope="session")
def items(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s 320x180 video at 30 fps of a red disc (radius 50) in the middle of green; one whose red
    disc (radius 30) moves right 200 px a second from x 40; a still of the first; an image whose top
    left quarter is red, top right dark red (dark enough for a Luma key at 18 % to take out) and
    bottom half white; and a blue image."""
    folder = tmp_path_factory.mktemp("items")
    lavfi = ("-f", "lavfi", "-i")
    disc = "lte(hypot(X-160,Y-90),50)"
    still_disc = f"color=c=black:size=320x180:rate=30:duration=2,format=rgb24,geq=r='if({disc},255,0)':g='if({disc},0,160)':b=0"
    moving = "lte(hypot(X-40-200*T,Y-90),30)"
    moving_disc = f"color=c=black:size=320x180:rate=30:duration=2,format=rgb24,geq=r='if({moving},255,0)':g='if({moving},0,160)':b=0"
    halves = "color=c=black:size=320x180,format=rgb24,geq=r='if(lt(Y,90),if(lt(X,160),255,170),255)':g='if(lt(Y,90),0,255)':b='if(lt(Y,90),0,255)'"
    return {
        "disc": make(folder / "disc.mp4", *lavfi, still_disc, "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p"),
        "moving": make(folder / "moving.mp4", *lavfi, moving_disc, "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p"),
        "still": make(folder / "still.png", *lavfi, still_disc, "-frames:v", "1"),
        "halves": make(folder / "halves.png", *lavfi, halves, "-frames:v", "1"),
        "blue": make(folder / "blue.png", *lavfi, "color=c=blue:size=320x180", "-frames:v", "1"),
    }


# At scale 0.5 a 320x180 picture is drawn 540x304 in the frame's top left corner, well away from the
# Source's disc (radius 373 about 540, 960 in Track); its own disc is radius 84 about 270, 152.
CORNER = {"x": 270, "y": 152, "scale": 0.5}


def overlay(media: str, cut: bool = True, **more) -> dict:
    removal = {"background_removal": {"subject": "person", "feather": 0}} if cut else {}
    return {"id": "o", "media": media, "start": 0.0, "secs": 1.0, "transform": CORNER, **removal, **more}


def frame(client, settings, job: dict, candidate: dict, at: float, **draft) -> np.ndarray:
    return pixels_of(settings, Path(saved_frame(client, job, candidate, at=at, **({"draft": draft} if draft else {}))["path"]))


def matte_pieces_of(settings, media_id: str) -> list[str]:
    folder = settings.data_dir / "media" / f"{media_id}.mattes"
    return sorted(path.name for path in folder.iterdir() if path.is_file()) if folder.is_dir() else []


def red(colour: np.ndarray) -> bool:
    return bool(colour[0] > 200 and colour[1] < 50 and colour[2] < 50)


def test_a_cut_out_media_segment_shows_its_framings_background_and_the_behind_overlays_outside_the_kept_area(client, settings, items):
    disc, blue = uploaded(client, items["disc"], "disc.mp4"), uploaded(client, items["blue"], "blue.png")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    # Scale 1: 1080x608 across the middle of the frame, over a teal Background; its disc radius 169 about 540, 960.
    teal = {"transform": {"scale": 1}, "background": {"kind": "colour", "colour": "#008080"}}
    intro = {"id": "m", "start": 0, "end": 1.5, "media": disc["id"], "framing": teal}
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[intro | {"background_removal": {"subject": "person", "feather": 0}}, episode])
    assert candidate["segments"][0]["background_removal"] == {"subject": "person", "feather": 0.0}
    status = settled(client, job, candidate)
    assert status["state"] == "ready" and status["segments"]["m"]["state"] == "ready"
    assert matte_pieces_of(settings, disc["id"]) == ["person-fake-1-0.mp4"]

    cut = frame(client, settings, job, candidate, 0.5)
    # Inside its picture, away from the disc: the Background; the disc kept.
    assert close(patch_mean(cut, 700, 100), (0, 128, 128)), patch_mean(cut, 700, 100)
    assert red(patch_mean(cut, 940, 520)), patch_mean(cut, 940, 520)
    # Not cut out, its green shows there.
    whole = frame(client, settings, job, candidate, 0.5, segments=[intro, episode])
    assert close(patch_mean(whole, 700, 100), (0, 160, 0), within=20), patch_mean(whole, 700, 100)

    # A Behind Overlay over the same place shows where it is cut out, under the disc.
    behind = {"id": "b", "media": blue["id"], "start": 0, "secs": 1.5, "transform": {"x": 540, "y": 960, "scale": 1}, "behind": True}
    under = frame(client, settings, job, candidate, 0.5, overlays=[behind])
    assert close(patch_mean(under, 700, 100), (0, 0, 255)), patch_mean(under, 700, 100)
    assert red(patch_mean(under, 940, 520)), patch_mean(under, 940, 520)


def test_a_cut_out_overlay_video_and_image_show_the_frame_beneath(client, settings, items):
    disc, still = uploaded(client, items["disc"], "disc.mp4"), uploaded(client, items["still"], "still.png")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[episode])
    beneath = frame(client, settings, job, candidate, 0.5)
    for item in (disc, still):
        saved = patch(client, job, candidate, overlays=[overlay(item["id"])])
        settled(client, job, saved)
        shown = frame(client, settings, job, saved, 0.5)
        # Its disc kept; elsewhere in its picture, the Source's frame beneath, as if it weren't there.
        assert red(patch_mean(shown, 132, 250)), (item["kind"], patch_mean(shown, 132, 250))
        for y, x in ((10, 10), (240, 30), (20, 460)):
            assert close(patch_mean(shown, y, x), patch_mean(beneath, y, x), within=6), (item["kind"], y, x, patch_mean(shown, y, x))
        # Uncut, its green.
        whole = frame(client, settings, job, saved, 0.5, overlays=[overlay(item["id"], cut=False)])
        assert close(patch_mean(whole, 10, 10), (0, 160, 0), within=20), patch_mean(whole, 10, 10)
    # An image's Matte is one PNG of one run of the matter.
    assert matte_pieces_of(settings, still["id"]) == ["person-fake-1.png"]


def test_a_luma_key_and_the_matte_multiply_on_an_overlay(client, settings, items):
    halves = uploaded(client, items["halves"], "halves.png")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    luma = {"video_effects": [{"id": "luma-key", "params": {"threshold": 18, "softness": 1}}]}
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[episode], overlays=[overlay(halves["id"])])
    settled(client, job, candidate)
    beneath = frame(client, settings, job, candidate, 0.5, overlays=[])
    alone = frame(client, settings, job, candidate, 0.5)
    keyed = frame(client, settings, job, candidate, 0.5, overlays=[overlay(halves["id"]) | luma])
    red_quarter, dark_quarter, white_half = (60, 100), (60, 400), (230, 250)
    # The Matte keeps both reds and takes the white away.
    assert red(patch_mean(alone, *red_quarter)) and close(patch_mean(alone, *dark_quarter), (170, 0, 0), within=20), patch_mean(alone, *dark_quarter)
    assert close(patch_mean(alone, *white_half), patch_mean(beneath, *white_half), within=6)
    # With the Luma key, the dark red goes too: only what both keep shows.
    assert red(patch_mean(keyed, *red_quarter)), patch_mean(keyed, *red_quarter)
    for place in (dark_quarter, white_half):
        assert close(patch_mean(keyed, *place), patch_mean(beneath, *place), within=6), (place, patch_mean(keyed, *place))


def test_a_keyed_cut_out_overlay_draws_as_an_unkeyed_one_at_the_same_frame(client, settings, items):
    disc, still = uploaded(client, items["disc"], "disc.mp4"), uploaded(client, items["still"], "still.png")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[episode])
    # Its scale held by Keyframes: a frame process draws it, and its Matte, at the unkeyed one's size.
    held = {"keys": {"scale": [{"at": 0, "value": 0.5}, {"at": 1, "value": 0.5}]}}
    for item in (disc, still):
        for feather in (0, 8):
            removal = {"background_removal": {"subject": "person", "feather": feather}}
            saved = patch(client, job, candidate, overlays=[overlay(item["id"]) | removal])
            settled(client, job, saved)
            still_chain = frame(client, settings, job, saved, 0.5)
            keyed = frame(client, settings, job, saved, 0.5, overlays=[overlay(item["id"]) | removal | held])
            region = (slice(0, 304), slice(0, 540))
            difference = np.abs(still_chain[region] - keyed[region]).mean()
            assert difference < 4, (item["kind"], feather, difference)
            assert red(patch_mean(keyed, 132, 250)) and abs(reds(keyed[region]) - reds(still_chain[region])) < reds(still_chain[region]) * 0.03


def test_a_cut_out_overlay_at_a_speed_or_reversed_keeps_its_moving_subject_whole(client, settings, items):
    moving = uploaded(client, items["moving"], "moving.mp4")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[episode])
    region = (slice(0, 304), slice(0, 540))
    for played in ({"speed": 2.0, "secs": 0.9}, {"reverse": True, "offset": 0.3}, {"reverse": True, "speed": 1.5, "secs": 0.9}):
        saved = patch(client, job, candidate, overlays=[overlay(moving["id"]) | played])
        assert settled(client, job, saved)["overlays"]["o"]["state"] == "ready", played
        for at in (0.2, 0.6):
            cut = frame(client, settings, job, saved, at)[region]
            whole = frame(client, settings, job, saved, at, overlays=[overlay(moving["id"], cut=False) | played])[region]
            # The whole disc kept: a Matte a frame out of step cuts a crescent off it (about a seventh).
            assert reds(whole) > 3000 and abs(reds(cut) - reds(whole)) < reds(whole) * 0.04, (played, at, reds(cut), reds(whole))


def test_an_item_at_its_own_frame_rate_is_cut_on_its_own_frames(client, settings, items, monkeypatch):
    """A video kept at 25 fps (the Library's rate when it was added) has a 25 fps Matte, read at 25 fps
    by the render and, through the Preview Plan, by the preview, whatever the Library's rate is now."""
    with monkeypatch.context() as then:
        then.setattr("app.media.FPS", 25)
        moving = uploaded(client, items["moving"], "moving.mp4")
    assert moving["fps"] == 25
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    region = (slice(0, 304), slice(0, 540))
    saved = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[episode], overlays=[overlay(moving["id"]) | {"secs": 1.8}])
    assert settled(client, job, saved)["overlays"]["o"]["state"] == "ready"
    piece = settings.data_dir / "media" / f"{moving['id']}.mattes" / "person-fake-1-0.mp4"
    probe = [str(settings.ffprobe_bin), "-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=r_frame_rate,nb_read_frames", "-of", "csv=p=0", str(piece)]
    assert subprocess.run(probe, capture_output=True, text=True, check=True).stdout.split() == ["25/1,50"]
    for at in (0.2, 0.7, 1.1):
        cut = frame(client, settings, job, saved, at)[region]
        whole = frame(client, settings, job, saved, at, overlays=[overlay(moving["id"], cut=False) | {"secs": 1.8}])[region]
        # The whole disc kept: a Matte read at another rate drifts off it (by a fifth of a frame a frame).
        assert reds(whole) > 3000 and abs(reds(cut) - reds(whole)) < reds(whole) * 0.04, (at, reds(cut), reds(whole))
    response = client.post(f"/api/jobs/{job['id']}/candidates/{saved['id']}/preview-plan")
    assert [(piece["start"], piece["fps"], piece["piece_secs"]) for piece in response.json()["mattes"]] == [(0, 25.0, 10)]


def test_two_overlays_of_one_item_over_the_same_time_share_its_pieces(client, settings, items):
    disc = uploaded(client, items["disc"], "disc.mp4")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    twins = [overlay(disc["id"]), overlay(disc["id"]) | {"id": "p", "start": 0.3, "offset": 0.2, "transform": {"x": 810, "y": 152, "scale": 0.5}}]
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[episode], overlays=twins)
    status = settled(client, job, candidate)
    assert status["state"] == "ready" and set(status["overlays"]) == {"o", "p"} and status["segments"] == {}
    assert matte_pieces_of(settings, disc["id"]) == ["person-fake-1-0.mp4"]
    # Another Candidate's Overlay of it makes none either.
    other = patch(client, job, add(client, job, "halo", "ya"), segments=[episode], overlays=[overlay(disc["id"]) | {"secs": 0.5}])
    assert settled(client, job, other)["state"] == "ready" and matte_pieces_of(settings, disc["id"]) == ["person-fake-1-0.mp4"]


def test_the_preview_plan_says_where_an_items_pieces_are_served(client, settings, items):
    disc, still = uploaded(client, items["disc"], "disc.mp4"), uploaded(client, items["still"], "still.png")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(
        client, job, add(client, job, "halo", "ya"), segments=[episode],
        overlays=[overlay(disc["id"]), overlay(still["id"]) | {"id": "i"}, overlay(disc["id"]) | {"id": "r", "reverse": True}],
    )
    settled(client, job, candidate)
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan")
    assert response.status_code == 200, response.text
    shown = response.json()
    video, image = f"/api/media/{disc['id']}/mattes/person-fake-1-0.mp4", f"/api/media/{still['id']}/mattes/person-fake-1.png"
    assert sorted(shown["mattes"], key=lambda piece: piece["url"]) == sorted(
        [
            {"start": 0, "url": video, "media": disc["id"], "fps": 30.0, "piece_secs": 10},
            {"start": 0, "url": image, "media": still["id"], "fps": 30.0, "piece_secs": 10},
        ],
        key=lambda piece: piece["url"],
    )
    [copy] = shown["matte_copies"]
    assert copy["media"] == disc["id"] and copy["url"] == f"/api/media/{disc['id']}/mattes/person-fake-1/reversed-full-0-1000.mp4"
    assert shown["plan"]["overlays"][0]["background_removal"] == {"subject": "person", "feather": 0.0}
    for url, start in ((video, b"ftyp"), (image, b"PNG"), (copy["url"], b"ftyp")):
        served = client.get(url)
        assert served.status_code == 200 and start in served.content[:12], url
    assert client.get(f"/api/media/{disc['id']}/mattes/person-fake-1-10.mp4").status_code == 404
    assert client.get(f"/api/media/{disc['id']}/mattes/../{disc['id']}.mp4").status_code == 404


def test_unused_pieces_of_an_item_are_swept_and_removing_the_model_removes_them(client, settings, items):
    disc = uploaded(client, items["disc"], "disc.mp4")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[episode], overlays=[overlay(disc["id"])])
    settled(client, job, candidate)
    folder = settings.data_dir / "media" / f"{disc['id']}.mattes"
    (folder / "person-fake-1-10.mp4").write_bytes(b"unused")
    (folder / "person-fake-1-20.failed").write_text("unused")
    assert client.get(f"/api/jobs/{job['id']}").status_code == 200
    # Opening the Job sweeps what none of its Candidates reads, and keeps what one does.
    assert matte_pieces_of(settings, disc["id"]) == ["person-fake-1-0.mp4"]
    assert client.delete("/api/models/person").status_code == 204
    assert not folder.exists()


def test_the_pieces_of_an_item_no_candidate_uses_are_swept_but_not_those_another_job_needs(client, settings, items):
    disc, still, blue = (uploaded(client, items[name], f"{name}.{kind}") for name, kind in (("disc", "mp4"), ("still", "png"), ("blue", "png")))
    job, other = reviewed(client), reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    settled(client, job, patch(client, job, add(client, job, "halo", "ya"), segments=[episode], overlays=[overlay(disc["id"])]))
    [theirs] = ranges(other, ("halo", "kabar"))
    settled(client, other, patch(client, other, add(client, other, "halo", "ya"), segments=[theirs], overlays=[overlay(still["id"])]))
    # The blue image's Matte, made for a draft or a Candidate since gone: nothing uses it.
    unused = settings.data_dir / "media" / f"{blue['id']}.mattes"
    unused.mkdir()
    (unused / "person-fake-1.png").write_bytes(b"unused")
    assert client.get(f"/api/jobs/{job['id']}").status_code == 200
    assert matte_pieces_of(settings, blue["id"]) == []
    # The image only the other Job uses keeps its Matte, as its Retimed copies would be kept.
    assert matte_pieces_of(settings, still["id"]) == ["person-fake-1.png"]
    assert matte_pieces_of(settings, disc["id"]) == ["person-fake-1-0.mp4"]


def test_a_render_needing_an_items_failed_matte_fails_naming_the_overlay(client, matter, items):
    matter.failing = "no subject found"
    disc = uploaded(client, items["disc"], "disc.mp4")
    job = reviewed(client)
    [episode] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), segments=[episode], overlays=[overlay(disc["id"])])
    assert settled(client, job, candidate)["overlays"]["o"] == {"state": "failed", "progress": 0.0, "error": "no subject found"}
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/frame", json={"at": 0.5})
    assert response.status_code >= 400 and "Overlay o's background couldn't be removed: no subject found" in response.text


# MCP


@pytest.fixture
async def mcp(client):
    async with Client(client.app.state.mcp) as session:
        yield session


@pytest.mark.anyio
async def test_the_agent_cuts_out_an_overlay_follows_its_matte_and_sees_it_in_the_dry_run(mcp, items, tmp_path):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 1.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    (tmp_path / "disc.mp4").write_bytes(items["disc"])
    item = await call(mcp, "add_asset", path=str(tmp_path / "disc.mp4"), kind="media")
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [{"id": "o", "media": item["id"], "start": 0.0, "secs": 1.0, "volume": 0.5}]})
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "background_removal": {"subject": "person", "feather": 8}}])
    assert merged["overlays"][0]["background_removal"] == {"subject": "person", "feather": 8.0} and merged["overlays"][0]["volume"] == 0.5
    matte = await call(mcp, "wait_for_matte", **ids, timeout_secs=30)
    assert matte["state"] == "ready" and matte["overlays"] == {"o": {"state": "ready", "progress": 1.0, "error": None}}
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    # Its feather as drawn: at its default scale.
    assert plan["overlays"][0]["background_removal"]["subject"] == "person" and plan["overlays"][0]["background_removal"]["feather"] > 0


@pytest.mark.anyio
async def test_the_agent_is_refused_a_keyed_cut_out_media_segment_naming_it(mcp, items, tmp_path):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 1.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    (tmp_path / "disc.mp4").write_bytes(items["disc"])
    item = await call(mcp, "add_asset", path=str(tmp_path / "disc.mp4"), kind="media")
    growing = {"scale": [{"at": 0, "value": 1}, {"at": 1, "value": 1.5}]}
    intro = {"id": "m", "start": 0, "end": 1.5, "media": item["id"], "framing": {"transform": {"scale": 1}}, "keys": growing}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [intro, {"id": "a", "start": 0.1, "end": 1.6}]})
    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "m", "background_removal": {"subject": "person", "feather": 4}}])
    assert "Segment m is cut out (Background removal) but its picture has Keyframes" in message
    # Its volume Keyframes alone don't move its picture.
    heard = await call(mcp, "merge_candidate_items", **ids, segments=[
        {"id": "m", "keys": {"scale": [], "volume": [{"at": 0, "value": 1}]}, "background_removal": {"subject": "person", "feather": 4}},
    ])
    assert heard["segments"][0]["background_removal"]["feather"] == 4.0
