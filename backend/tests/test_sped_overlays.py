"""A sped video Overlay (.scratch/speed/issues/04-sped-video-overlay.md): Seam B on the planner,
then Seam A through the API, MCP and the real ffmpeg: an Overlay keeps its start and end on the
Timeline and shows (end − start) × speed of its video from its offset, its sound at the same Speed."""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.candidates import KeyProperty, Overlay
from app.pictures import cover_scale
from app.canvas import PORTRAIT
from app.planner import MediaInfo, overlay_events, overlay_sound
from test_keyed_volume import tone_level
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, render, rendered, reviewed
from test_review import candidate_url, patch
from test_sped_media_segments import FPS, TONE, centre_luma, from_source_at_30, source_at_30  # noqa: F401

VIDEO, STILL = "ab" * 16, "cd" * 16
ITEMS = {VIDEO: MediaInfo(640, 360, 10.0, True), STILL: MediaInfo(200, 100, None, False)}
COVER = {"scale": cover_scale(640, 360, PORTRAIT.size)}


def overlay(**fields) -> Overlay:
    return Overlay(**{"id": "o", "media": VIDEO, "start": 0.5, "secs": 4.0, "offset": 1.0, "volume": 1.0, **fields})


# Seam B: the planner


def test_a_sped_overlay_keeps_its_place_and_reads_its_span_times_its_speed_picture_and_sound():
    [event] = overlay_events([overlay(speed=2, pitch=True)], 6, ITEMS, canvas=PORTRAIT)
    assert (event.start, event.end, event.offset, event.speed, event.pitch) == (0.5, 4.5, 1.0, 2, True)
    [sound] = overlay_sound([overlay(speed=2, pitch=True)], 6, ITEMS, canvas=PORTRAIT)
    assert (sound.start, sound.end, sound.offset, sound.speed, sound.pitch) == (0.5, 4.5, 1.0, 2, True)
    assert overlay_events([overlay()], 6, ITEMS, canvas=PORTRAIT)[0].speed == 1


def test_a_sped_overlay_is_cut_where_its_video_ends_at_its_speed():
    # 9 s of its video are left from 1 s: 4.5 s at 2×, 18 s at 0.5× (cut by the Clip at 10 s).
    assert overlay_events([overlay(secs=6, speed=2)], 20, ITEMS, canvas=PORTRAIT)[0].end == 5.0
    assert overlay_sound([overlay(secs=6, speed=2)], 20, ITEMS, canvas=PORTRAIT)[0].end == 5.0
    assert overlay_events([overlay(secs=19, speed=0.5)], 10, ITEMS, canvas=PORTRAIT)[0].end == 10
    assert overlay_events([overlay(secs=19, speed=0.5)], 30, ITEMS, canvas=PORTRAIT)[0].end == 18.5


# Seam A: the API and MCP


@pytest.fixture(scope="session")
def counter(tmp_path_factory) -> bytes:
    """A 10 s 640x360 video at FPS whose luma rises with its time (a frame counter), with a 1 kHz tone."""
    lavfi = ("-f", "lavfi", "-i")
    return make(
        tmp_path_factory.mktemp("long_counter") / "counter.mp4",
        *lavfi, f"color=c=black:size=640x360:rate={FPS}:duration=10,format=yuv420p,geq=lum='16+T*20':cb=128:cr=128",
        *lavfi, f"sine=frequency={TONE}:duration=10",
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac", "-shortest",
    )


@pytest.fixture(scope="session")
def blue(tmp_path_factory) -> bytes:
    return make(tmp_path_factory.mktemp("still") / "blue.png", "-f", "lavfi", "-i", "color=c=0x0000ff:size=200x100", "-frames:v", "1")


def test_speed_and_pitch_are_saved_and_one_past_its_video_or_on_an_image_is_refused(client, counter, blue):
    video = upload(client, counter, "counter.mp4").json()
    image = upload(client, blue, "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    sped = {"id": "o", "media": video["id"], "start": 0.5, "secs": 4, "offset": 1, "speed": 2, "pitch": True}
    saved = patch(client, job, candidate, overlays=[sped])
    assert (saved["overlays"][0]["speed"], saved["overlays"][0]["pitch"]) == (2, True)
    expected = {
        "id": "o", "media": video["id"], "start": 0.5, "end": 4.5, "offset": 1, "image": False, "speed": 2, "pitch": True, "reverse": False,
        "animation_in": "none", "animation_out": "none", "animation_ms": 300,
    }
    shown = preview(client, job, saved)["plan"]["overlays"][0]
    assert {key: shown[key] for key in expected} == expected

    still = {"id": "i", "media": image["id"], "start": 0, "secs": 1}
    for overlays, message in (
        # 1 + 5 × 2 = 11 s of a 10 s video.
        # The video is 10 s, or a frame of AAC more with some ffmpeg builds.
        ([sped | {"secs": 5}], "Overlay o runs past the end of its video (10"),
        ([sped | {"speed": 17}], "less than or equal to 16"),
        ([still | {"speed": 2}], "Overlay i is an image: it has no Speed, pitch or Reverse"),
        ([still | {"pitch": True}], "Overlay i is an image: it has no Speed, pitch or Reverse"),
    ):
        response = client.patch(candidate_url(job, saved), json={"overlays": overlays})
        assert response.status_code == 422 and message in response.text, (message, response.text)
    # 4.5 s at 2× reads to its video's end.
    assert patch(client, job, saved, overlays=[sped | {"secs": 4.5}])["overlays"][0]["secs"] == 4.5


@pytest.mark.anyio
async def test_the_agent_speeds_an_overlay_and_the_dry_run_shows_what_of_its_video_it_reads(mcp, counter, blue, tmp_path):
    (tmp_path / "counter.mp4").write_bytes(counter)
    (tmp_path / "blue.png").write_bytes(blue)
    video = await call(mcp, "add_asset", kind="media", path=str(tmp_path / "counter.mp4"))
    image = await call(mcp, "add_asset", kind="media", path=str(tmp_path / "blue.png"))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    shown = {"id": "o", "media": video["id"], "start": 0, "secs": 1, "offset": 1}
    await call(mcp, "edit_candidate", **ids, changes={"overlays": [shown, {"id": "i", "media": image["id"], "start": 0, "secs": 1}]})

    message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "i", "speed": 2}])
    assert "Overlay i is an image: it has no Speed, pitch or Reverse" in message, message
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o", "speed": 2, "pitch": True}])
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    sped, still = plan["overlays"]
    assert {key: sped[key] for key in ("start", "end", "source_start", "source_end", "speed", "pitch")} == {
        "start": 0, "end": 1, "source_start": 1, "source_end": 3, "speed": 2, "pitch": True,
    }
    assert not {"source_start", "speed", "pitch"} & still.keys()


