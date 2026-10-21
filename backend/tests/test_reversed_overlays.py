"""A reversed video Overlay (.scratch/speed/issues/08-reverse-in-the-advanced-edit.md): Seam B on the
planner and the copies it plays from, then Seam A through the API, MCP and a real render. It keeps
its place on the Timeline and plays `offset .. offset + (end − start) × speed` of its video
backwards, from a Retimed copy, its sound with it. And a reversed Source Segment's end, which its
left edge moves in the editor, snapped to Words on save."""

from dataclasses import replace

import numpy as np
import pytest

from app.canvas import PORTRAIT
from app.config import load_settings
from app.planner import overlay_events, overlay_sound
from app.retimed import CopySize, Retime, copies_used
from test_evaluation import candidate as plain_candidate
from test_keyed_volume import tone_level
from test_media_library import upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, render, rendered, reviewed
from test_retimed_copies import counter, sweep_at  # noqa: F401
from test_review import candidate_url, patch
from test_sped_media_segments import FPS, centre_luma, from_source_at_30, source_at_30  # noqa: F401
from test_sped_overlays import COVER, ITEMS, VIDEO, blue, library_lumas, overlay  # noqa: F401


# Seam B: the planner, and the copies it plays from


def test_a_reversed_overlay_reads_the_same_part_of_its_video_backwards_picture_and_sound():
    [event] = overlay_events([overlay(speed=2, reverse=True)], 6, ITEMS, canvas=PORTRAIT)
    assert (event.start, event.end, event.offset, event.speed, event.reverse) == (0.5, 4.5, 1.0, 2, True)
    [sound] = overlay_sound([overlay(speed=2, reverse=True)], 6, ITEMS, canvas=PORTRAIT)
    assert (sound.start, sound.end, sound.offset, sound.reverse) == (0.5, 4.5, 1.0, True)
    assert not overlay_events([overlay()], 6, ITEMS, canvas=PORTRAIT)[0].reverse


def test_a_reversed_overlay_cut_by_the_clips_end_shows_the_end_of_its_part_so_it_begins_later():
    # Shown from 0.5 to 3 s of its 4 s: forwards 1..3.5 s of its video; backwards 4.5..2 s at 1×.
    assert overlay_events([overlay()], 3, ITEMS, canvas=PORTRAIT)[0].offset == 1.0
    assert overlay_events([overlay(reverse=True)], 3, ITEMS, canvas=PORTRAIT)[0].offset == 2.5
    # At 2× it shows 1..9 s, of which 9..4 s before the Clip ends.
    assert overlay_events([overlay(speed=2, reverse=True)], 3, ITEMS, canvas=PORTRAIT)[0].offset == 4.0
    assert overlay_sound([overlay(speed=2, reverse=True)], 3, ITEMS, canvas=PORTRAIT)[0].offset == 4.0
    # Cut by its video's end, it still shows its part up to there: 6 s at 2× from 1 s reach 10 s at 5 s.
    assert overlay_events([overlay(secs=6, speed=2, reverse=True)], 20, ITEMS, canvas=PORTRAIT)[0].offset == 1.0


def test_a_reversed_overlay_plays_from_reversed_copies_of_the_part_it_shows():
    def used(**fields) -> list:
        shown = replace(plain_candidate(0, 3), overlays=[overlay(**fields)])
        return copies_used([shown], {VIDEO: 10.0})[VIDEO]

    # In a 3 s Clip, from 0.5 s: 2.5 s of its 4 s show, the end of its part (as the planner cuts it).
    assert used(reverse=True) == [(CopySize.FULL, Retime(2.5, 5)), (CopySize.PREVIEW, Retime(2.5, 5))]
    assert used(speed=2, reverse=True) == [(CopySize.FULL, Retime(4, 9)), (CopySize.PREVIEW, Retime(4, 9))]
    assert used(secs=2, reverse=True) == [(CopySize.FULL, Retime(1, 3)), (CopySize.PREVIEW, Retime(1, 3))]
    assert used() == []


# Seam A: the API and MCP


