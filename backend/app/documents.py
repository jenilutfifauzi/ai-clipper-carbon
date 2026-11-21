"""An account's JSON documents: what its stores keep, apart from the media those name.

Each store reads its whole document and writes it whole. Where the document is kept is the one thing
that differs: a file under the account's data directory (tests, the CLI, and a backend with no
DATABASE_URL), or a row in Postgres, which every machine the owner signs in on reads (ADR 0033).
A document's key is the path its file has relative to the data directory, "presets.json" say.
"""

import json
import logging
import os
import shutil
import threading
import time
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager, suppress
from pathlib import Path
from typing import Protocol

from psycopg import sql

from app.database import Database
from app.sealing import Sealer
from app.storage import write_atomic

logger = logging.getLogger(__name__)

# How long a Postgres document's version is taken as read: a store asks it before every read of what
# it remembers (the imported Faces, for each line of text drawn), and each asking is a round trip.
VERSION_FRESH_SECS = 2.0


class Document(Protocol):
    def read(self) -> bytes | None:
        """The document as last written; None before the first write."""
        ...

    def write(self, data: bytes) -> None: ...

    def delete(self) -> bool:
        """False when there was none."""
        ...

    def version(self) -> object | None:
        """What differs once the document has been written again; None while there is none."""
        ...

    def changing(self) -> AbstractContextManager[None]:
        """A block that reads the document and writes it back, with no other change in between."""
        ...


class Documents(Protocol):
    """One account's documents, by key."""

    def doc(self, key: str) -> Document: ...

    def secret(self, key: str) -> Document:
        """A document of the account's secrets, of any bytes: readable by its owner only as a file,
        and sealed in Postgres. It reads as None when this machine hasn't the key it was sealed with."""
        ...

    def under(self, folder: str) -> "Documents":
        """Those whose keys start with `folder`/, by the rest of their keys."""
        ...

    def read_named(self, name: str) -> dict[str, bytes]:
        """Every document `name` one folder down, as last written, by its folder: each Job's job.json."""
        ...

    def delete_under(self, folder: str) -> None:
        """Delete every document whose key starts with `folder`/."""
        ...


class FileDocument:
    def __init__(self, path: Path, private: bool = False) -> None:
        """`private` keeps the file, and the folder it is in, for the owner's eyes only."""
        self.path = path
        self._private = private
        self._lock = threading.Lock()

    def read(self) -> bytes | None:
        try:
            return self.path.read_bytes()
        except FileNotFoundError:
            return None

    def write(self, data: bytes) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self._private:
            os.chmod(self.path.parent, 0o700)
        write_atomic(self.path, data)
        if self._private:
            os.chmod(self.path, 0o600)

    def delete(self) -> bool:
        try:
            self.path.unlink()
        except FileNotFoundError:
            return False
        return True

    def version(self) -> object | None:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def changing(self) -> AbstractContextManager[None]:
        return self._lock


