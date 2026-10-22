"""Overlays Behind the Main Track (ADR 0015, ticket background-removal 05): listed apart in the Render
Plan (Seam B), drawn over each Segment's Background and under its picture, before the joins and the
Candidate's Grade, through the API and the real ffmpeg with the fake matter (Seam A), and set and
listed through MCP."""

import subprocess
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from mcp import Client
from pydantic import TypeAdapter

from app.candidates import Candidate, Overlay, Segment, manual_candidate
from app.config import CameraTuning
from app.media import MediaKind
from app.canvas import PORTRAIT
from app.planner import MediaInfo, SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.video_source import SourceMetadata
from test_background_removal import client, cut_out, disc_video, matter, patch_mean, person_model, roughness, settled  # noqa: F401
from test_media_library import make
from test_mcp import anyio_backend, call, manual  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, render, rendered, reviewed
from test_review import patch
from test_save_frame import pixels_of, saved_frame
from test_segment_backgrounds import close, uploaded
from test_segments import ranges

SOURCE = SourceMetadata(width=640, height=360, duration=40.0, fps=25.0, codec="h264")
VIDEO, IMAGE = "ab" * 16, "cd" * 16
ITEMS = {VIDEO: MediaInfo(320, 180, 4.0, True), IMAGE: MediaInfo(320, 180, None, False)}


# Seam B: the planner


def test_behind_overlays_are_listed_apart_as_the_others_are_drawn():
    front, behind = Overlay("f", IMAGE, 0.5, 1.0), Overlay("b", VIDEO, 1.0, 2.0, offset=0.5, volume=1.0, behind=True)
    planned = plan_render(10, 14, SOURCE, overlays=[front, behind], media_info=ITEMS, canvas=PORTRAIT)
    alone = plan_render(10, 14, SOURCE, overlays=[front, replace(behind, behind=False)], media_info=ITEMS, canvas=PORTRAIT)
    assert [event.id for event in planned.overlays] == ["f"] and [event.id for event in planned.behind] == ["b"]
    # The same OverlayEvent as one over the Main Track would be.
    assert planned.behind[0] == alone.overlays[1]
    # Its video's sound is heard as any Overlay's.
    assert [event.id for event in planned.audio] == ["b"]


def test_a_candidate_saved_before_behind_plans_exactly_as_before(tmp_path):
    candidate = replace(
        manual_candidate("c1", 10, 16),
        segments=[Segment("a", 10, 12), Segment("b", 14, 16)],
        overlays=[Overlay("o", IMAGE, 0.5, 2.0)],
    )
    stored = asdict(candidate)
    del stored["overlays"][0]["behind"]
    old = TypeAdapter(Candidate).validate_python(stored)
    assert old.overlays[0].behind is False

    class Media:
        def find(self, media_id):
            return SimpleNamespace(id=media_id, width=320, height=180, kind=MediaKind.IMAGE, duration=None, has_audio=False)

    plan = lambda given: candidate_plan(given, SOURCE, None, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Media())
    before = plan(old)
    assert before == plan(candidate) and [event.id for event in before.overlays] == ["o"] and before.behind == []


# Seam A: the API and the real ffmpeg, with the fake matter


@pytest.fixture(scope="session")
def pictures(tmp_path_factory) -> dict[str, bytes]:
    """A 320x180 blue PNG; and a 4 s 320x180 video at 25 fps, grey that brightens with time (from 30,
    40 a second), so that its brightness tells its time."""
    folder = tmp_path_factory.mktemp("behind")
    lavfi = ("-f", "lavfi", "-i")
    ramp = "color=c=black:size=320x180:rate=25:duration=4,format=rgb24,geq=r='30+40*T':g='30+40*T':b='30+40*T'"
    return {
        "blue": make(folder / "blue.png", *lavfi, "color=c=blue:size=320x180", "-frames:v", "1"),
        "ramp": make(folder / "ramp.mp4", *lavfi, ramp, "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p"),
    }


