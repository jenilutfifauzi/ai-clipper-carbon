"""The preview's Retimed copies beyond 0.25–4×, and the sweep of unused copies
(.scratch/speed/issues/09-preview-copies-and-sweep.md): which copies an item plays from, and the
sweep when a Job is opened, through the API, of copies no Candidate nor Revision uses, of the
leftovers of copies cut short, but never of a copy being written."""

import threading
from pathlib import Path

import pytest

from app.config import load_settings
from app.retimed import Copies, CopySize, Retime, copies_played, sweep
from test_media_library import upload
from test_render import add, reviewed
from test_retimed_copies import counter, from_source_at_30  # noqa: F401
from test_review import candidate_url
from test_sped_media_segments import FPS, source_at_30  # noqa: F401


def test_an_item_plays_from_a_preview_copy_retimed_at_a_speed_a_browser_wont_play_and_from_reversed_ones_in_reverse():
    assert copies_played(1, 3) == []
    assert copies_played(1, 3, 4) == copies_played(1, 3, 0.25) == []
    assert copies_played(1, 3, 8) == [(CopySize.PREVIEW, Retime(1, 3, False, 8))]
    assert copies_played(1, 3, 0.125, pitch=True) == [(CopySize.PREVIEW, Retime(1, 3, False, 0.125, True))]
    assert copies_played(1, 3, 2, reverse=True) == [(CopySize.FULL, Retime(1, 3)), (CopySize.PREVIEW, Retime(1, 3))]
    # The render reads the reversed copy at the Speed; the preview, one reversed and retimed.
    assert copies_played(1, 3, 8, reverse=True) == [(CopySize.FULL, Retime(1, 3)), (CopySize.PREVIEW, Retime(1, 3, True, 8))]
    assert Retime(1, 3, False, 8).name(CopySize.PREVIEW) == "retimed-preview-1000-3000-x8.mp4"


def made(folder: Path, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        if name.endswith(".pieces"):
            (folder / name).mkdir()
            (folder / name / "0.mov").write_bytes(b"piece")
        else:
            (folder / name).write_bytes(b"copy")


def edit(client, job: dict, candidate: dict, source: str, **change) -> dict:
    """An edit from another editor each time, so that each is its own Revision in the history."""
    response = client.patch(candidate_url(job, candidate), json=change, headers={"X-Edit-Source": source})
    assert response.status_code == 200, response.text
    return response.json()


def test_opening_a_job_sweeps_the_copies_no_candidate_nor_revision_uses(client, settings, counter):
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    shared = upload(client, counter.read_bytes(), "shared.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["ya"]["end"]}
    sped = {"id": "v", "start": 0, "end": 2, "media": video["id"], "framing": {}, "speed": 8}
    over = {"id": "o", "media": video["id"], "start": 0, "secs": 0.1, "offset": 0.5, "speed": 16}
    candidate = edit(client, job, candidate, "advanced-edit", segments=[sped, episode], overlays=[over])
    # Now at 2×, played on the decks: the 8× copy is used only by the older Revision.
    edit(client, job, candidate, "agent", segments=[sped | {"speed": 2, "end": 0.5}, episode], overlays=[])
    other = reviewed(client)
    elsewhere = add(client, other, "halo", "ya")
    edit(client, other, elsewhere, "agent", segments=[sped | {"media": shared["id"], "speed": 6}, episode])
    edit(client, job, candidate, "clip-editor",
         segments=[sped | {"speed": 2, "end": 0.5}, sped | {"id": "s", "media": shared["id"], "speed": 6}, episode])

    copies = settings.data_dir / "media" / f"{video['id']}.retimed"
    shared_copies = settings.data_dir / "media" / f"{shared['id']}.retimed"
    source_copies = settings.data_dir / "jobs" / job["id"] / "retimed"
    made(
        copies,
        "retimed-preview-0-2000-x8.mp4",
        # The Overlay's, from 0.5 s to 2.1 s, served by a wider copy.
        "retimed-preview-0-2500-x16.mp4",
        "retimed-preview-0-2000-x8-pitch.mp4",
        "retimed-preview-0-2000-x6.mp4",
        "reversed-full-0-2000.mp4",
        ".retimed-preview-0-2000-x6.0123.part.mp4",
        ".retimed-preview-0-2000-x6.0123.pieces",
    )
    made(shared_copies, "retimed-preview-0-2000-x4.5.mp4")
    made(source_copies, "reversed-preview-1000-2000.mp4", ".reversed-full-1000-2000.0123.pieces")

    assert client.get(f"/api/jobs/{job['id']}").status_code == 200
    assert sorted(path.name for path in copies.iterdir()) == ["retimed-preview-0-2000-x8.mp4", "retimed-preview-0-2500-x16.mp4"]
    assert list(source_copies.iterdir()) == []
    # Another Job's Candidate uses that video too: its copies are kept, by either Job.
    client.get(f"/api/jobs/{other['id']}")
    assert [path.name for path in shared_copies.iterdir()] == ["retimed-preview-0-2000-x4.5.mp4"]


def test_the_sweep_never_removes_a_copy_being_written(tmp_path, counter):
    """A copy made in pieces of 1.4 s (as a 1080p video's), stopped after its first piece while the
    sweep runs."""
    copies = Copies(tmp_path / "retimed", {CopySize.FULL: counter}, (1920, 1080, FPS))
    made(copies.folder, ".reversed-full-0-2400.0123.part.mp4", "reversed-full-0-1000.mp4")
    first, done = threading.Event(), threading.Event()

    def progress(share: float) -> None:
        if share < 1:
            first.set()
            done.wait(10)

    making = threading.Thread(target=copies.make, args=(load_settings().ffmpeg_bin, CopySize.FULL, Retime(0, 2.4), progress))
    making.start()
    assert first.wait(30)
    writing = sorted(path.name for path in copies.folder.iterdir() if path.name.endswith(".pieces"))
    assert len(writing) == 1
    removed = sweep(copies.folder, [])
    done.set()
    making.join(30)
    assert sorted(path.name for path in removed) == [".reversed-full-0-2400.0123.part.mp4", "reversed-full-0-1000.mp4"]
    assert [path.name for path in copies.folder.iterdir()] == ["reversed-full-0-2400.mp4"]


@pytest.mark.parametrize("name", ["notes.txt", "reversed-full-0-1000.mov", ".DS_Store"])
def test_the_sweep_leaves_files_that_arent_copies(tmp_path, name):
    made(tmp_path, name)
    assert sweep(tmp_path, []) == [] and (tmp_path / name).exists()
