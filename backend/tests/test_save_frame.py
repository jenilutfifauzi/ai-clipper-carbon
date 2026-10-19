"""Save frame (.scratch/export-settings/issues/07-save-frame.md): the frame at a Timeline time, drawn
as the render draws it at an Export Preset's size, of the Candidate or of an unsaved draft, written
to the Job's exports/ as an Export file (GLOSSARY), outside the render queue.

Through the API with the real ffmpeg, as the clip editor and the Advanced Edit use it.
"""

import subprocess
from pathlib import Path

import numpy as np

from test_render import add, probe, render, rendered, reviewed  # noqa: F401 (a fixture)
from test_review import patch

GREEN_TITLE = {"id": "t9", "text": "JUDUL", "start": 0.0, "secs": 3.0, "transform": {"y": 600}, "style": {"colour": "#00FF00", "size": 160}}
SHAPE = {"id": "s1", "start": 0.0, "secs": 3.0, "transform": {"x": 540, "y": 1400}, "style": {"width": 500, "height": 200, "fill": "#FF00FF"}}


def frame_url(job: dict, candidate: dict) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}/frame"


def saved_frame(client, job: dict, candidate: dict, **body) -> dict:
    response = client.post(frame_url(job, candidate), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def pixels_of(settings, png: Path) -> np.ndarray:
    """The PNG's pixels, RGB, as ints."""
    [stream] = probe(settings, png)["streams"]
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(png), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(stream["height"], stream["width"], 3).astype(int)


def clip_frame(settings, video: Path, at: float) -> np.ndarray:
    """The Clip's frame at `at` seconds, at its size, RGB."""
    command = [
        str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-vf", f"select='gte(t\\,{at})'", "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(1920, 1080, 3).astype(int)


def test_a_frame_has_the_presets_size_or_the_defaults_and_leaves_the_job_and_its_queue_alone(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    job_dir = settings.data_dir / "jobs" / job["id"]

    small = saved_frame(client, job, candidate, at=0.5, export_preset_id="small")
    # Named after the Candidate and the time (mm.ss.ff, at the Source's 25 fps), in the Job's exports/.
    assert small["file"] == f"exports/{candidate['id']}-00.00.12.png"
    assert small["url"] == f"/media/{job['id']}/{small['file']}"
    [stream] = probe(settings, job_dir / small["file"])["streams"]
    assert (stream["codec_name"], stream["width"], stream["height"]) == ("png", 720, 1280)
    served = client.get(small["url"])
    assert served.status_code == 200 and served.content == (job_dir / small["file"]).read_bytes()

    # Without a Preset, the default's size; the same name is overwritten.
    default = saved_frame(client, job, candidate, at=0.5)
    assert default["file"] == small["file"]
    [stream] = probe(settings, job_dir / default["file"])["streams"]
    assert (stream["width"], stream["height"]) == (1080, 1920)

    now = client.get(f"/api/jobs/{job['id']}").json()
    assert now["status"] == "review"
    assert client.get(f"/api/jobs/{job['id']}/clips").json() == []

    assert client.post(frame_url(job, candidate), json={"at": 0.5, "export_preset_id": "nope"}).status_code == 422
    assert client.post(frame_url(job, {"id": "nope"}), json={"at": 0.5}).status_code == 404

    # Export files go with the Job.
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert not (job_dir / "exports").exists()


def test_a_frame_shows_an_unsaved_draft_text_layer_at_its_planned_place(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    job_dir = settings.data_dir / "jobs" / job["id"]
    plain = pixels_of(settings, job_dir / saved_frame(client, job, candidate, at=1.0)["file"])

    draft = {"text_layers": [GREEN_TITLE]}
    drawn = pixels_of(settings, job_dir / saved_frame(client, job, candidate, at=1.0, draft=draft)["file"])
    planned = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/preview-plan", json=draft).json()["plan"]
    [event] = planned["texts"]
    box = event["picture"]["bounds"]
    left, top, right, bottom = box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"]

    changed = np.abs(drawn - plain).sum(axis=2) > 60
    rows, columns = np.nonzero(changed)
    assert len(rows), "the draft's Text Layer isn't drawn"
    # Everything it changed is within its planned bounds, and it is green.
    assert left - 2 <= columns.min() and columns.max() <= right + 2, (columns.min(), columns.max(), box)
    assert top - 2 <= rows.min() and rows.max() <= bottom + 2, (rows.min(), rows.max(), box)
    inked = drawn[changed]
    assert (inked[:, 1] > 200).mean() > 0.5
    # The draft wasn't saved.
    [now] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert now["text_layers"] == [] and now["revision"] == candidate["revision"]


def test_a_frames_caption_hook_and_shape_match_the_rendered_clips_frame_at_that_time(client, settings):
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "halo", "kabar"), hook_text="Halo semua", shapes=[SHAPE])
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]

    for at in (0.4, 1.2):
        frame = pixels_of(settings, job_dir / saved_frame(client, job, candidate, at=at)["file"])
        clip_at = clip_frame(settings, job_dir / clip["output"]["video"], at)
        difference = np.abs(frame - clip_at).sum(axis=2)
        # Only the Clip's encoding tells them apart.
        assert difference.mean() < 12, (at, difference.mean())
        assert (difference > 120).mean() < 0.01, (at, (difference > 120).mean())
        # The Shape is drawn where the render draws it.
        assert (np.abs(frame[1400, 540] - [255, 0, 255]) < 30).all()


def test_a_saved_frame_goes_into_the_media_library_as_an_image_that_can_be_an_overlay(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    job_dir = settings.data_dir / "jobs" / job["id"]
    saved = saved_frame(client, job, candidate, at=0.5)

    png = (job_dir / saved["file"]).read_bytes()
    uploaded = client.post("/api/media", files={"file": ("Judul-00.00.12.png", png, "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    item = uploaded.json()
    assert (item["kind"], item["width"], item["height"]) == ("image", 1080, 1920)

    overlaid = patch(client, job, candidate, overlays=[{"id": "o1", "media": item["id"], "start": 0.0, "secs": 1.0}])
    assert overlaid["overlays"][0]["media"] == item["id"]