# At scale 0.5 a 320x180 picture is drawn 540x304 in the frame's top left corner, well away from the
# disc (radius 373 about 540, 960 in Track).
CORNER = {"x": 270, "y": 152, "scale": 0.5}


def behind(media: str, start: float, secs: float, **more) -> dict:
    return {"id": "o", "media": media, "start": start, "secs": secs, "transform": CORNER, "behind": True, **more}


def frame(client, settings, job: dict, candidate: dict, at: float, **draft) -> np.ndarray:
    return pixels_of(settings, Path(saved_frame(client, job, candidate, at=at, **({"draft": draft} if draft else {}))["path"]))


def test_a_behind_overlay_shows_outside_the_kept_area_and_not_over_a_segment_that_covers_the_frame(client, settings, pictures):
    blue = uploaded(client, pictures["blue"], "blue.png")
    job = reviewed(client)
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    teal = {"background": {"kind": "colour", "colour": "#008080"}}
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[cut_out(first) | teal, second])
    later = preview(client, job, candidate)["plan"]["segments"][1]["start"] + 0.3
    saved = patch(client, job, candidate, overlays=[behind(blue["id"], 0.0, later + 1)])
    assert saved["overlays"][0]["behind"] is True
    settled(client, job, saved)

    cut = frame(client, settings, job, saved, 0.5)
    # In the corner, outside the kept area, the Overlay over the Background; beside it, the Background.
    assert close(patch_mean(cut, 100, 100), (0, 0, 255)), patch_mean(cut, 100, 100)
    assert close(patch_mean(cut, 100, 800), (0, 128, 128)), patch_mean(cut, 100, 800)
    # The subject over it.
    red = patch_mean(cut, 940, 520)
    assert red[0] > 200 and red[1] < 40, red
    # The next Segment isn't cut out and covers the frame: its checkerboard hides the Overlay.
    covered = frame(client, settings, job, saved, later)
    assert not close(patch_mean(covered, 100, 100), (0, 0, 255), within=60) and roughness(covered, 60, 60) > 15


def test_a_keyed_behind_overlay_is_drawn_by_its_frame_process_in_each_cut_out_segment(client, settings, pictures):
    blue = uploaded(client, pictures["blue"], "blue.png")
    job = reviewed(client)
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    teal = {"background": {"kind": "colour", "colour": "#008080"}}
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[cut_out(first) | teal, cut_out(second) | teal])
    later = preview(client, job, candidate)["plan"]["segments"][1]["start"] + 0.3
    # Its scale held by Keyframes, so that a frame process draws it; it fades in over its first 0.3 s.
    held = {"transform": {"x": 270, "y": 152}, "keys": {"scale": [{"at": 0, "value": 0.5}, {"at": later + 1, "value": 0.5}]}, "animation_in": "fade"}
    saved = patch(client, job, candidate, overlays=[behind(blue["id"], 0.0, later + 1) | held])
    settled(client, job, saved)
    for at in (0.5, later):
        shown = frame(client, settings, job, saved, at)
        assert close(patch_mean(shown, 100, 100), (0, 0, 255)) and close(patch_mean(shown, 100, 800), (0, 128, 128)), (at, patch_mean(shown, 100, 100))
    # Fading in: half way through its fade, half over the Background.
    halfway = patch_mean(frame(client, settings, job, saved, 0.15), 100, 100)
    assert 60 < halfway[2] < 200 and halfway[1] > 30, halfway


def test_the_candidates_grade_covers_a_behind_overlay(client, settings, pictures):
    blue = uploaded(client, pictures["blue"], "blue.png")
    job = reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=[cut_out(first)], overlays=[behind(blue["id"], 0.0, 1.0)])
    settled(client, job, candidate)
    assert close(patch_mean(frame(client, settings, job, candidate, 0.5), 100, 100), (0, 0, 255))
    grey = patch_mean(frame(client, settings, job, candidate, 0.5, grade={"adjust": {"saturation": -100}}), 100, 100)
    # Its blue taken to grey with the rest of the Main Track's picture.
    assert grey.max() - grey.min() < 12, grey


