"""A Job on a machine that hasn't its media: the account's other machine, which reads the same
documents from Postgres (ADR 0033). Run with TEST_DATABASE_URL naming a database (see test_documents.py).
"""

from app import auth
from app.jobs import JobOptions, JobStatus
from app.profile import ChannelProfile
from fastapi.testclient import TestClient
from test_documents import database, in_postgres, schema, signed_in_app  # noqa: F401  (fixtures)

OWNER = {"Authorization": "Bearer user_owner"}


@in_postgres
def test_a_job_made_on_another_machine_is_shown_and_left_to_that_machine(monkeypatch, settings, tmp_path, schema):
    mac_app = signed_in_app(monkeypatch, settings, tmp_path / "mac", schema, machine_name="Mac di rumah")
    with TestClient(mac_app) as mac:
        here = mac.get("/api/machine", headers=OWNER).json()
        store = mac_app.state.workspace_registry.for_user("user_owner").store
        job = store.create("https://example.com/watch?v=one", JobOptions(), ChannelProfile())
        failed = store.create("https://example.com/watch?v=two", JobOptions(), ChannelProfile())
        store.update(failed.id, status=JobStatus.ERROR, stage=JobStatus.DOWNLOADING, error="No network")
        (store.job_dir(job.id) / "source.mp4").write_bytes(b"video")
        assert mac.get(f"/api/jobs/{job.id}", headers=OWNER).json()["host"] == here
    assert here["name"] == "Mac di rumah"

    with TestClient(signed_in_app(monkeypatch, settings, tmp_path / "server", schema, machine_name="Server")) as server:
        assert server.get("/api/machine", headers=OWNER).json()["id"] != here["id"]
        # Its documents are read as on its Host, which alone runs it: the queued one stays queued here.
        listed = {each["id"]: each for each in server.get("/api/jobs", headers=OWNER).json()}
        assert listed[job.id]["host"] == here and listed[job.id]["status"] == "queued"
        assert server.get(f"/api/jobs/{job.id}", headers=OWNER).json()["candidates"] is None

        # What needs its media says where they are.
        for method, path in [
            ("post", f"/api/jobs/{failed.id}/retry"),
            ("post", f"/api/jobs/{job.id}/stop"),
            ("get", f"/media/{job.id}/source.mp4"),
        ]:
            refused = getattr(server, method)(path, headers=OWNER)
            assert (refused.status_code, refused.json()["detail"]) == (
                409,
                "This Job's files aren't on this machine: they are on Mac di rumah",
            ), path
        assert server.get(f"/api/jobs/{failed.id}", headers=OWNER).json()["status"] == "error"

        # Deleted here, it is gone from the account; its media are left where they are.
        assert server.delete(f"/api/jobs/{job.id}", headers=OWNER).status_code == 204
        assert job.id not in {each["id"] for each in server.get("/api/jobs", headers=OWNER).json()}
    assert [path.read_bytes() for path in (tmp_path / "mac").rglob("source.mp4")] == [b"video"]
    auth._clerk_options.cache_clear()


def test_a_machine_keeping_its_documents_in_files_has_every_jobs_media(client):
    assert client.get("/api/machine").json() is None
