"""Media Segments: uploaded videos on the Main Track, as an intro, an outro or a full-screen B-roll
(.scratch/advanced-edit/issues/06-media-segments.md).

Seam B on the planner and candidate_plan, then Seam A through the API and the real ffmpeg.
"""

import json
from dataclasses import replace
from datetime import UTC, datetime

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Background, BackgroundKind, Crop, Framing, Segment, Transform, manual_candidate
from app.config import CameraTuning
from app.media import MediaItem, MediaKind
from app.migration import migrated_candidate, migrated_clip, migrated_segment
from app.pictures import cover_scale
from app.planner import (
    FRAME, OUTPUT_HEIGHT, OUTPUT_WIDTH, Picture, SceneLayout, SegmentInput, _filled, _fitted, framed_scene, on_frame, plan_render,
)
from app.rendering import candidate_plan
from app.styles import PresetStore
from app.transcript import Word
from app.video_source import SourceMetadata
from test_media_library import make, upload
from test_music import loudness_by_window
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segments import ramp_video  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
INTRO = "ab" * 16


def box(bounds) -> tuple[int, int, int, int]:
    return bounds.x, bounds.y, bounds.width, bounds.height


def test_a_media_segment_is_its_picture_over_its_background_and_has_no_captions(tmp_path):
    small = Framing(Transform(scale=0.5), background=Background(BackgroundKind.COLOUR, "#123456"))
    planned = plan_render(
        10, 12, SOURCE,
        main_track=[
            SegmentInput(0, 2, media=INTRO, width=720, height=1280),
            SegmentInput(10, 12),
            SegmentInput(0, 1, media=INTRO, width=1280, height=720, framing=small),
        ],
    )
    [intro, episode, outro] = planned.scenes
    assert [segment.media for segment in planned.segments] == [INTRO, None, INTRO]
    assert episode.picture is None
    # At scale 1 (the default) a 9:16 video fills the frame, over its Background: a 9:16 crop of
    # it, blurred, filling the frame.
    assert intro.layout is SceneLayout.MEDIA
    assert (intro.picture.width, intro.picture.height, intro.picture.centre) == (OUTPUT_WIDTH, OUTPUT_HEIGHT, (540, 960))
    [background] = intro.panels
    assert background.blur and (background.area.width, background.area.height) == (OUTPUT_WIDTH, OUTPUT_HEIGHT)
    assert background.crop_width / background.crop_height == pytest.approx(9 / 16, abs=0.01)
    # At half its fitted size over a colour: in the middle of the frame, with no panel under it.
    assert (outro.panels, outro.colour) == ([], "#123456")
    assert box(outro.picture.bounds) == (270, 808, 540, 304)
    # The blur is of what its Crop keeps: here the right half of the video.
    [blurred] = framed_scene(0, 1, SceneLayout.MEDIA, 1280, 720, Framing(crop=Crop(left=0.5))).panels
    assert (blurred.path[0].x, blurred.crop_width, blurred.crop_height) == (640 + 118, 404, 720)

    # Captions come from the Source's Segments only.
    candidate = replace(
        manual_candidate("c1", 10, 12),
        segments=[Segment("i", 0, 2, media=INTRO, framing=Framing()), Segment("e", 10, 12)],
    )
    words = [[], [Word("halo", 0.5, 0.9)]]
    planned = candidate_plan(
        candidate, SOURCE, words, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Library(),
    )
    assert [(event.text, event.start) for event in planned.captions] == [("HALO", 2.5)]


