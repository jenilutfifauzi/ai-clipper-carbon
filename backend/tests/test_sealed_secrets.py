"""An account's secrets: its saved API keys and YouTube cookies, sealed where Postgres keeps them.

The Postgres tests run when TEST_DATABASE_URL names a database (see test_documents.py).
"""

import json
from dataclasses import replace

import pytest
from cryptography.fernet import Fernet

from app.agent.credentials import SavedCredential, credential_for, delete_credential, save_credential
from app.documents import FileDocuments, PostgresDocuments
from app.sealing import Sealer
from app.settings_store import SettingsStore
from test_documents import database, in_postgres, schema  # noqa: F401  (fixtures)

COOKIES = b"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n"


@pytest.fixture
def sealer() -> Sealer:
    return Sealer(Fernet.generate_key().decode())


def test_what_is_sealed_opens_with_its_key_only():
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    sealed = Sealer(old).sealed(b"sk-rahasia")

    assert b"sk-rahasia" not in sealed
    assert Sealer(old).opened(sealed) == b"sk-rahasia"
    # While a key is being replaced, the old one still opens what it sealed.
    assert Sealer(f"{new}, {old}").opened(sealed) == b"sk-rahasia"
    assert Sealer(new).opened(sealed) is None


@pytest.mark.parametrize("keys", [None, "", " , "])
def test_a_database_with_no_key_to_seal_with_is_refused(keys):
    with pytest.raises(ValueError, match="SECRETS_KEY must be"):
        Sealer(keys)


def test_a_key_that_is_none_is_refused():
    with pytest.raises(ValueError, match="SECRETS_KEY is not a key"):
        Sealer("bukan-kunci")


def test_a_secret_file_is_for_its_owner_only(tmp_path):
    secret = FileDocuments(tmp_path / "account").secret("agent/credentials.json")
    secret.write(b"{}")

    assert (tmp_path / "account/agent/credentials.json").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "account/agent").stat().st_mode & 0o777 == 0o700


@in_postgres
def test_postgres_keeps_a_secret_sealed(database, sealer):
    secret = PostgresDocuments(database, "account", sealer).secret("settings.json")
    assert secret.read() is None

    secret.write(b'{"gemini_api_key": "sk-rahasia"}')

    assert secret.read() == b'{"gemini_api_key": "sk-rahasia"}'
    with database.connection() as connection:
        [(kept,)] = connection.execute("SELECT ciphertext FROM secrets").fetchall()
        assert connection.execute("SELECT count(*) FROM documents").fetchone() == (0,)
    assert b"sk-rahasia" not in bytes(kept)
    assert secret.delete() is True
    assert secret.read() is None


@in_postgres
def test_a_secret_sealed_with_another_key_reads_as_none(database, sealer):
    PostgresDocuments(database, "account", sealer).secret("settings.json").write(b"{}")
    stranger = Sealer(Fernet.generate_key().decode())

    assert PostgresDocuments(database, "account", stranger).secret("settings.json").read() is None


@in_postgres
def test_saved_settings_and_cookies_follow_the_account_to_another_machine(database, sealer, settings, tmp_path):
    documents = PostgresDocuments(database, "account", sealer)
    mac = SettingsStore(replace(settings, data_dir=tmp_path / "mac", gemini_api_key=None), documents)
    mac.save({"llm_provider": "gemini", "gemini_model": "gemini-pilihan", "gemini_api_key": "sk-rahasia"})
    mac.save_youtube_cookies(COOKIES)
    assert not (tmp_path / "mac/settings.json").exists()

    elsewhere = replace(settings, data_dir=tmp_path / "server", gemini_api_key=None, ytdlp_cookies_file=None)
    server = SettingsStore(elsewhere, documents)
    server.apply()

    assert (elsewhere.gemini_model, elsewhere.gemini_api_key) == ("gemini-pilihan", "sk-rahasia")
    # yt-dlp reads the cookies from this machine's own copy, kept for its owner only.
    assert elsewhere.ytdlp_cookies_file == tmp_path / "server/youtube/cookies.txt"
    assert elsewhere.ytdlp_cookies_file.read_bytes() == COOKIES
    assert elsewhere.ytdlp_cookies_file.stat().st_mode & 0o777 == 0o600

    assert mac.delete_youtube_cookies() is True
    server.apply()
    assert elsewhere.ytdlp_cookies_file is None
    assert not (tmp_path / "server/youtube/cookies.txt").exists()


@in_postgres
def test_settings_sealed_with_a_lost_key_leave_the_environments(database, sealer, settings, tmp_path):
    documents = PostgresDocuments(database, "account", sealer)
    SettingsStore(replace(settings, data_dir=tmp_path / "mac"), documents).save({"gemini_api_key": "sk-rahasia"})

    lost = PostgresDocuments(database, "account", Sealer(Fernet.generate_key().decode()))
    elsewhere = replace(settings, data_dir=tmp_path / "server", gemini_api_key="dari-env")
    SettingsStore(elsewhere, lost).apply()

    assert elsewhere.gemini_api_key == "dari-env"


@in_postgres
def test_an_agent_providers_key_is_saved_sealed(database, sealer, settings):
    secret = PostgresDocuments(database, "account", sealer).secret("agent/credentials.json")
    settings = replace(settings, anthropic_api_key=None)

    save_credential(settings, "anthropic", SavedCredential(api_key="sk-agent"), secret)

    assert credential_for(settings, "anthropic", secret).api_key == "sk-agent"
    assert json.loads(secret.read()) == {"anthropic": {"api_key": "sk-agent"}}
    assert not (settings.data_dir / "agent/credentials.json").exists()
    assert delete_credential(settings, "anthropic", secret) is True
    assert credential_for(settings, "anthropic", secret) is None
