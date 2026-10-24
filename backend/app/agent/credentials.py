"""The API Agent Providers' keys: saved from the setup form in DATA_DIR/agent/credentials.json (mode
600), else read from the `.env` names. A key leaves this module only for an API adapter; the browser
gets `has_key`."""

import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from app.config import DEEPSEEK_HOST, Settings
from app.storage import write_atomic

CREDENTIALS_FILE = Path("agent") / "credentials.json"


class SavedCredential(BaseModel):
    """What the setup form saved for one provider; any part may be missing."""

    api_key: str | None = Field(default=None, repr=False)
    base_url: str | None = None
    model: str | None = None


class Credential(BaseModel):
    """The key an API provider calls with, and its base URL and model when they differ from the catalog's."""

    api_key: str = Field(repr=False)
    base_url: str | None = None
    model: str | None = None
    source: Literal["saved", "env"]


def credentials_path(settings: Settings) -> Path:
    return settings.data_dir / CREDENTIALS_FILE


def saved_credentials(settings: Settings) -> dict[str, SavedCredential]:
    path = credentials_path(settings)
    if not path.is_file():
        return {}
    raw = json.loads(path.read_text())
    return {provider_id: SavedCredential.model_validate(entry) for provider_id, entry in raw.items()}


def save_credential(settings: Settings, provider_id: str, update: SavedCredential) -> None:
    """Merge `update`'s given fields into what is saved for `provider_id`."""
    entries = saved_credentials(settings)
    current = entries.get(provider_id, SavedCredential())
    entries[provider_id] = current.model_copy(update=update.model_dump(exclude_unset=True))
    _write(settings, entries)


def delete_credential(settings: Settings, provider_id: str) -> bool:
    """Forget what is saved for `provider_id`; False when nothing was."""
    entries = saved_credentials(settings)
    if entries.pop(provider_id, None) is None:
        return False
    _write(settings, entries)
    return True


def credential_for(settings: Settings, provider_id: str) -> Credential | None:
    """The saved key, else the environment's; the saved base URL and model either way. None without a key."""
    saved = saved_credentials(settings).get(provider_id, SavedCredential())
    if saved.api_key:
        return Credential(api_key=saved.api_key, base_url=saved.base_url, model=saved.model, source="saved")
    env = _env_credential(settings, provider_id)
    if env is None:
        return None
    return env.model_copy(update={"base_url": saved.base_url or env.base_url, "model": saved.model or env.model})


def _env_credential(settings: Settings, provider_id: str) -> Credential | None:
    """LLM_API_KEY is DeepSeek's when LLM_BASE_URL points there and the OpenAI-compatible provider's otherwise."""
    llm_is_deepseek = urlsplit(settings.llm_base_url).hostname == DEEPSEEK_HOST
    if provider_id == "deepseek" and llm_is_deepseek and settings.llm_api_key:
        return Credential(api_key=settings.llm_api_key, source="env")
    if provider_id == "openai-compatible" and not llm_is_deepseek and settings.llm_api_key:
        return Credential(
            api_key=settings.llm_api_key, base_url=settings.llm_base_url, model=settings.llm_model, source="env"
        )
    if provider_id == "anthropic" and settings.anthropic_api_key:
        return Credential(api_key=settings.anthropic_api_key, source="env")
    if provider_id == "gemini" and settings.gemini_api_key:
        return Credential(api_key=settings.gemini_api_key, source="env")
    return None


def _write(settings: Settings, entries: dict[str, SavedCredential]) -> None:
    path = credentials_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {provider_id: entry.model_dump(exclude_none=True) for provider_id, entry in entries.items()}
    write_atomic(path, json.dumps(data, indent=2).encode())
    os.chmod(path, 0o600)
