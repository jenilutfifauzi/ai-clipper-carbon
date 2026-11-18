"""An account's documents, as files and as rows in Postgres: both keep the same promises.

The Postgres half runs when TEST_DATABASE_URL names a database, in a schema of its own that is
dropped afterwards.
"""

import json
import os
import threading
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from psycopg import sql

from app import auth, main as main_module
from app.agent.transcript_store import TranscriptTurn, append_turn, create_thread, delete_thread, list_threads, load_transcript
from app.candidates import Candidate, Descriptions
from app.database import Database
from app.documents import Documents, FileDocuments, PostgresDocuments
from app.jobs import JobConflict, JobNotFound, JobOptions, JobStatus, JobStore
from app.ports import Ports
from app.profile import ChannelProfile
from app.styles import DEFAULT, PresetStore
from app.transcript import Transcript, Word
from fakes import FakeLlm

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
in_postgres = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL names no database")
SECRETS_KEY = Fernet.generate_key().decode()


@pytest.fixture
def schema() -> Iterator[str]:
    """A schema for one test's tables, dropped when the test ends."""
    name = f"test_{uuid4().hex}"
    yield name
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(name)))


@pytest.fixture
def database(schema) -> Iterator[Database]:
    database = Database(TEST_DATABASE_URL, schema=schema)
    database.open()
    yield database
    database.close()


@pytest.fixture(params=["files", pytest.param("postgres", marks=in_postgres)])
def documents(request, tmp_path) -> Documents:
    if request.param == "files":
        return FileDocuments(tmp_path / "account")
    return PostgresDocuments(request.getfixturevalue("database"), "account")


def test_a_document_is_read_as_it_was_last_written(documents):
    doc = documents.doc("media/media.json")
    assert doc.read() is None

    doc.write(b'{"items": [1, 2.5, "tiga"], "nested": {"on": true, "none": null}}')
    assert json.loads(doc.read()) == {"items": [1, 2.5, "tiga"], "nested": {"on": True, "none": None}}

    doc.write(b"[]")
    assert json.loads(doc.read()) == []
    # Another reader of the same key, as a second store over it is, sees it too.
    assert json.loads(documents.doc("media/media.json").read()) == []
    assert documents.doc("media/other.json").read() is None


def test_a_deleted_document_is_gone(documents):
    doc = documents.doc("profile.json")
    assert doc.delete() is False

    doc.write(b"{}")
    assert doc.delete() is True
    assert doc.read() is None
    assert doc.version() is None


def test_the_version_differs_after_each_write(documents):
    doc = documents.doc("fonts/fonts.json")
    assert doc.version() is None

    doc.write(b"[1]")
    first = doc.version()
    assert first is not None
    assert doc.version() == first

    doc.write(b"[1, 2, 3]")
    assert doc.version() != first


