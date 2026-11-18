"""Bringing an account's documents from its data directory into Postgres (app/account_import.py).

Run with TEST_DATABASE_URL naming a database (see test_documents.py).
"""

import json
from dataclasses import replace

import pytest
from cryptography.fernet import Fernet

from app.account_import import account_folders, import_account
from app.cli import main
from app.documents import FileDocuments, PostgresDocuments
from app.jobs import JobOptions, JobStore
from app.machine import Machine
from app.profile import ChannelProfile, ProfileStore
from app.sealing import Sealer
from app.settings_store import SettingsStore
from app.starred_effects import StarredStore
from app.workspace import IMPORTED_MARK
from test_documents import database, in_postgres, schema  # noqa: F401  (fixtures)

ACCOUNT = "a" * 64
MAC = Machine("mac-id", "Mac di rumah")


@pytest.fixture
def folder(settings, tmp_path):
    """An account's directory as the app leaves it with no database: documents, secrets and a Job."""
    folder = tmp_path / "data" / "users" / ACCOUNT
    files = FileDocuments(folder)
    ProfileStore(files.doc("profile.json")).save(ChannelProfile(niche="kopi"))
    StarredStore(files.doc("starred_effects.json")).save(["glow"])
    SettingsStore(replace(settings, data_dir=folder), files).save({"gemini_api_key": "sk-rahasia"})
    job = JobStore(folder / "jobs").create("https://example.com/watch?v=one", JobOptions(), ChannelProfile())
    (folder / "jobs" / job.id / "source.mp4").write_bytes(b"video")
    # What belongs to no account stays out of it.
    (tmp_path / "data" / "presets.json").write_text("[]")
    return folder


@in_postgres
def test_an_accounts_documents_and_secrets_are_read_from_postgres_once_imported(database, folder, settings, tmp_path):
    documents = PostgresDocuments(database, ACCOUNT, Sealer(Fernet.generate_key().decode()))
    before = {path: path.read_bytes() for path in folder.rglob("*") if path.is_file()}

    imported = import_account(folder, documents, MAC)

    assert not imported.kept and not imported.skipped
    assert ProfileStore(documents.doc("profile.json")).load() == ChannelProfile(niche="kopi")
    assert StarredStore(documents.doc("starred_effects.json")).load() == ["glow"]
    assert SettingsStore(replace(settings, data_dir=tmp_path / "server"), documents).saved().gemini_api_key == "sk-rahasia"
    # Each Job names the machine that has its media.
    [job] = JobStore(tmp_path / "server" / "jobs", documents=documents.under("jobs")).all()
    assert job.host == MAC
    # The directory is as it was, but for the mark.
    assert {path: path.read_bytes() for path in folder.rglob("*") if path.is_file() and path.name != IMPORTED_MARK} == before
    assert (folder / IMPORTED_MARK).is_file()


@in_postgres
def test_importing_again_keeps_what_postgres_has(database, folder):
    documents = PostgresDocuments(database, ACCOUNT, Sealer(Fernet.generate_key().decode()))
    first = import_account(folder, documents, MAC)
    ProfileStore(documents.doc("profile.json")).save(ChannelProfile(niche="teh"))

    again = import_account(folder, documents, MAC)

    assert (again.written, sorted(again.kept)) == ([], sorted(first.written))
    assert ProfileStore(documents.doc("profile.json")).load() == ChannelProfile(niche="teh")

    import_account(folder, documents, MAC, overwrite=True)
    assert ProfileStore(documents.doc("profile.json")).load() == ChannelProfile(niche="kopi")


@in_postgres
def test_a_dry_run_writes_nothing(database, folder):
    documents = PostgresDocuments(database, ACCOUNT, Sealer(Fernet.generate_key().decode()))

    imported = import_account(folder, documents, MAC, dry_run=True)

    assert "profile.json" in imported.written and "settings.json" in imported.written
    assert documents.doc("profile.json").read() is None
    assert not (folder / IMPORTED_MARK).exists()


def test_only_the_accounts_directories_are_accounts(folder, tmp_path):
    (tmp_path / "data" / "users" / "not-an-account").mkdir()

    assert account_folders(tmp_path / "data") == [folder]
    assert account_folders(tmp_path / "data", "b" * 64) == []


def test_a_file_that_is_not_json_is_skipped_and_said(folder):
    (folder / "presets.json").write_text("{half")

    imported = import_account(folder, FileDocuments(folder.parent / "elsewhere"), MAC, dry_run=True)

    assert imported.skipped == {"presets.json": "not JSON"}


def test_the_command_needs_a_database_to_import_into(capsys):
    assert main(["import-accounts", "--dry-run"]) == 1
    assert "DATABASE_URL" in capsys.readouterr().out
