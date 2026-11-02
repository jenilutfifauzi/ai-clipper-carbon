"""The Settings screen's account-scoped AI and YouTube configuration routes."""

from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from app.settings_store import SettingsStore
from app.workspace import workspace_for_request

router = APIRouter(prefix="/api/settings")
MAX_COOKIE_BYTES = 2 * 1024 * 1024


class SettingsUpdate(BaseModel):
    provider: Literal["gemini", "openai-compatible"]
    model: str = Field(min_length=1, max_length=160)
    base_url: str | None = Field(default=None, max_length=2048)
    api_key: str | None = Field(default=None, repr=False)
    thinking: bool = False


class SettingsView(BaseModel):
    provider: Literal["gemini", "openai-compatible"]
    model: str
    base_url: str | None
    thinking: bool
    api_key_configured: bool
    youtube_cookies_uploaded: bool


@router.get("")
def get_settings(request: Request) -> SettingsView:
    return _view(request)


@router.put("")
def put_settings(update: SettingsUpdate, request: Request) -> SettingsView:
    _ensure_idle(request)
    workspace = workspace_for_request(request)
    settings = workspace.settings
    store: SettingsStore = workspace.settings_store
    if not update.model.strip():
        raise HTTPException(422, "Enter a model name.")
    key = update.api_key.strip() if update.api_key else ""
    if len(key) > 4096:
        raise HTTPException(422, "API keys must be 4096 characters or fewer.")
    if update.provider == "openai-compatible":
        if not update.base_url:
            raise HTTPException(422, "Enter the OpenAI-compatible API base URL.")
        parsed = urlsplit(update.base_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise HTTPException(422, "Base URL must be an http(s) URL without a username or password.")
        if settings.selection_audio_signal:
            raise HTTPException(400, "Audio-signal analysis requires Gemini. Turn it off in the backend configuration before switching providers.")
        values: dict[str, object] = {
            "llm_provider": "openai",
            "llm_model": update.model.strip(),
            "llm_base_url": update.base_url.strip().rstrip("/"),
            "llm_thinking": update.thinking,
        }
        if key:
            values["llm_api_key"] = key
    else:
        values = {"llm_provider": "gemini", "gemini_model": update.model.strip()}
        if key:
            values["gemini_api_key"] = key

    store.save(values)
    refresh = getattr(workspace.ports.llm, "refresh", None)
    if refresh:
        refresh()
    # Keep future requests paced for the selected provider. The worker is the
    # only caller that wraps the LLM with PacedLlm.
    workspace.pipeline.llm.interval = 13.0 if update.provider == "gemini" else 1.0
    return _view(request)


@router.post("/youtube-cookies")
async def upload_youtube_cookies(request: Request, file: UploadFile) -> SettingsView:
    _ensure_idle(request)
    filename = (file.filename or "").lower()
    if not filename.endswith(".txt"):
        raise HTTPException(422, "Upload a YouTube cookies.txt file in Netscape format.")
    data = await file.read(MAX_COOKIE_BYTES + 1)
    if len(data) > MAX_COOKIE_BYTES:
        raise HTTPException(413, "Cookie files must be 2 MB or smaller.")
    if not _valid_youtube_cookie_file(data):
        raise HTTPException(422, "This file is not a Netscape cookies.txt with at least one YouTube cookie.")
    workspace_for_request(request).settings_store.save_youtube_cookies(data)
    return _view(request)


@router.delete("/youtube-cookies", status_code=204)
def delete_youtube_cookies(request: Request) -> Response:
    _ensure_idle(request)
    workspace_for_request(request).settings_store.delete_youtube_cookies()
    return Response(status_code=204)


def _view(request: Request) -> SettingsView:
    settings = workspace_for_request(request).settings
    provider = "gemini" if settings.llm_provider == "gemini" else "openai-compatible"
    model = settings.gemini_model if provider == "gemini" else settings.llm_model
    key = settings.gemini_api_key if provider == "gemini" else settings.llm_api_key
    return SettingsView(
        provider=provider,
        model=model,
        base_url=None if provider == "gemini" else settings.llm_base_url,
        thinking=settings.llm_thinking,
        api_key_configured=bool(key),
        youtube_cookies_uploaded=bool(settings.ytdlp_cookies_file and settings.ytdlp_cookies_file.is_file()),
    )


def _ensure_idle(request: Request) -> None:
    if workspace_for_request(request).worker.busy:
        raise HTTPException(409, "Tunggu sampai pekerjaan yang sedang berjalan selesai sebelum mengubah pengaturan.")


def _valid_youtube_cookie_file(data: bytes) -> bool:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False
    lines = text.splitlines()
    header = next((line.strip().lower() for line in lines if line.strip()), "")
    if "netscape http cookie file" not in header and "http cookie file" not in header:
        return False
    for line in lines:
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        columns = line.split("\t")
        domain = columns[0].removeprefix("#HttpOnly_").lstrip(".").lower()
        if len(columns) >= 7 and domain.endswith("youtube.com") and columns[6]:
            return True
    return False
