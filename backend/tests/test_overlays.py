"""Overlays: videos and images laid over the Clip, picture in picture
(.scratch/advanced-edit/issues/07-overlays.md).

Seam B on the planner, then Seam A through the API and the real ffmpeg.
"""

import numpy as np
import pytest

from app.candidates import Overlay
from app.planner import OUTPUT_HEIGHT, OUTPUT_WIDTH, MediaInfo, overlay_events
from test_media_library import make, upload
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

CLIP = "ab" * 16
STILL = "cd" * 16
ITEMS = {CLIP: MediaInfo(640, 360, 4.0, True), STILL: MediaInfo(200, 100, None, False)}


def overlay(**fields) -> Overlay:
    return Overlay(**{"id": "o1", "media": CLIP, "start": 1.0, "secs": 2.0, **fields})


def test_an_overlay_is_centred_on_its_place_at_its_size_and_kept_in_the_clip_and_its_video():
    [event] = overlay_events([overlay(x=300, y=400, size=320)], 10, ITEMS)
    assert (event.area.width, event.area.height) == (320, 180)
    assert (event.area.x + event.area.width / 2, event.area.y + event.area.height / 2) == (300, 400)
    assert (event.start, event.end, event.offset, event.image) == (1.0, 3.0, 0.0, False)
    # Kept inside the frame, and cut where the Clip or its video ends.
    [corner] = overlay_events([overlay(x=OUTPUT_WIDTH, y=OUTPUT_HEIGHT, size=400)], 10, ITEMS)
    assert corner.area.x + corner.area.width == OUTPUT_WIDTH and corner.area.y + corner.area.height == OUTPUT_HEIGHT
    assert overlay_events([overlay(start=9.0)], 10, ITEMS)[0].end == 10
    assert overlay_events([overlay(offset=3.0)], 10, ITEMS)[0].end == 2.0
    # An image lasts as long as it is given; a missing item shows nothing.
    assert overlay_events([overlay(media=STILL, secs=8.0)], 10, ITEMS)[0].end == 9.0
    assert overlay_events([overlay(media="ef" * 16)], 10, ITEMS) == []


@pytest.fixture(scope="session")
def pictures(tmp_path_factory) -> dict[str, bytes]:
    """A 3 s green 320x180 video with a tone, and a blue 200x100 PNG."""
    folder = tmp_path_factory.mktemp("overlay")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "green": make(folder / "green.mp4", *lavfi, "color=c=0x00ff00:size=320x180:rate=30:duration=3", *lavfi,
                      "sine=frequency=1500:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "blue": make(folder / "blue.png", *lavfi, "color=c=0x0000ff:size=200x100", "-frames:v", "1"),
    }


def test_overlays_are_validated_and_burned_in_where_and_when_planned(client, settings, video_source, plain_video, pictures):
    video_source.video = plain_video
    green = upload(client, pictures["green"], "green.mp4").json()
    blue = upload(client, pictures["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    on_video = {"id": "v", "media": green["id"], "start": 0.2, "secs": 1.0, "x": 300, "y": 500, "size": 400}
    on_image = {"id": "i", "media": blue["id"], "start": 1.4, "secs": 1.0, "x": 700, "y": 1300, "size": 300}
    for bad in ([on_video | {"offset": 2.5}], [on_video | {"media": "ef" * 16}], [on_video | {"opacity": 2}]):
        assert client.patch(candidate_url(job, candidate), json={"overlays": bad}).status_code == 422, bad
    candidate = patch(client, job, candidate, overlays=[on_video, on_image])
    assert candidate["overlays"][0]["volume"] == 0 and candidate["overlays"][0]["opacity"] == 1
    planned = preview(client, job, candidate)["plan"]["overlays"]
    assert [(event["start"], event["end"]) for event in planned] == [(0.2, 1.2), (1.4, 2.4)]
    # Muted by default: no sound of it is planned.
    assert preview(client, job, candidate)["plan"]["audio"] == []
    assert client.delete(f"/api/media/{blue['id']}").status_code == 409

    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["overlays"] == candidate["overlays"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    def seen(at: float, colour: list[int], area: dict) -> tuple[int, bool]:
        frame = full_frame(settings, video, at)
        rows, columns = np.nonzero(np.abs(frame - np.array(colour)).max(axis=2) < 60)
        inside = len(rows) > 0 and area["y"] - 4 <= rows.min() and rows.max() <= area["y"] + area["height"] + 4 and \
            area["x"] - 4 <= columns.min() and columns.max() <= area["x"] + area["width"] + 4
        return len(rows), inside

    green_at, blue_at = planned[0]["area"], planned[1]["area"]
    count, inside = seen(0.7, [0, 255, 0], green_at)
    assert count > 0.8 * green_at["width"] * green_at["height"] and inside
    count, inside = seen(1.9, [0, 0, 255], blue_at)
    assert count > 0.8 * blue_at["width"] * blue_at["height"] and inside
    assert seen(1.9, [0, 255, 0], green_at)[0] == 0
    assert seen(0.7, [0, 0, 255], blue_at)[0] == 0