def test_an_old_filled_or_fitted_segment_becomes_a_framing_that_shows_the_same_boxes():
    old = {"id": "i", "start": 0.0, "end": 1.0, "media": INTRO, "volume": 1.0}
    for size in ((1280, 720), (640, 360), (720, 1280), (1000, 1000)):
        filled = migrated_segment(old | {"fit": "fill"}, {INTRO: size})
        fitted = migrated_segment(old | {"fit": "blur"}, {INTRO: size})
        assert filled == old | {"framing": {"transform": {"scale": cover_scale(*size, FRAME)}, "background": {"kind": "blur"}}}
        assert fitted == old | {"framing": {"transform": {"scale": 1.0}, "background": {"kind": "blur"}}}
        assert migrated_segment(filled, {}) == filled
        [filled_scene, fitted_scene] = (
            framed_scene(0, 1, SceneLayout.MEDIA, *size, _FRAMING.validate_python(segment["framing"])) for segment in (filled, fitted)
        )
        # Filled, it was the largest 9:16 crop from the middle of the video, filling the frame: so
        # is the part of its picture on the frame now.
        was = _filled(*size, 0.0)
        shown = on_frame(filled_scene.picture)
        assert (shown.width, shown.height) == (OUTPUT_WIDTH, OUTPUT_HEIGHT), size
        assert within_a_pixel(box(shown.crop), (was.path[0].x, was.path[0].y, was.crop_width, was.crop_height)), size
        # Fitted, it was the whole video as large as fits in the middle of the frame, over a blur of
        # that crop: so it is now.
        assert within_a_pixel(box(fitted_scene.picture.bounds), box(_fitted(*size, 0.0).area)), size
        assert fitted_scene.panels == [replace(was, blur=True)]
    # A Segment of the Source just loses its fit; a missing video is taken as 16:9.
    assert migrated_segment({"id": "e", "start": 10.0, "end": 12.0, "media": None, "fit": "blur", "volume": 1.0}, {}) == {
        "id": "e", "start": 10.0, "end": 12.0, "media": None, "volume": 1.0,
    }
    assert migrated_segment(old | {"fit": "fill"}, {})["framing"]["transform"]["scale"] == cover_scale(1920, 1080, FRAME)
    candidate = {"id": "c1", "segments": [old | {"fit": "fill"}]}
    new = {"id": "c1", "segments": [migrated_segment(old | {"fit": "fill"}, {INTRO: (720, 1280)})]}
    assert migrated_candidate(candidate, {INTRO: (720, 1280)}) == new
    # A rendered Clip's Segments too, as they were rendered.
    assert migrated_clip({"candidate_id": "c1", "output": candidate}, {INTRO: (720, 1280)}) == {"candidate_id": "c1", "output": new}


_FRAMING = TypeAdapter(Framing)


