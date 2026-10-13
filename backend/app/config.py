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
# The owner's past clips: eval references and few-shot examples (app/references.py).
REFERENCE_SET = REPO_ROOT / "eval" / "references.yaml"

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
class SelectionTuning:
    """Every number Selection uses. Not read from the environment; tests shrink the retry delay.

    Changing a temperature or what the prompts hold changes what the eval measures: bump
    PROMPT_VERSION in app/prompts.py.
    """

    # Windows are max(window_min_secs, window_factor x the Job's max clip length) long and
    # overlap their neighbours by window_overlap_secs.
    window_min_secs: float = 90
    window_factor: float = 1.5
    window_overlap_secs: float = 30
    # The Score pass sends at most this many Windows per request.
    score_batch_size: int = 8
    score_temperature: float = 0.2
    # Target count: max(min_candidates, episode minutes / minutes_per_candidate, rounded).
    min_candidates: int = 3
    minutes_per_candidate: float = 9
    # The shortlist holds shortlist_factor x the target count of the best-scoring Windows, leaving
    # out any that overlaps an already shortlisted one by more than shortlist_max_overlap of its length.
    shortlist_factor: float = 2
    shortlist_max_overlap: float = 0.5
    # The Score pass gets the Channel Profile in short, each field flattened to one line of at most
    # profile_summary_chars characters, since every batch repeats it; the Detail pass gets it in full.
    profile_summary_chars: int = 200
    # openshorts' value for its Detail pass, which writes the creative copy.
    detail_temperature: float = 0.9
    # The Detail pass's few-shot examples, from the Reference Set's fewshot clips: at most
    # fewshot_max_examples, lasting at most fewshot_max_secs together (about 1,500 words of speech,
    # small next to a long episode's Transcript), taken in turn from each episode in file order.
    # A clip that would go past fewshot_max_secs is left out and the next one tried.
    fewshot_max_examples: int = 8
    fewshot_max_secs: float = 600
    # Candidate edges snap to a Word within snap_search_secs of the proposed time, then take a
    # lead-in before the first Word and a tail after the last one.
    snap_search_secs: float = 1.5
    lead_in_secs: float = 0.35
    tail_secs: float = 0.45
    # A Candidate outside the Job's duration range is trimmed or extended at Word boundaries if that
    # moves its edges by at most this much in all, and dropped otherwise.
    duration_fix_secs: float = 15
    # Transient LLM errors: llm_attempts tries in all, waiting llm_retry_secs, then twice as long each time.
    llm_attempts: int = 5
    llm_retry_secs: float = 2


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    gemini_model: str
    whisper_model: str
    ffmpeg_bin: Path
    data_dir: Path
    ytdlp_cookies_from_browser: str | None
    selection_audio_signal: bool
    # Not read from the environment: the eval points it at the Reference Set it measures against.
    reference_set: Path = REFERENCE_SET
    transcription: TranscriptionTuning = TranscriptionTuning()
    selection: SelectionTuning = SelectionTuning()

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
