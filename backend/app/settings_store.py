"""Private, account-scoped AI and YouTube settings saved among a user's secrets (app/documents.py).

The settings contain API credentials and are therefore kept owner-readable only as a file, and
sealed in Postgres. YouTube cookies are a secret of their own, in Netscape format; yt-dlp reads
them from an owner-readable-only file under the user's data directory, written from the secret
when that is kept in Postgres.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.config import Settings
from app.documents import Documents, FileDocument, FileDocuments

SETTINGS_FILE = "settings.json"
YOUTUBE_COOKIE_RELATIVE = Path("youtube") / "cookies.txt"


class SavedAppSettings(BaseModel):
    """Configuration overrides saved by the Settings screen; never returned to the browser."""

    llm_provider: Literal["gemini", "openai"] | None = None
    gemini_model: str | None = None
    gemini_api_key: str | None = Field(default=None, repr=False)
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = Field(default=None, repr=False)
    llm_thinking: bool | None = None


def settings_path(settings: Settings) -> Path:
    return settings.data_dir / SETTINGS_FILE


def youtube_cookie_path(settings: Settings) -> Path:
    return settings.data_dir / YOUTUBE_COOKIE_RELATIVE


class SettingsStore:
    """A settings store that applies saved overrides to one workspace's Settings object."""

    def __init__(self, settings: Settings, documents: Documents | None = None) -> None:
        """`documents` keeps the account's secrets; without them, they are files in its data directory."""
        self.settings = settings
        documents = documents or FileDocuments(settings.data_dir)
        self._saved = documents.secret(SETTINGS_FILE)
        self._cookies = documents.secret(YOUTUBE_COOKIE_RELATIVE.as_posix())
        self.cookie_path = youtube_cookie_path(settings)
        # The versions of the two secrets as last applied.
        self._applied: tuple[object | None, object | None] | None = None

    def saved(self) -> SavedAppSettings:
        saved = self._saved.read()
        return SavedAppSettings() if saved is None else SavedAppSettings.model_validate_json(saved)

    def apply(self) -> None:
        """Apply saved values over the environment-derived defaults."""
        self._applied = (self._saved.version(), self._cookies.version())
        saved = self.saved()
        for name in saved.model_fields_set:
            setattr(self.settings, name, getattr(saved, name))
        self._use_cookies(self._cookies.read())

    def refresh(self) -> bool:
        """Apply the saved values again if they were saved since they were last applied, as they
        are from another machine; whether they were."""
        if (self._saved.version(), self._cookies.version()) == self._applied:
            return False
        self.apply()
        return True

    def save(self, values: dict[str, object]) -> None:
        """Merge a non-secret-or-secret override and persist it with strict permissions."""
        saved = self.saved().model_dump(exclude_none=True)
        saved.update(values)
        data = SavedAppSettings.model_validate(saved).model_dump(exclude_none=True, mode="json")
        self._saved.write(json.dumps(data, indent=2).encode())
        self.apply()

    def save_youtube_cookies(self, data: bytes) -> None:
        self._cookies.write(data)
        self._use_cookies(data)

    def delete_youtube_cookies(self) -> bool:
        deleted = self._cookies.delete()
        self._use_cookies(None)
        return deleted

    def _use_cookies(self, data: bytes | None) -> None:
        """Have yt-dlp read the saved cookies, or none: from their file, which is the secret itself
        or, for one kept in Postgres, this machine's copy of it."""
        if data is None:
            self.cookie_path.unlink(missing_ok=True)
            self.settings.ytdlp_cookies_file = None
            return
        if not (self.cookie_path.is_file() and self.cookie_path.read_bytes() == data):
            FileDocument(self.cookie_path, private=True).write(data)
        self.settings.ytdlp_cookies_file = self.cookie_path