def test_changes_made_at_once_are_all_kept(documents):
    doc = documents.doc("counter.json")
    doc.write(b"0")

    def count() -> None:
        for _ in range(20):
            with doc.changing():
                doc.write(str(json.loads(doc.read()) + 1).encode())

    threads = [threading.Thread(target=count) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert json.loads(doc.read()) == 80


def test_a_store_keeps_its_items_in_its_document(documents):
    presets = PresetStore(documents.doc("presets.json"))
    made = presets.create("Mine", DEFAULT.caption, DEFAULT.hook)
    presets.update(made.id, "Renamed", DEFAULT.caption, DEFAULT.hook)

    again = PresetStore(documents.doc("presets.json"))
    assert again.get(made.id).name == "Renamed"
    again.delete(made.id)
    assert [preset.id for preset in presets.all() if not preset.builtin] == []


@in_postgres
def test_two_machines_changing_a_document_lose_nothing(database, schema):
    other = Database(TEST_DATABASE_URL, schema=schema)
    other.open()
    try:
        here = PostgresDocuments(database, "account").doc("counter.json")
        there = PostgresDocuments(other, "account").doc("counter.json")
        here.write(b"0")

        def count(doc) -> None:
            for _ in range(20):
                with doc.changing():
                    doc.write(str(json.loads(doc.read()) + 1).encode())

        threads = [threading.Thread(target=count, args=(doc,)) for doc in (here, there)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert json.loads(here.read()) == 40
    finally:
        other.close()


@in_postgres
def test_a_change_that_fails_writes_nothing(database):
    doc = PostgresDocuments(database, "account").doc("presets.json")
    doc.write(b'["kept"]')

    with pytest.raises(RuntimeError), doc.changing():
        doc.write(b'["lost"]')
        raise RuntimeError("refused")

    assert json.loads(doc.read()) == ["kept"]


@in_postgres
def test_an_account_reads_its_own_documents_only(database):
    PostgresDocuments(database, "one").doc("profile.json").write(b'{"niche": "kopi"}')

    assert PostgresDocuments(database, "two").doc("profile.json").read() is None
    assert PostgresDocuments(database, "two").doc("profile.json").delete() is False
    assert json.loads(PostgresDocuments(database, "one").doc("profile.json").read()) == {"niche": "kopi"}


@in_postgres
def test_a_nul_character_is_dropped_from_what_postgres_keeps(database):
    doc = PostgresDocuments(database, "account").doc("transcript.json")

    doc.write(json.dumps({"text": "a\x00b", "plain": "c"}).encode())

    assert json.loads(doc.read()) == {"text": "ab", "plain": "c"}


def signed_in_app(monkeypatch, settings, data_dir, schema, **changes):
    """A production-mode app keeping its documents in the test schema, signed in as the bearer names:
    one machine, with `data_dir` as its own."""
    auth._clerk_options.cache_clear()
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", data_dir / "unused-clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")

    def authenticate(request, options):
        scheme, _, subject = request.headers.get("authorization", "").partition(" ")
        signed_in = scheme.lower() == "bearer" and bool(subject)
        return SimpleNamespace(is_signed_in=signed_in, payload={"sub": subject} if signed_in else {})

    monkeypatch.setattr(auth, "authenticate_request", authenticate)
    monkeypatch.setattr(main_module, "Database", lambda url: Database(url, schema=schema))
    base = replace(
        settings, data_dir=data_dir, database_url=TEST_DATABASE_URL, secrets_key=SECRETS_KEY, ytdlp_cookies_file=None, **changes
    )
    monkeypatch.setattr(main_module, "load_settings", lambda: base)
    return main_module.create_app(ports_factory=lambda _settings: Ports(None, None, FakeLlm()), test_mode=False)


@in_postgres
def test_an_account_finds_its_presets_on_another_machine(monkeypatch, settings, tmp_path, schema):
    owner, stranger = {"Authorization": "Bearer user_owner"}, {"Authorization": "Bearer user_stranger"}
    profile = {"niche": "kopi", "audience": "", "clip_style": "", "avoid": ""}

    with TestClient(signed_in_app(monkeypatch, settings, tmp_path / "mac", schema)) as mac:
        assert mac.put("/api/profile", json=profile, headers=owner).status_code == 200
        assert mac.put("/api/starred-effects", json=["glow"], headers=owner).status_code == 200

    # Nothing of them is left to the first machine's disk.
    assert not list((tmp_path / "mac").rglob("profile.json"))
    assert not list((tmp_path / "mac").rglob("starred_effects.json"))

    with TestClient(signed_in_app(monkeypatch, settings, tmp_path / "server", schema)) as server:
        assert server.get("/api/profile", headers=owner).json() == profile
        assert server.get("/api/starred-effects", headers=owner).json() == ["glow"]
        assert server.get("/api/starred-effects", headers=stranger).json() == []
    auth._clerk_options.cache_clear()


def _candidate(candidate_id: str) -> Candidate:
    return Candidate(
        id=candidate_id, start=10, end=40, predicted_score=50, hook_strength=50, emotion="", reason="",
        retention_notes="", hook_text="", title="", descriptions=Descriptions("", "", ""), hashtags=[],
        window_id="w001", window_score=50,
    )


def test_a_job_and_what_is_kept_with_it_are_read_back_from_its_documents(documents, tmp_path):
    store = JobStore(tmp_path / "media" / "jobs", documents=documents.under("jobs"))
    job = store.create("https://example.com/watch?v=one", JobOptions(), ChannelProfile(niche="kopi"))
    told: list[tuple[str, JobStatus | None]] = []

    with store.watch(lambda job_id, changed: told.append((job_id, changed and changed.status))):
        assert not store.has_transcript(job.id)
        store.save_transcript(job.id, Transcript("id", "whisper", [Word("halo", 0, 0.5)], []))
        store.update(job.id, status=JobStatus.REVIEW, expect={JobStatus.QUEUED})
        with pytest.raises(JobConflict):
            store.update(job.id, status=JobStatus.ERROR, expect={JobStatus.QUEUED})
        store.change_candidates(job.id, lambda job, _: ([_candidate("a")], None))
        store.change_candidates(job.id, lambda job, kept: ([replace(kept[0], title="Baru", revision=kept[0].revision + 1)], None))

    # Another store over the same documents, as the other machine's is, reads all of it.
    other = JobStore(tmp_path / "elsewhere" / "jobs", documents=documents.under("jobs"))
    assert [each.id for each in other.all()] == [job.id]
    assert other.get(job.id).status is JobStatus.REVIEW
    assert other.get(job.id).profile == ChannelProfile(niche="kopi")
    assert other.has_transcript(job.id)
    assert other.load_transcript(job.id).words == [Word("halo", 0, 0.5)]
    assert [candidate.title for candidate in other.load_candidates(job.id)] == ["Baru"]
    assert [entry.candidate.title for entry in other.revision_history(job.id, "a")] == ["", "Baru"]
    assert told == [(job.id, JobStatus.REVIEW), (job.id, JobStatus.REVIEW), (job.id, JobStatus.REVIEW)]

    other.delete(job.id)
    assert store.all() == []
    with pytest.raises(JobNotFound):
        store.get(job.id)
    assert store.load_candidates(job.id) is None


@in_postgres
def test_a_refused_change_to_a_job_saves_none_of_it(database, tmp_path):
    store = JobStore(tmp_path / "jobs", documents=PostgresDocuments(database, "account").under("jobs"))
    job = store.create("", JobOptions(), ChannelProfile())
    store.change_candidates(job.id, lambda job, _: ([_candidate("a")], None))

    def refused(job, clips):
        store.save_candidates(job.id, [])
        raise RuntimeError("refused")

    with pytest.raises(RuntimeError):
        store.change_clips(job.id, refused)

    assert [candidate.id for candidate in store.load_candidates(job.id)] == ["a"]


def test_a_candidates_agent_threads_are_kept_among_its_jobs_documents(documents):
    job = documents.under("jobs").under("0123456789ab")
    thread = create_thread(job, "cand")
    turn = TranscriptTurn(id="t1", provider="deepseek", model=None, prompt="Potong awalnya", stop="end_turn", started_at=datetime.now(UTC))
    append_turn(job, "cand", thread.id, turn)

    # Read as the other machine reads them.
    again = documents.under("jobs").under("0123456789ab")
    assert [(each.id, each.title) for each in list_threads(again, "cand")] == [(thread.id, "Potong awalnya")]
    assert [each.id for each in load_transcript(again, "cand", thread.id)] == ["t1"]

    delete_thread(again, "cand", thread.id)
    assert list_threads(job, "cand") == []
    assert load_transcript(job, "cand", thread.id) == []
