"""Matte housekeeping (.scratch/background-removal/issues/08-matte-housekeeping.md, ADR 0015): the
pieces no Candidate nor its Revision History reads are swept when a Job is opened, never one being
made; and removing the person model is refused while a Matte is being made, and removes every Matte.
Seam A through the API and the real ffmpeg, with a fake matter that can be held mid-piece."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.candidates import Subject
from app.main import create_app
from app.matte import MATTES_DIR, MatteBusy, MatteRunner, Mattes
from app.ports import Ports
from fakes import matter_kind
from test_background_removal import cut_out, disc_video, person_model, pieces, settled  # noqa: F401
from test_preview_copies import edit, made
from test_render import add, reviewed
from test_review import candidates
from test_segments import ranges


@pytest.fixture
def matter():
    """The fake matter, held before each frame while its `gate` is shut (open to begin with), telling
    `reached` that it got there."""
    kind = matter_kind()
    kind.gate, kind.reached = threading.Event(), threading.Event()
    kind.gate.set()
    run = kind.run

    def held(self):
        alpha = run(self)

        def frame(picture):
            type(self).reached.set()
            assert type(self).gate.wait(20)
            return alpha(picture)

        return frame

    kind.run = held
    return kind


@pytest.fixture
def client(settings, video_source, transcriber, llm, disc_video, person_model, matter):  # noqa: F811
    video_source.video = disc_video
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm, person_model=person_model, matter=matter))) as client:
        try:
            yield client
        finally:
            matter.gate.set()
            video_source.release()
            transcriber.release()
            transcriber.stop()


def test_opening_a_job_sweeps_the_pieces_no_candidate_nor_revision_reads(client, settings):
    job = reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    candidate = add(client, job, "halo", "ya")
    # Cut out, then saved whole by another editor: the piece is read only by the Revision History.
    settled(client, job, edit(client, job, candidate, "advanced-edit", segments=[cut_out(first)]))
    edit(client, job, candidate, "agent", segments=[first])
    folder = settings.data_dir / "jobs" / job["id"] / MATTES_DIR
    made(
        folder,
        # Pieces no state reads, and one's failure.
        "person-fake-1-10.mp4",
        "person-fake-1-20.failed",
        # Made by an older matter (CoreML's wrong Mattes): never read.
        "person-rvm-mnv3-1-0.mp4",
        # Left by a piece cut short.
        ".person-fake-1-10.0123.part.mp4",
        # Not a piece.
        "notes.txt",
    )

    candidates(client, job)
    assert pieces(settings, job) == ["notes.txt", "person-fake-1-0.mp4"]


def test_a_used_pieces_failure_is_kept_until_its_retry(client, settings, matter):
    matter.failing = "no subject found"
    job = reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    candidate = edit(client, job, add(client, job, "halo", "ya"), "advanced-edit", segments=[cut_out(first)])
    assert settled(client, job, candidate)["state"] == "failed"

    candidates(client, job)
    assert pieces(settings, job) == ["person-fake-1-0.failed"]


def test_the_sweep_never_removes_a_piece_being_made(tmp_path, settings, disc_video, person_model, matter):  # noqa: F811
    mattes = Mattes(tmp_path / MATTES_DIR, disc_video, (640, 360, 25.0), 8.0)
    runner = MatteRunner(person_model, matter, settings.ffmpeg_bin)
    made(mattes.folder, "person-fake-1-10.mp4", ".person-fake-1-10.0123.part.mp4")
    matter.gate.clear()
    runner.ask([(mattes, Subject.PERSON, 0)])
    assert matter.reached.wait(20)
    # Its part is written once its first frames reach the encoder: they are let through one by one.
    deadline = time.monotonic() + 20
    while not any(path.name.startswith(".person-fake-1-0.") for path in mattes.folder.iterdir()):
        assert time.monotonic() < deadline
        matter.reached.clear()
        matter.gate.set()
        matter.gate.clear()
        assert matter.reached.wait(20)

    removed = runner.sweep(mattes.folder, [])
    assert sorted(path.name for path in removed) == [".person-fake-1-10.0123.part.mp4", "person-fake-1-10.mp4"]
    matter.gate.set()
    while runner.state(mattes, Subject.PERSON, 0)[0] != "ready":
        assert time.monotonic() < deadline
        time.sleep(0.05)
    assert sorted(path.name for path in mattes.folder.iterdir()) == ["person-fake-1-0.mp4"]


def test_removing_the_person_model_is_refused_while_a_matte_is_being_made_and_removes_every_matte(client, settings, matter, person_model):  # noqa: F811
    job, other = reviewed(client), reviewed(client)
    [first] = ranges(job, ("halo", "kabar"))
    settled(client, other, edit(client, other, add(client, other, "halo", "ya"), "advanced-edit", segments=[cut_out(first)]))
    matter.gate.clear()
    candidate = edit(client, job, add(client, job, "halo", "ya"), "advanced-edit", segments=[cut_out(first)])
    assert matter.reached.wait(20)

    refused = client.delete("/api/models/person")
    assert refused.status_code == 409 and "Matte" in refused.text
    assert person_model.installed

    matter.gate.set()
    settled(client, job, candidate)
    assert pieces(settings, job) == pieces(settings, other) == ["person-fake-1-0.mp4"]
    deadline = time.monotonic() + 10
    # The runner lets go of the piece just after it is there.
    while (removed := client.delete("/api/models/person")).status_code == 409:
        assert time.monotonic() < deadline, removed.text
        time.sleep(0.05)
    assert removed.status_code == 204
    assert not person_model.installed
    assert not (settings.data_dir / "jobs" / job["id"] / MATTES_DIR).exists()
    assert not (settings.data_dir / "jobs" / other["id"] / MATTES_DIR).exists()
    assert settled(client, job, candidate)["state"] == "waiting"


def test_a_runner_is_idle_only_with_nothing_asked_nor_being_made(settings, disc_video, person_model, matter, tmp_path):  # noqa: F811
    mattes = Mattes(tmp_path / MATTES_DIR, disc_video, (640, 360, 25.0), 8.0)
    runner = MatteRunner(person_model, matter, settings.ffmpeg_bin)
    with runner.idle("busy"):
        pass
    matter.gate.clear()
    runner.ask([(mattes, Subject.PERSON, 0)])
    assert matter.reached.wait(20)
    with pytest.raises(MatteBusy, match="busy"):
        with runner.idle("busy"):
            pass
    matter.gate.set()
