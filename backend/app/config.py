"""Settings from the environment, falling back to the repo-root `.env` file."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
ENV_FILE = REPO_ROOT / ".env"

MODELS_DIR = BACKEND_DIR / "models"
FONTS_DIR = BACKEND_DIR / "assets" / "fonts"
BLAZE_FACE_MODEL = MODELS_DIR / "blaze_face_short_range.tflite"
SILERO_VAD_MODEL = MODELS_DIR / "silero_vad.onnx"
MONTSERRAT_EXTRABOLD = FONTS_DIR / "Montserrat-ExtraBold.ttf"

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
DEFAULT_FFMPEG_BIN = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


@dataclass(frozen=True)
class TranscriptionTuning:
    """How local transcription is chunked and guarded. Not read from the environment; tests shrink it."""

    # A full-episode run is cut into chunks of about this length, each ending in a pause
    # found within `cut_search_secs` of it.
    chunk_secs: float = 300
    cut_search_secs: float = 30
    # The watchdog's budget for one Transcriber call: budget_secs + budget_factor x the range's
    # duration. Whisper runs at about 1.9x realtime on the target M1, so a 300 s chunk normally
    # takes about 160 s; its budget of 510 s also covers a model (re)load under memory pressure.
    budget_secs: float = 60
    budget_factor: float = 1.5


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    gemini_model: str
    whisper_model: str
    ffmpeg_bin: Path
    data_dir: Path
    ytdlp_cookies_from_browser: str | None
    selection_audio_signal: bool
    transcription: TranscriptionTuning = TranscriptionTuning()

    @property
    def ffprobe_bin(self) -> Path:
        return self.ffmpeg_bin.with_name("ffprobe")


def load_settings(env_file: Path = ENV_FILE) -> Settings:
    """Read settings; environment variables win over `env_file`, empty values mean unset."""
    env = {**dotenv_values(env_file), **os.environ}

    def get(key: str, default: str = "") -> str:
        return (env.get(key) or "").strip() or default

    data_dir = Path(get("DATA_DIR", "data")).expanduser()
    if not data_dir.is_absolute():
        data_dir = REPO_ROOT / data_dir

    return Settings(
        gemini_api_key=get("GEMINI_API_KEY") or None,
        gemini_model=get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        whisper_model=get("WHISPER_MODEL", DEFAULT_WHISPER_MODEL),
        ffmpeg_bin=Path(get("FFMPEG_BIN", DEFAULT_FFMPEG_BIN)).expanduser(),
        data_dir=data_dir,
        ytdlp_cookies_from_browser=get("YTDLP_COOKIES_FROM_BROWSER") or None,
        selection_audio_signal=_parse_bool("SELECTION_AUDIO_SIGNAL", get("SELECTION_AUDIO_SIGNAL", "false")),
    )


def _parse_bool(key: str, value: str) -> bool:
    if value.lower() in _TRUE:
        return True
    if value.lower() in _FALSE:
        return False
    raise ValueError(f"{key} must be true or false, got {value!r}")
