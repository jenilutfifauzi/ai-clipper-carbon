"""The Postgres database the accounts' documents are kept in when DATABASE_URL is set (ADR 0033).

One pool of connections for the process. Stores are synchronous and called from request threads and
the Workers, so the pool is the synchronous one.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from psycopg import Connection, sql
from psycopg_pool import ConnectionPool

# Two backends share the database's connections, and a small plan has about twenty.
POOL_SIZE = 4
# How long to wait for the database when the app starts.
OPEN_TIMEOUT_SECS = 30.0

# Any number the backends agree on: one of them makes the tables while the others wait.
_SCHEMA_LOCK = 7_203_301

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS schema_version (version int NOT NULL)",
    "CREATE SEQUENCE IF NOT EXISTS document_versions",
    # account_id is the sha256 of the Clerk subject, as the account's data directory is named.
    """CREATE TABLE IF NOT EXISTS documents (
        account_id text NOT NULL,
        key text NOT NULL,
        body jsonb NOT NULL,
        version bigint NOT NULL DEFAULT nextval('document_versions'),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, key)
    )""",
    # What an account keeps sealed (app/sealing.py): its saved API keys and YouTube cookies.
    """CREATE TABLE IF NOT EXISTS secrets (
        account_id text NOT NULL,
        key text NOT NULL,
        ciphertext bytea NOT NULL,
        version bigint NOT NULL DEFAULT nextval('document_versions'),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, key)
    )""",
    "INSERT INTO schema_version (version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version)",
)

# The connection of the transaction this thread or task is in, and the Database it is of.
_IN_TRANSACTION: ContextVar[tuple["Database", Connection] | None] = ContextVar("database_transaction", default=None)


class Database:
    def __init__(self, url: str, schema: str | None = None) -> None:
        """`schema` keeps the tables apart from the default schema's: the tests' throwaway one."""
        self._schema = schema
        self._pool = ConnectionPool(
            url,
            min_size=1,
            max_size=POOL_SIZE,
            open=False,
            configure=self._configure if schema else None,
            check=ConnectionPool.check_connection,
        )

    def open(self) -> None:
        """Connect and make the tables that aren't there yet. Raises when the database can't be reached."""
        self._pool.open(wait=True, timeout=OPEN_TIMEOUT_SECS)
        with self._pool.connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_SCHEMA_LOCK,))
            for statement in _SCHEMA:
                connection.execute(statement)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        """A connection for one statement or a few: the transaction's inside `transaction`, and
        otherwise one of the pool's, committed as the block ends."""
        bound = _IN_TRANSACTION.get()
        if bound is not None and bound[0] is self:
            yield bound[1]
            return
        with self._pool.connection() as connection:
            yield connection

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """A block whose statements, `connection`'s too, are committed together, or not at all when it
        raises. Inside another, it is part of that one."""
        bound = _IN_TRANSACTION.get()
        if bound is not None and bound[0] is self:
            yield bound[1]
            return
        with self._pool.connection() as connection:
            token = _IN_TRANSACTION.set((self, connection))
            try:
                yield connection
            finally:
                _IN_TRANSACTION.reset(token)

    def _configure(self, connection: Connection) -> None:
        schema = sql.Identifier(self._schema or "public")
        connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(schema))
        connection.execute(sql.SQL("SET search_path TO {}").format(schema))
        connection.commit()