def test_a_behind_overlay_shows_where_a_framed_picture_doesnt_cover_the_frame(client, settings, pictures):
    blue = uploaded(client, pictures["blue"], "blue.png")
    job = reviewed(client)
    # A Manual Layout's picture at half size, in the middle of a green Background: the corner is the Background's.
    framing = {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#00ff00"}}
    candidate = patch(client, job, add(client, job, "halo", "ya"), layout="manual", framing=framing, overlays=[behind(blue["id"], 0.0, 1.0)])
    shown = frame(client, settings, job, candidate, 0.5)
    assert close(patch_mean(shown, 100, 100), (0, 0, 255)), patch_mean(shown, 100, 100)
    assert close(patch_mean(shown, 1800, 100), (0, 255, 0)), patch_mean(shown, 1800, 100)


def corners(settings, video: Path) -> np.ndarray:
    """Each frame's mean brightness in the frame's top left corner, where the Overlay is."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", "crop=200:200:100:50,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-"]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, np.uint8).astype(float)


def test_a_behind_overlay_keeps_its_timeline_time_across_cut_out_segments_and_a_transition(client, settings, pictures):
    ramp = uploaded(client, pictures["ramp"], "ramp.mp4")
    job = reviewed(client)
    parts = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    fade = [{"after": "s0", "kind": "fade", "secs": 0.4}]
    cut = [cut_out(parts[0], feather=0), cut_out(parts[1], feather=0), parts[2]]
    # The same video over the Main Track, and behind it: in the corner, outside every kept area, each
    # shows the video at its own time of the Timeline.
    duration = preview(client, job, patch(client, job, add(client, job, "halo", "ya"), segments=cut, transitions=fade))["plan"]["segments"][1]["end"]
    over = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=cut, transitions=fade, overlays=[behind(ramp["id"], 0.2, duration - 0.2, behind=False)])
    under = patch(client, job, add(client, job, "halo", "ya"), layout="track", segments=cut, transitions=fade, overlays=[behind(ramp["id"], 0.2, duration - 0.2)])
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=120)["clips"]}
    job_dir = settings.data_dir / "jobs" / job["id"]
    drawn = {}
    for candidate in (over, under):
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        drawn[candidate["id"]] = corners(settings, job_dir / clip["output"]["video"])
    above, below = drawn[over["id"]], drawn[under["id"]]
    assert len(above) == len(below)
    # Brightening with its time (40 a second, 1.6 a frame) from the Overlay's start (0.2 s, frame 5) to
    # the second Segment's end, through the Transition, alike within the encoder's noise: a part read
    # from the wrong time of the video would be off by tens.
    shown = slice(6, round((duration - 0.2) * 25))
    assert np.diff(above[shown]).min() > -2 and above[shown][-1] - above[shown][0] > 40, above[shown]
    assert np.abs(above[shown] - below[shown]).max() <= 5, np.abs(above[shown] - below[shown]).max()


# MCP


@pytest.fixture
async def mcp(client):
    async with Client(client.app.state.mcp) as session:
        yield session


@pytest.mark.anyio
async def test_the_agent_sets_an_overlay_behind_and_the_dry_run_lists_it_apart(mcp, pictures, tmp_path):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, 0.1, 1.6)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    (tmp_path / "blue.png").write_bytes(pictures["blue"])
    item = await call(mcp, "add_asset", path=str(tmp_path / "blue.png"), kind="media")
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [
        {"id": "f", "media": item["id"], "start": 0.0, "secs": 1.0}, {"id": "b", "media": item["id"], "start": 0.2, "secs": 1.0},
    ]})
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "b", "behind": True}])
    assert [overlay["behind"] for overlay in merged["overlays"]] == [False, True] and merged["overlays"][1]["secs"] == 1.0
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert [event["id"] for event in plan["overlays"]] == ["f"] and [event["id"] for event in plan["behind"]] == ["b"]
