"""Private, account-scoped AI and YouTube settings saved under a user's data directory.

The settings file contains API credentials and is therefore kept owner-readable
only. YouTube cookies live in their own owner-readable-only Netscape cookie file.
"""

import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.config import Settings
from app.storage import write_atomic

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
    """A disk-backed settings store that applies overrides to one workspace's Settings object."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.path = settings_path(settings)
        self.cookie_path = youtube_cookie_path(settings)

    def saved(self) -> SavedAppSettings:
        if not self.path.is_file():
            return SavedAppSettings()
        return SavedAppSettings.model_validate_json(self.path.read_bytes())

    def apply(self) -> None:
        """Apply saved values over the environment-derived defaults."""
        saved = self.saved()
        for name in saved.model_fields_set:
            setattr(self.settings, name, getattr(saved, name))
        self.settings.ytdlp_cookies_file = self.cookie_path if self.cookie_path.is_file() else None

    def save(self, values: dict[str, object]) -> None:
        """Merge a non-secret-or-secret override and persist it with strict permissions."""
        saved = self.saved().model_dump(exclude_none=True)
        saved.update(values)
        data = SavedAppSettings.model_validate(saved).model_dump(exclude_none=True, mode="json")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        write_atomic(self.path, json.dumps(data, indent=2).encode())
        os.chmod(self.path, 0o600)
        self.apply()

    def save_youtube_cookies(self, data: bytes) -> None:
        self.cookie_path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.cookie_path.parent, 0o700)
        write_atomic(self.cookie_path, data)
        os.chmod(self.cookie_path, 0o600)
        self.settings.ytdlp_cookies_file = self.cookie_path

    def delete_youtube_cookies(self) -> bool:
        try:
            self.cookie_path.unlink()
        except FileNotFoundError:
            return False
        self.settings.ytdlp_cookies_file = None
        return True
