"""The Postgres database the accounts' documents are kept in when DATABASE_URL is set (ADR 0033).

One pool of connections for the process. Stores are synchronous and called from request threads and
the Workers, so the pool is the synchronous one.

The database is far away: what a store call costs is its round trips, some 70 ms each from a Mac at
home. So a statement on its own is one round trip (the connections commit by themselves), and a
transaction sends what it can together (a pipeline).
"""

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from weakref import WeakKeyDictionary

from psycopg import Connection, Cursor, OperationalError, sql
from psycopg.abc import Params, Query
from psycopg.pq import TransactionStatus
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

# Two backends share the database's connections, and a small plan has about twenty.
POOL_SIZE = 4
# How long to wait for the database when the app starts.
OPEN_TIMEOUT_SECS = 30.0
# A connection used this recently is taken to be alive; one idle for longer is asked first, a round
# trip, since a laptop that slept has only dead ones. Told by the clock on the wall: the monotonic
# one stands still while a Mac sleeps, and would call those used a moment ago.
ALIVE_SECS = 30.0

# Some connections are slow for as long as they live, by the path their packets take: measured from
# one Mac, one in four brought a large row at some 60 kB a second, the others thirty times as fast,
# and a pool would keep such a one for hours. So each new connection downloads PROBE_BYTES, and one
# that takes longer than PROBE_SECS (a good one takes a fifth of a second) is given up for another.
PROBE_BYTES = 200_000
PROBE_SECS = 1.0
# After this many slow ones in a row the network is slow, not the path: the next is kept as it is.
PROBE_TRIES = 3

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


class SlowConnection(Exception):
    """A new connection that brought its probe too slowly to be kept."""


class Database:
    def __init__(self, url: str, schema: str | None = None) -> None:
        """`schema` keeps the tables apart from the default schema's: the tests' throwaway one."""
        self._schema = schema
        # When each connection was last used, for `_alive`.
        self._used: WeakKeyDictionary[Connection, float] = WeakKeyDictionary()
        # How many new connections in a row were given up as slow.
        self._slow = 0
        self._pool = ConnectionPool(
            url,
            min_size=1,
            max_size=POOL_SIZE,
            open=False,
            kwargs={"autocommit": True},
            configure=self._configure,
            check=self._alive,
        )

    def open(self) -> None:
        """Connect and make the tables that aren't there yet. Raises when the database can't be reached."""
        self._pool.open(wait=True, timeout=OPEN_TIMEOUT_SECS)
        with self.transaction() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_SCHEMA_LOCK,))
            for statement in _SCHEMA:
                connection.execute(statement)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        """A connection for a statement: the transaction's inside `transaction`, and otherwise one of
        the pool's, on which each statement is committed as it is made."""
        bound = _IN_TRANSACTION.get()
        if bound is not None and bound[0] is self:
            yield bound[1]
            return
        with self._borrowed() as connection:
            yield connection

    def execute(self, query: Query, params: Params | None = None) -> Cursor:
        """A statement made on `connection`'s connection, with its rows to fetch. Outside a
        transaction, one whose connection turns out dead is made once more on another: a connection
        can die between two uses however lately it was used, and a stream of events reads on for hours."""
        bound = _IN_TRANSACTION.get()
        if bound is not None and bound[0] is self:
            return bound[1].execute(query, params)
        with self._borrowed() as connection:
            try:
                return connection.execute(query, params)
            except OperationalError:
                if not (connection.broken or connection.closed):
                    raise
                logger.warning("A database connection died; making the statement again on another")
                # What killed it may have killed the others: each is asked before it is lent again.
                self._used.clear()
        with self._borrowed() as connection:
            return connection.execute(query, params)

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """A block whose statements, `connection`'s too, are committed together, or not at all when it
        raises. Inside another, it is part of that one.

        Its statements are sent together with the next one whose result is read, and the last of them
        with the commit: a statement that fails is known by then, not when it is made."""
        bound = _IN_TRANSACTION.get()
        if bound is not None and bound[0] is self:
            yield bound[1]
            return
        with self._borrowed() as connection:
            token = _IN_TRANSACTION.set((self, connection))
            try:
                # BEGIN and COMMIT are statements of the pipeline like the others, so that they cost no
                # round trip of their own: psycopg's own transaction block would make one of each.
                with connection.pipeline():
                    connection.execute("BEGIN")
                    yield connection
                    connection.execute("COMMIT")
            except BaseException:
                if not connection.closed and connection.info.transaction_status is not TransactionStatus.IDLE:
                    connection.execute("ROLLBACK")
                raise
            finally:
                _IN_TRANSACTION.reset(token)

    @contextmanager
    def _borrowed(self) -> Iterator[Connection]:
        with self._pool.connection() as connection:
            try:
                yield connection
            finally:
                self._used[connection] = time.time()

    def _alive(self, connection: Connection) -> None:
        """The pool's check of a connection it is about to lend; raises for a dead one, which it replaces."""
        if time.time() - self._used.get(connection, 0.0) > ALIVE_SECS:
            ConnectionPool.check_connection(connection)

    def _configure(self, connection: Connection) -> None:
        """Ready a new connection for the pool, which tries another when this raises SlowConnection."""
        started = time.monotonic()
        connection.execute("SELECT repeat('x', %s)", (PROBE_BYTES,)).fetchone()
        took = time.monotonic() - started
        if took > PROBE_SECS and self._slow < PROBE_TRIES:
            self._slow += 1
            raise SlowConnection(f"{PROBE_BYTES // 1000} kB took {took:.1f} s")
        if took > PROBE_SECS:
            logger.warning("The database is slow from here: %d kB took %.1f s on every connection tried", PROBE_BYTES // 1000, took)
        self._slow = 0
        if self._schema:
            schema = sql.Identifier(self._schema)
            connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(schema))
            connection.execute(sql.SQL("SET search_path TO {}").format(schema))
        self._used[connection] = time.time()