def test_reverse_is_saved_on_a_video_overlay_and_refused_on_an_image(client, counter, blue):  # noqa: F811
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    image = upload(client, blue, "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    backwards = {"id": "o", "media": video["id"], "start": 0.5, "secs": 1, "offset": 0.5, "reverse": True}
    saved = patch(client, job, candidate, overlays=[backwards])
    assert saved["overlays"][0]["reverse"] is True
    event = preview(client, job, saved)["plan"]["overlays"][0]
    assert (event["offset"], event["reverse"]) == (0.5, True)

    still = {"id": "i", "media": image["id"], "start": 0, "secs": 1, "reverse": True}
    response = client.patch(candidate_url(job, saved), json={"overlays": [still]})
    assert response.status_code == 422 and "Overlay i is an image: it has no Speed, pitch or Reverse" in response.text


def test_a_reversed_source_segments_end_moved_by_its_left_edge_is_snapped_to_words_on_save_as_a_forward_ones(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    other = {"id": "o", "start": words["Podcast"]["start"], "end": words["ya"]["end"]}
    # Its left edge dragged into the middle of "kabar".
    inside = round((words["kabar"]["start"] + words["kabar"]["end"]) / 2, 3)
    dragged = {"id": "r", "start": words["halo"]["start"], "end": inside}
    forwards = patch(client, job, candidate, segments=[dragged, other])["segments"][0]
    backwards = patch(client, job, candidate, segments=[dragged | {"reverse": True}, other])["segments"][0]
    assert backwards["reverse"] and backwards["end"] == forwards["end"] != inside
    assert backwards["end"] >= words["kabar"]["end"]


@pytest.mark.anyio
async def test_the_agent_reverses_an_overlay_and_the_dry_run_says_whether_its_copy_is_ready(client, mcp, counter):  # noqa: F811
    item = await call(mcp, "add_asset", kind="media", path=str(counter))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [{"id": "o", "media": item["id"], "start": 0, "secs": 1, "offset": 0.5}]})
    saved = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "reverse": True}])
    assert saved["overlays"][0]["reverse"] is True

    [shown] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["overlays"]
    assert {key: shown[key] for key in ("source_start", "source_end", "reverse", "copy")} == {
        "source_start": 0.5, "source_end": 1.5, "reverse": True, "copy": "made by the render",
    }
    client.app.state.media.retimed(item["id"]).make(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 2.5))
    [shown] = (await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True))["overlays"]
    assert shown["copy"] == "ready"
    message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "speed": 17}])
    assert "16" in message


# Seam A: the real ffmpeg


def test_a_reversed_overlay_renders_counting_down_with_its_sweep_backwards_and_a_keyed_one_too(client, settings, counter, tmp_path):  # noqa: F811
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    still = {"scale": [{"at": 0, "value": COVER["scale"]}, {"at": 0.5, "value": COVER["scale"]}]}
    candidate = patch(client, job, candidate, overlays=[
        # 0..2 s of the video backwards over 0.5..2.5 s, heard; then 0.5..2 s of it backwards at 2× over
        # 3..3.75 s, keyed (drawn by a frame process), from the same copy.
        {"id": "o", "media": video["id"], "start": 0.5, "secs": 2, "offset": 0, "reverse": True, "transform": COVER, "volume": 1},
        {"id": "k", "media": video["id"], "start": 3, "secs": 0.75, "offset": 0.5, "speed": 2, "reverse": True, "transform": COVER, "keys": still},
    ])
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert [path.name for path in (settings.data_dir / "media" / f"{video['id']}.retimed").iterdir()] == ["reversed-full-0-2000.mp4"]
    path = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    lumas, stored = centre_luma(settings, path), library_lumas(client, settings, video, tmp_path)
    rise = np.diff(stored).mean()
    # Its first frame is the video's frame before 2 s, then back by `speed` frames a frame.
    for start, speed, ats in ((0.5, 1, (0.5, 1.5, 2.45)), (3, 2, (3, 3.3, 3.7))):
        for at in ats:
            frame = round(at * FPS)
            wanted = stored[round(2 * FPS) - 1 - speed * (frame - round(start * FPS))]
            assert lumas[frame] == pytest.approx(wanted, abs=2 * rise + 1), (at, lumas[frame - 2 : frame + 3], wanted)
    # Its sound's sweep falls: at `at`, the tone of 2 − (at − 0.5) s into the video, not its mirror.
    for at in (0.7, 2.0):
        source = 2 - (at - 0.5)
        assert tone_level(settings, path, sweep_at(source), at) > 5 * tone_level(settings, path, sweep_at(2 - source), at), at