class FileDocuments:
    """The documents as files in `root`, each at its key."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def doc(self, key: str) -> FileDocument:
        return FileDocument(self.root / key)

    def secret(self, key: str) -> FileDocument:
        return FileDocument(self.root / key, private=True)

    def under(self, folder: str) -> "FileDocuments":
        return FileDocuments(self.root / folder)

    def read_named(self, name: str) -> dict[str, bytes]:
        found = {}
        for path in self.root.glob(f"*/{name}"):
            with suppress(FileNotFoundError):  # deleted meanwhile
                found[path.parent.name] = path.read_bytes()
        return found

    def delete_under(self, folder: str) -> None:
        # The folder is the documents' alone, or goes whole with them: a Job's, with its media.
        shutil.rmtree(self.root / folder, ignore_errors=True)


class PostgresDocument:
    """A row of `documents`, its JSON as jsonb; with a `sealer`, a row of `secrets`, sealed."""

    def __init__(self, database: Database, account_id: str, key: str, sealer: Sealer | None = None) -> None:
        self._database = database
        self._account_id = account_id
        self._key = key
        self._sealer = sealer
        self._table = sql.Identifier("documents" if sealer is None else "secrets")
        self._lock = threading.Lock()
        # When the version was last asked, and what it was.
        self._seen: tuple[float, int | None] | None = None

    def read(self) -> bytes | None:
        column = sql.SQL("body::text" if self._sealer is None else "ciphertext")
        row = self._database.execute(
            sql.SQL("SELECT {} FROM {} WHERE account_id = %s AND key = %s").format(column, self._table),
            (self._account_id, self._key),
        ).fetchone()
        if row is None:
            return None
        if self._sealer is None:
            return row[0].encode()
        opened = self._sealer.opened(bytes(row[0]))
        if opened is None:
            logger.warning("The saved %s can't be opened: SECRETS_KEY isn't the key it was sealed with", self._key)
        return opened

    def write(self, data: bytes) -> None:
        if self._sealer is None:
            insert = "INSERT INTO documents (account_id, key, body) VALUES (%s, %s, %s::jsonb)"
            kept, value = "body = EXCLUDED.body", _storable(data)
        else:
            insert = "INSERT INTO secrets (account_id, key, ciphertext) VALUES (%s, %s, %s)"
            kept, value = "ciphertext = EXCLUDED.ciphertext", self._sealer.sealed(data)
        self._database.execute(
            f"{insert} ON CONFLICT (account_id, key) DO UPDATE"
            f" SET {kept}, version = nextval('document_versions'), updated_at = now()",
            (self._account_id, self._key, value),
        )
        # Its new version is asked when next wanted: reading it here would be a round trip of its
        # own inside a transaction, whose writes otherwise go with the commit.
        self._seen = None

    def delete(self) -> bool:
        deleted = self._database.execute(
            sql.SQL("DELETE FROM {} WHERE account_id = %s AND key = %s RETURNING 1").format(self._table),
            (self._account_id, self._key),
        ).fetchone()
        self._seen = (time.monotonic(), None)
        return deleted is not None

    def version(self) -> object | None:
        seen = self._seen
        if seen is not None and time.monotonic() - seen[0] < VERSION_FRESH_SECS:
            return seen[1]
        row = self._database.execute(
            sql.SQL("SELECT version FROM {} WHERE account_id = %s AND key = %s").format(self._table),
            (self._account_id, self._key),
        ).fetchone()
        version = None if row is None else row[0]
        self._seen = (time.monotonic(), version)
        return version

    @contextmanager
    def changing(self) -> Iterator[None]:
        # The lock keeps this process's threads from queueing on connections; the database's keeps
        # the other machines out, until the block's reads and writes are committed together.
        with self._lock, self._database.transaction() as connection:
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{self._account_id}/{self._key}",)
            )
            yield


class PostgresDocuments:
    """The documents of the account `account_id` as rows in `database`: those whose keys start with
    `prefix`, by the rest of their keys. Its secrets are sealed by `sealer`."""

    def __init__(self, database: Database, account_id: str, sealer: Sealer | None = None, prefix: str = "") -> None:
        self._database = database
        self._account_id = account_id
        self._sealer = sealer
        self._prefix = prefix

    def doc(self, key: str) -> PostgresDocument:
        return PostgresDocument(self._database, self._account_id, self._prefix + key)

    def secret(self, key: str) -> PostgresDocument:
        if self._sealer is None:
            raise RuntimeError("Secrets are kept in Postgres only with a SECRETS_KEY to seal them")
        return PostgresDocument(self._database, self._account_id, self._prefix + key, self._sealer)

    def under(self, folder: str) -> "PostgresDocuments":
        return PostgresDocuments(self._database, self._account_id, self._sealer, f"{self._prefix}{folder}/")

    def read_named(self, name: str) -> dict[str, bytes]:
        ending = f"/{name}"
        rows = self._database.execute(
            "SELECT key, body::text FROM documents"
            " WHERE account_id = %s AND starts_with(key, %s) AND right(key, %s) = %s",
            (self._account_id, self._prefix, len(ending), ending),
        ).fetchall()
        folders = ((key[len(self._prefix) : -len(ending)], body) for key, body in rows)
        return {folder: body.encode() for folder, body in folders if folder and "/" not in folder}

    def delete_under(self, folder: str) -> None:
        self._database.execute(
            "DELETE FROM documents WHERE account_id = %s AND starts_with(key, %s)",
            (self._account_id, f"{self._prefix}{folder}/"),
        )


def document_of(source: Path | Document) -> Document:
    """A store's document: the one given, or the file at the path given."""
    return FileDocument(source) if isinstance(source, Path) else source


def _storable(data: bytes) -> str:
    """The JSON as jsonb takes it: without the NUL characters its strings can't hold."""
    text = data.decode()
    if "\\u0000" not in text:
        return text
    return json.dumps(_without_nul(json.loads(text)), ensure_ascii=False)


def _without_nul(value: object) -> object:
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_without_nul(item) for item in value]
    if isinstance(value, dict):
        return {_without_nul(key): _without_nul(item) for key, item in value.items()}
    return value
