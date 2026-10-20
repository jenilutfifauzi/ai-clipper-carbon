"""Compare render (.scratch/color-adjust/issues/08-before-view-and-compare-render.md): the frame at a
Timeline time, drawn by the render path (save_frame's drawing) at 1080x1920, of the Candidate or of an
unsaved draft, returned as a PNG and never kept in the Job.

Through the API with the real ffmpeg, as the Advanced Edit's player uses it.
"""

from pathlib import Path

import numpy as np

from test_render import add, pixels, plain_video, probe, render, rendered, reviewed  # noqa: F401 (fixtures)
from test_review import patch
from test_save_frame import SHAPE, clip_frame, pixels_of, saved_frame

GREY = {"adjust": {"saturation": -100}}


def compare_url(job: dict, candidate: dict) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}/compare-frame"


def compared(client, settings, tmp_path: Path, job: dict, candidate: dict, **body) -> np.ndarray:
    """The Compare render's PNG, checked as one at 1080x1920, as RGB pixels."""
    response = client.post(compare_url(job, candidate), json=body)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    png = tmp_path / f"compared-{len(list(tmp_path.iterdir()))}.png"
    png.write_bytes(response.content)
    [stream] = probe(settings, png)["streams"]
    assert (stream["codec_name"], stream["width"], stream["height"]) == ("png", 1080, 1920)
    return pixels_of(settings, png)


def files_of(folder: Path) -> set[str]:
    return {path.relative_to(folder).as_posix() for path in folder.rglob("*")}


def test_a_compare_render_matches_the_rendered_clips_frame_and_keeps_nothing_in_the_job(client, settings, tmp_path):
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "halo", "kabar"), hook_text="Halo semua", shapes=[SHAPE], grade=GREY)
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    before = files_of(job_dir)

    for at in (0.4, 1.2):
        frame = compared(client, settings, tmp_path, job, candidate, at=at)
        clip_at = clip_frame(settings, job_dir / clip["output"]["video"], at)
        difference = np.abs(frame - clip_at).sum(axis=2)
        # Only the Clip's encoding tells them apart: its Grade, hook and Shape are the render's.
        assert difference.mean() < 12, (at, difference.mean())
        assert (difference > 120).mean() < 0.01, (at, (difference > 120).mean())

    # Nothing is kept: no Export file, no scratch left behind, the Job and its queue as they were.
    assert files_of(job_dir) == before
    assert not (job_dir / "exports").exists()
    now = client.get(f"/api/jobs/{job['id']}").json()
    assert now["status"] == "review"
    assert len(client.get(f"/api/jobs/{job['id']}/clips").json()) == 1

    assert client.post(compare_url(job, {"id": "nope"}), json={"at": 0.5}).status_code == 404
    assert client.post(compare_url(job, candidate), json={"at": -1}).status_code == 422


def test_a_compare_render_draws_an_unsaved_draft_as_save_frame_does_without_saving_it(client, settings, tmp_path):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    job_dir = settings.data_dir / "jobs" / job["id"]

    plain = compared(client, settings, tmp_path, job, candidate, at=1.0)
    draft = {"grade": GREY}
    graded = compared(client, settings, tmp_path, job, candidate, at=1.0, draft=draft)
    # The draft's Grade is drawn: the colour bars go grey.
    assert np.abs(plain - plain.mean(axis=2, keepdims=True)).mean() > 20
    assert np.abs(graded - graded.mean(axis=2, keepdims=True)).mean() < 3
    # The draft wasn't saved, and nothing was kept.
    [now] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert now["revision"] == candidate["revision"]
    assert not (job_dir / "exports").exists()

    # It is the frame save_frame draws of the same draft.
    saved = pixels_of(settings, Path(saved_frame(client, job, candidate, at=1.0, draft=draft)["path"]))
    assert np.abs(graded - saved).max() <= 1

    bad = client.post(compare_url(job, candidate), json={"at": 1.0, "draft": {"grade": {"adjust": {"saturation": 500}}}})
    assert bad.status_code == 422



GREEN = np.array([0, 255, 0])
# A green bar sliding from x 200 to 880 in 0.2 s, from the Clip's start: 3400 px a second.
SLID = {
    "id": "slid", "start": 0.0, "secs": 2.0, "transform": {"y": 300}, "style": {"width": 100, "height": 120, "fill": "#00FF00"},
    "keys": {"x": [{"at": 0, "value": 200}, {"at": 0.2, "value": 880}]},
}


def test_a_compare_render_is_drawn_at_the_frame_rate_its_clip_renders_at(client, settings, tmp_path, video_source, plain_video):
    video_source.video = plain_video
    job = reviewed(client)
    candidate = patch(client, job, add(client, job, "Podcast", "ya"), shapes=[SLID])

    def bar_at(at: float) -> float:
        _, columns = pixels(compared(client, settings, tmp_path, job, candidate, at=at)[200:400], GREEN)
        return columns.mean()

    # Never rendered: the default Export Preset's rate, the 25 fps Source's. At 0.07 s, its frame 1 (0.04 s).
    assert abs(bar_at(0.07) - (200 + 3400 * 0.04)) <= 3
    # Rendered with a 60 fps Preset, which the Clip remembers: its frame 4 (0.0667 s), as in the Clip.
    response = client.post("/api/export-presets", json={"name": "Smooth", "settings": {"codec": "h264", "resolution": 1080, "fps": 60, "quality": "recommended", "bitrate": None, "loudness": -14}})
    assert response.status_code == 201, response.text
    rendering = client.post(f"/api/jobs/{job['id']}/render", json={"candidate_ids": [candidate["id"]], "export_preset_id": response.json()["id"]})
    assert rendering.status_code == 200, rendering.text
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert abs(bar_at(0.07) - (200 + 3400 * 4 / 60)) <= 3
