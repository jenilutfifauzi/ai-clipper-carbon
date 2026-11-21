"""Sealing an account's secrets for Postgres: its saved API keys and YouTube cookies (ADR 0033).

Postgres keeps them encrypted with SECRETS_KEY, which only the machines the owner runs have: the
database alone gives nobody the keys.
"""

import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

logger = logging.getLogger(__name__)

MAKE_KEY = 'uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'


class Sealer:
    def __init__(self, keys: str | None) -> None:
        """`keys` is SECRETS_KEY: one key, or several with commas between while a key is being
        replaced. The first seals; any of them opens. ValueError when there is none, or one is no key."""
        given = [key.strip() for key in (keys or "").split(",") if key.strip()]
        if not given:
            raise ValueError(f"DATABASE_URL is set, so SECRETS_KEY must be too, the same on every machine. Make one with: {MAKE_KEY}")
        try:
            self._fernet = MultiFernet([Fernet(key) for key in given])
        except ValueError:
            raise ValueError(f"SECRETS_KEY is not a key. Make one with: {MAKE_KEY}") from None

    def sealed(self, data: bytes) -> bytes:
        return self._fernet.encrypt(data)

    def opened(self, sealed: bytes) -> bytes | None:
        """What was sealed; None when it was sealed with a key this machine hasn't got."""
        try:
            return self._fernet.decrypt(sealed)
        except InvalidToken:
            return None