# Seam A: the real ffmpeg


def library_lumas(client, settings, item: dict, tmp_path: Path) -> np.ndarray:
    """The mean luma of each frame of a Media Library video, as stored."""
    path = tmp_path / "stored.mp4"
    path.write_bytes(client.get(f"/api/media/{item['id']}").content)
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(path), "-vf", "crop=200:200,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-"]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.uint8).astype(float)


def test_a_4s_overlay_at_2x_from_1s_shows_its_video_from_1_to_9s_and_a_keyed_one_the_same_frames(client, settings, counter, tmp_path):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # Keyed (a still zoom), its picture is drawn by a frame process from its own decode of the video.
    still = {"scale": [{"at": 0, "value": COVER["scale"]}, {"at": 1, "value": COVER["scale"]}]}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "o", "media": video["id"], "start": 0.5, "secs": 4, "offset": 1, "speed": 2, "transform": COVER, "volume": 1},
        {"id": "k", "media": video["id"], "start": 4.7, "secs": 1, "offset": 0, "speed": 2, "transform": COVER, "keys": still},
    ])
    planned = preview(client, job, candidate)["plan"]
    assert [(event["start"], event["end"]) for event in planned["overlays"]] == [(0.5, 4.5), (4.7, 5.7)]
    assert planned["fps"] == FPS
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    path = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]

    lumas, stored = centre_luma(settings, path), library_lumas(client, settings, video, tmp_path)
    # A frame of it is this much brighter than the one before.
    rise = np.diff(stored).mean()
    # Its first frame, the middle and its last: the video's frame at offset + (t − start) × 2.
    for start, offset, ats in ((0.5, 1, (0.5, 2.5, 4.45)), (4.7, 0, (4.7, 5.2, 5.65))):
        for at in ats:
            frame = round(at * FPS)
            wanted = stored[round((offset + (frame / FPS - start) * 2) * FPS)]
            assert lumas[frame] == pytest.approx(wanted, abs=2 * rise + 1), (at, lumas[frame - 2 : frame + 3], wanted)
    # Every other frame of its 1 to 9 s.
    span = lumas[round(0.5 * FPS) : round(4.5 * FPS)]
    assert np.diff(span).mean() == pytest.approx(2 * rise, rel=0.1)
    assert (span[0], span[-1]) == (pytest.approx(stored[FPS], abs=2), pytest.approx(stored[9 * FPS - 2], abs=2))
    # Its sound plays its 8 s for its 4 s, at its pitch.
    for at in (0.7, 4.3):
        assert tone_level(settings, path, TONE, at) > 10 * tone_level(settings, path, TONE / 2, at), at


def test_an_overlays_sound_at_half_speed_keeps_its_pitch_or_falls_an_octave(client, settings, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    sound = {"media": video["id"], "secs": 1.5, "speed": 0.5, "volume": 1, "transform": {"scale": 0.2}}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "kept", "start": 0.5, **sound}, {"id": "tape", "start": 3, "pitch": True, **sound},
    ])
    audio = preview(client, job, candidate)["plan"]["audio"]
    assert [(event["start"], event["end"], event["speed"], event["pitch"]) for event in audio] == [(0.5, 2, 0.5, False), (3, 4.5, 0.5, True)]
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    path = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    for at in (0.8, 1.7):
        assert tone_level(settings, path, TONE, at) > 10 * tone_level(settings, path, TONE / 2, at), at
        assert tone_level(settings, path, TONE / 2, at + 2.5) > 10 * tone_level(settings, path, TONE, at + 2.5), at
    # Nothing of it after its end.
    assert tone_level(settings, path, TONE / 2, 4.8) < 0.1 * tone_level(settings, path, TONE / 2, 4.2)


def test_volume_keyframes_on_a_2x_overlay_are_heard_at_their_timeline_seconds(client, settings, counter):
    video = upload(client, counter, "counter.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    # Silent from 1.05 s into it on the Timeline: 2.1 s into its video.
    cut = {KeyProperty.VOLUME.value: [{"at": 1, "value": 1}, {"at": 1.05, "value": 0}]}
    candidate = patch(client, job, candidate, overlays=[
        {"id": "o", "media": video["id"], "start": 0.5, "secs": 3, "speed": 2, "transform": {"scale": 0.2}, "keys": cut},
    ])
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job, timeout=90)["clips"]
    assert clip["status"] == "done", clip["error"]
    path = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    full = tone_level(settings, path, TONE, 0.7)
    assert tone_level(settings, path, TONE, 1.4) == pytest.approx(full, rel=0.2)
    assert tone_level(settings, path, TONE, 1.8) < full * 0.05