def within_a_pixel(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
    return all(abs(x - y) <= 1 for x, y in zip(a, b, strict=True))


def test_the_part_of_a_picture_on_the_frame_is_what_it_draws_there():
    # 2000x1000 at (540, 960), unturned: x -460..1540 of the frame, so its middle 1080 px are on it.
    picture = framed_scene(0, 1, SceneLayout.MEDIA, 2000, 1000, Framing(Transform(scale=2000 / 1080))).picture
    assert (picture.width, picture.height) == (2000, 1000)
    shown = on_frame(picture)
    assert (box(shown.crop), shown.width, shown.height, shown.centre) == ((460, 0, 1080, 1000), 1080, 1000, (540, 960))
    # Moved right to x 0..2000 and flipped, its left 1080 px are on the frame: the video's right.
    moved = on_frame(replace(picture, centre=(1000, 960), flip_h=True))
    assert (box(moved.crop), moved.width, moved.centre) == ((920, 0, 1080, 1000), 1080, (540, 960))
    # A picture inside the frame, or turned, is drawn whole.
    small = framed_scene(0, 1, SceneLayout.MEDIA, 2000, 1000, Framing(Transform(scale=0.5))).picture
    assert on_frame(small) == small
    assert on_frame(replace(picture, rotation=10)) == replace(picture, rotation=10)


class Library:
    """A Media Library holding a 5 s 720x1280 video, INTRO."""

    def find(self, media_id: str) -> MediaItem | None:
        return MediaItem(INTRO, MediaKind.VIDEO, "intro", 1, 5.0, 720, 1280, True, datetime.now(UTC)) if media_id == INTRO else None


@pytest.fixture(scope="session")
def clips(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s red 640x360 video with a 1 kHz tone, a test pattern without sound, and a still."""
    folder = tmp_path_factory.mktemp("broll")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "red": make(folder / "red.mp4", *lavfi, "color=c=red:size=640x360:rate=30:duration=2", *lavfi,
                    "sine=frequency=1000:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "silent": make(folder / "silent.mp4", *lavfi, "testsrc2=size=640x360:rate=30:duration=2", "-c:v", "libx264"),
        "still": make(folder / "still.png", *lavfi, "color=c=red:size=8x8", "-frames:v", "1"),
    }


def test_media_segments_are_validated(client, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    still = upload(client, clips["still"], "still.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    framing = {"transform": {"scale": 2}, "background": {"kind": "colour", "colour": "#12abef"}}
    intro = {"id": "i", "start": 0, "end": 1.5, "media": red["id"], "framing": framing}
    saved = patch(client, job, candidate, segments=[intro, episode])
    assert saved["segments"][0]["framing"] == {
        "transform": {"x": 540, "y": 960, "scale": 2, "stretch_x": 1, "stretch_y": 1, "rotation": 0, "flip_h": False, "flip_v": False, "opacity": 1},
        "crop": {"left": 0, "top": 0, "right": 0, "bottom": 0},
        "background": {"kind": "colour", "colour": "#12ABEF", "image": None},
    }
    assert saved["segments"][1]["framing"] is None
    assert (saved["start"], saved["end"]) == (saved["segments"][1]["start"], saved["segments"][1]["end"])
    for bad in (
        [intro | {"media": still["id"]}, episode],
        [intro | {"media": "cd" * 16}, episode],
        [intro | {"end": 2.5}, episode],
        [intro],
        [intro | {"framing": {"background": {"kind": "colour", "colour": "red"}}}, episode],
        [intro | {"framing": {"transform": {"scale": 9}}}, episode],
    ):
        assert client.patch(candidate_url(job, saved), json={"segments": bad}).status_code == 422, bad
    # A video's Segment is placed by its Framing, which the episode's has none of: its Layout frames it.
    for bad, said in (
        ([{k: v for k, v in intro.items() if k != "framing"}, episode], "framing"),
        ([intro, episode | {"framing": framing}], "framing"),
        ([intro | {"fit": "fill"}, episode], "framing"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": bad})
        assert response.status_code == 422 and said in response.text, bad
    assert client.delete(f"/api/media/{red['id']}").status_code == 409


def test_an_intro_and_an_outro_render_around_the_episode(client, settings, video_source, ramp_video, clips):
    video_source.video = ramp_video
    red, silent = (upload(client, clips[name], f"{name}.mp4").json() for name in ("red", "silent"))
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "i", "start": 0.5, "end": 1.5, "media": red["id"], "framing": {"transform": {"scale": cover_scale(640, 360, FRAME)}}},
        {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
        {"id": "o", "start": 0, "end": 1, "media": silent["id"], "framing": {}},
    ])
    planned = preview(client, job, candidate)["plan"]
    [intro, episode, outro] = planned["segments"]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(outro["end"], abs=0.1)
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def red_share(at: float) -> float:
        frame = full_frame(settings, video, at)
        return float((np.abs(frame - np.array([255, 0, 0])).max(axis=2) < 60).mean())

    # The intro fills the frame; the episode in between is the ramp; the outro is fitted, sharp in
    # the middle of the frame, over its blur.
    assert red_share(0.5) > 0.95
    assert red_share((episode["start"] + episode["end"]) / 2) < 0.05
    frame = full_frame(settings, video, (outro["start"] + outro["end"]) / 2)
    sharp = np.abs(np.diff(frame[760:1160].mean(axis=2), axis=1)).mean()
    blurred = np.abs(np.diff(frame[100:500].mean(axis=2), axis=1)).mean()
    assert sharp > 4 * blurred
    # The intro's tone is heard; the silent outro is silent.
    levels = loudness_by_window(settings, video)
    assert levels[2:8].mean() > levels.max() * 0.3
    assert levels[int(outro["start"] * 10) + 2 : int(outro["end"] * 10) - 1].max() < levels.max() * 0.05


def test_a_media_segment_scaled_down_over_a_colour_shows_it_and_gives_way_through_a_transition(
    client, settings, video_source, ramp_video, clips,
):
    video_source.video = ramp_video
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(
        client, job, candidate,
        segments=[
            {"id": "small", "start": 0, "end": 1.5, "media": red["id"],
             "framing": {"transform": {"scale": 0.5}, "background": {"kind": "colour", "colour": "#0000FF"}}},
            {"id": "full", "start": 0, "end": 1.5, "media": red["id"], "framing": {"transform": {"scale": cover_scale(640, 360, FRAME)}}},
            {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
        ],
        transitions=[{"after": "small", "kind": "fade", "secs": 0.6}],
    )
    [fade] = preview(client, job, candidate)["plan"]["transitions"]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def corners(frame: np.ndarray) -> np.ndarray:
        return np.array([frame[20, 20], frame[20, -20], frame[-20, 20], frame[-20, -20]])

    # At half its fitted size, the red video sits in the middle of the frame, the colour all around.
    small = full_frame(settings, video, 0.4)
    assert (np.abs(corners(small) - [0, 0, 255]).max(axis=1) < 40).all()
    assert np.abs(small[960, 540] - [255, 0, 0]).max() < 40
    # Through the Transition the colour gives way to the next Segment, which fills the frame with red.
    middle = full_frame(settings, video, (fade["start"] + fade["end"]) / 2)
    assert (np.abs(corners(middle) - [128, 0, 128]).max(axis=1) < 60).all()
    after = full_frame(settings, video, fade["end"] + 0.3)
    assert (np.abs(corners(after) - [255, 0, 0]).max(axis=1) < 40).all()


def test_a_job_saved_with_filled_and_fitted_segments_reads_them_as_framings_that_plan_the_same_boxes(client, settings, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "semua", selected=False)
    # Saved before Framings: a filled intro, the episode, a fitted outro.
    path = settings.data_dir / "jobs" / job["id"] / "candidates.json"
    old = [
        {"id": "i", "start": 0.0, "end": 1.0, "media": red["id"], "fit": "fill", "volume": 1.0},
        {"id": "e", "start": candidate["start"], "end": candidate["end"], "media": None, "fit": "blur", "volume": 1.0},
        {"id": "o", "start": 0.0, "end": 1.0, "media": red["id"], "fit": "blur", "volume": 1.0},
    ]
    path.write_text(json.dumps([c | {"segments": old} if c["id"] == candidate["id"] else c for c in json.loads(path.read_text())]))

    [read] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert [segment["framing"] and segment["framing"]["transform"]["scale"] for segment in read["segments"]] == [
        cover_scale(640, 360, FRAME), None, 1.0,
    ]
    assert all("fit" not in segment for segment in read["segments"]) and read["revision"] == candidate["revision"]
    planned = preview(client, job, read)["plan"]
    [filled, *_, fitted] = (_PICTURE.validate_python(scene["picture"]) if scene["picture"] else None for scene in planned["scenes"])
    was = _filled(640, 360, 0.0)
    shown = on_frame(filled)
    assert (shown.width, shown.height) == (OUTPUT_WIDTH, OUTPUT_HEIGHT)
    assert within_a_pixel(box(shown.crop), (was.path[0].x, was.path[0].y, was.crop_width, was.crop_height))
    assert box(fitted.bounds) == box(_fitted(640, 360, 0.0).area)
    assert planned["scenes"][-1]["panels"][0]["blur"]

    # Written back in the new shape on the next save.
    patch(client, job, read, hook_text="Baru")
    [saved] = [c for c in json.loads(path.read_text()) if c["id"] == candidate["id"]]
    assert saved["segments"][0]["framing"]["transform"]["scale"] == cover_scale(640, 360, FRAME) and "fit" not in saved["segments"][0]


_PICTURE = TypeAdapter(Picture)

