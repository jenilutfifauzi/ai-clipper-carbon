"""Settings from the environment, falling back to the repo-root `.env` file."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
ENV_FILE = REPO_ROOT / ".env"

MODELS_DIR = BACKEND_DIR / "models"
FONTS_DIR = BACKEND_DIR / "assets" / "fonts"
# The built-in Text Presets, a data file each (app/text_presets.py).
TEXT_PRESETS_DIR = BACKEND_DIR / "assets" / "text-presets"
# MediaPipe's full-range BlazeFace, which also finds the smaller and turned faces of wide shots (the
# short-range model, made for faces near a phone's camera, missed one in four there).
BLAZE_FACE_MODEL = MODELS_DIR / "blaze_face_full_range.tflite"
SILERO_VAD_MODEL = MODELS_DIR / "silero_vad.onnx"
MONTSERRAT_EXTRABOLD = FONTS_DIR / "Montserrat-ExtraBold.ttf"
# The owner's past clips: eval references and few-shot examples (app/references.py).
REFERENCE_SET = REPO_ROOT / "eval" / "references.yaml"
# The built frontend (`make build`), served by the app when it exists.
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_LLM_BASE_URL = "https://api.deepseek.com"
DEFAULT_LLM_MODEL = "deepseek-flash"
DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
DEFAULT_FFMPEG_BIN = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
DEEPSEEK_HOST = "api.deepseek.com"
# QuotaTuning.request_interval_secs by LLM_PROVIDER, unless LLM_REQUEST_INTERVAL_SECS is set: under 5
# requests a minute for Gemini's free tier, its per-minute limit for each model; DeepSeek limits only
# concurrent requests.
REQUEST_INTERVAL_SECS = {"gemini": 13.0, "openai": 1.0}

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}
_THINKING = {"enabled": True, "disabled": False}


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
    # The Detail pass is asked for the target count and up to spare_clips more, to replace the
    # ones post-processing drops; only the best target count are kept.
    spare_clips: int = 2
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
    # The Detail pass quotes each clip's opening and closing words. A quote is looked for among the
    # Words starting (opening) or ending (closing) within quote_search_secs of the Word the proposed
    # time means, using its first (or last) quote_max_words words; the best match counts if at least
    # quote_min_match of it matches (difflib ratio), and then places the edge instead of the time.
    quote_search_secs: float = 20
    quote_max_words: int = 10
    quote_min_match: float = 0.7
    # A sentence ends at a Word ending in . ? ! or …, or at a silence of sentence_pause_secs before
    # the next Word (a quoted edge only moves for punctuation). A clip that opens mid-sentence starts
    # at the next sentence if one starts within fragment_secs (the opening is the previous
    # sentence's tail); one that ends mid-sentence ends with its sentence if that ends within
    # complete_secs. Too long, it is cut at its last sentence end that keeps it in range, if any.
    sentence_pause_secs: float = 0.3
    fragment_secs: float = 2.5
    complete_secs: float = 4
    # The Detail prompt shows the Transcript one sentence per line; a sentence still going after
    # line_max_secs breaks at the next Segment's start.
    line_max_secs: float = 12
    # Diversity: of two clips less than adjacent_secs apart (one passage cut in two), or whose
    # topics share at least topic_overlap of their words (Jaccard), only the better is kept.
    adjacent_secs: float = 5
    topic_overlap: float = 0.5
    # A Candidate outside the Job's duration range is trimmed or extended at Word boundaries if that
    # moves its edges by at most this much in all, and dropped otherwise.
    duration_fix_secs: float = 15
    # Audio-signal mode (SELECTION_AUDIO_SIGNAL): each shortlisted Window's audio goes inline with the
    # Detail request, as mono Opus at audio_bitrate and audio_rate Hz (Gemini hears audio at about
    # 16 kb/s anyway, so more is wasted). Gemini takes inline requests of up to 20 MB, base64 and
    # prompt included, so audio_request_max_bytes caps the request: past it, the lowest-scored
    # Windows' audio is left out, with a warning on the Job. At 16 kb/s a 135 s Window is about
    # 0.36 MB as base64, so the cap holds about 50 Windows next to a 3-hour Transcript.
    audio_bitrate: str = "16k"
    audio_rate: int = 16_000
    # Windows' audio is encoded this many at a time (each encode takes one core for about 0.7 s).
    audio_workers: int = 4
    audio_request_max_bytes: int = 20_000_000
    # Transient LLM errors: llm_attempts tries in all, waiting llm_retry_secs, then twice as long each time.
    llm_attempts: int = 5
    llm_retry_secs: float = 2


@dataclass(frozen=True)
class QuotaTuning:
    """How LLM requests are paced, and how a Job waits when the LLM's quota is used up or the LLM stays
    busy. Only request_interval_secs is read from the environment; tests shrink them all."""

    # Requests start at least this far apart, so that a 3-hour episode's ~14 requests don't go out
    # back to back (see REQUEST_INTERVAL_SECS).
    request_interval_secs: float = REQUEST_INTERVAL_SECS["gemini"]
    # After a quota error, or an overload (503, 504) that outlasts Selection's retries, the Job
    # waits wait_secs, then twice as long after each further one in a row, up to max_wait_secs. A
    # quota error that suggests a wait (Gemini's RetryInfo, a Retry-After header) waits that long
    # plus retry_margin_secs instead. Once they have gone on for give_up_secs, the Job fails
    # instead: a day takes in a reset of the daily quota.
    wait_secs: float = 60
    max_wait_secs: float = 15 * 60
    retry_margin_secs: float = 2
    give_up_secs: float = 24 * 3600


@dataclass(frozen=True)
class RenderTuning:
    """How Clips are encoded. Not read from the environment; tests change the encoders."""

    # Tried in order: an encode that fails (VideoToolbox can be unavailable, say over SSH or in a VM)
    # is run again with the next.
    encoders: tuple[str, ...] = ("h264_videotoolbox", "libx264")
    # VideoToolbox's average bitrate: the platforms' recommendation for 1080p up to 30 fps (YouTube
    # asks for 8 Mb/s), with more for higher frame rates.
    bitrate: str = "8M"
    high_fps_bitrate: str = "12M"
    # libx264's constant quality, with a cap so that a busy scene can't balloon the file.
    x264_crf: int = 20
    x264_preset: str = "fast"
    x264_maxrate: str = "12M"
    # A keyframe at least this often, so that players seek quickly.
    keyframe_secs: float = 2
    # EBU R128 loudness, as the platforms normalize to: integrated, true peak, loudness range.
    loudness_lufs: float = -14
    true_peak_db: float = -1.5
    loudness_range: float = 11
    audio_bitrate: str = "192k"
    audio_rate: int = 48_000
    # The poster is the Clip's frame at this time (or its middle, for a shorter Clip).
    poster_secs: float = 1
    # Blur's background: shrunk blur_shrink times, blurred with this Gaussian sigma (in shrunk
    # pixels), darkened by blur_brightness (eq's -1 to 1) so that the shot over it stands out,
    # and scaled back up.
    blur_shrink: int = 4
    blur_sigma: float = 10
    blur_brightness: float = -0.1


@dataclass(frozen=True)
class PreviewTuning:
    """How the preview proxy of a Source the browser can't play is encoded (app/preview.py). Not
    read from the environment."""

    # Tried in order, as RenderTuning.encoders.
    encoders: tuple[str, ...] = ("h264_videotoolbox", "libx264")
    # The proxy's shorter side, at most (a 1920x1080 master gives 1280x720); a smaller master keeps its size.
    short_side: int = 720
    bitrate: str = "2M"
    x264_crf: int = 26
    x264_preset: str = "veryfast"
    # Review seeks to every Candidate's edges: a keyframe this often keeps each seek quick.
    keyframe_secs: float = 1
    audio_bitrate: str = "128k"


@dataclass(frozen=True)
class AnalysisTuning:
    """How a Clip's range is analysed before planning: scene cuts and faces. Not read from the
    environment. A Clip's analysis is cached with these values, and done again when they change."""

    # ffmpeg scdet's threshold: a frame whose scene-change score (0–100) is at least this starts a
    # new Scene. A hard cut between camera angles of the same room scores about 15–25.
    scene_threshold: float = 10
    # Faces are looked for in every face_step-th frame, decoded at face_width pixels wide.
    face_width: int = 640
    face_step: int = 3
    # MediaPipe's confidence for a detection to count.
    face_confidence: float = 0.5


@dataclass(frozen=True)
class CameraTuning:
    """How the Render Planner follows faces: the Speaker Tracker picks whom to follow, the Smooth
    Camera moves the crop. Not read from the environment; the planner's tests use the defaults."""

    # A detection is the same face as one seen before when their centres are less than
    # match_distance x the frame's width apart.
    match_distance: float = 0.15
    # Each face's score: its area (as a share of the frame) added at each sampled frame it is
    # seen in, the sum multiplied by score_decay at every sampled frame.
    score_decay: float = 0.85
    # Another face becomes the target only once its score is over stickiness x the target's, and
    # at least cooldown_frames (Source frames) after the target last changed.
    stickiness: float = 3
    cooldown_frames: int = 30
    # The face can move within a zone dead_zone x the crop's width wide, centred on where the camera
    # is heading, without the camera following.
    dead_zone: float = 0.25
    # A detection farther than half the dead-zone from where the face was last seen is a jump, which
    # counts once this many detections in a row have jumped the same way; a smooth move counts at once.
    confirmations: int = 3
    # The camera moves as a critically damped spring of this angular frequency (per second): 95% of
    # the way in about 4.7 / spring_rate seconds, never past the goal. It moves at most max_speed
    # crop widths a second.
    spring_rate: float = 10
    max_speed: float = 1.5


@dataclass(frozen=True)
class LlmChoice:
    """The LLM Selection runs on, as recorded with each Selection run and eval report."""

    provider: str
    model: str
    # Whether DeepSeek thinks before answering; None when the request doesn't say (Gemini, other hosts).
    thinking: bool | None = None

    def __str__(self) -> str:
        thinking = "" if self.thinking is None else f", thinking {'enabled' if self.thinking else 'disabled'}"
        return f"{self.provider} {self.model}{thinking}"


@dataclass(frozen=True)
class Settings:
    # "gemini", or "openai" for an OpenAI-compatible Chat Completions API at llm_base_url.
    llm_provider: str
    gemini_api_key: str | None = field(repr=False)
    gemini_model: str
    llm_base_url: str
    llm_api_key: str | None = field(repr=False)
    llm_model: str
    llm_thinking: bool
    whisper_model: str
    ffmpeg_bin: Path
    data_dir: Path
    ytdlp_cookies_from_browser: str | None
    selection_audio_signal: bool
    # Not read from the environment: the eval points it at the Reference Set it measures against.
    reference_set: Path = REFERENCE_SET
    transcription: TranscriptionTuning = TranscriptionTuning()
    selection: SelectionTuning = SelectionTuning()
    quota: QuotaTuning = QuotaTuning()
    render: RenderTuning = RenderTuning()
    preview: PreviewTuning = PreviewTuning()
    analysis: AnalysisTuning = AnalysisTuning()
    camera: CameraTuning = CameraTuning()
    # The disk endpoint warns when the data directory's volume has less free space than this.
    low_disk_bytes: int = 10 * 10**9
    # An upload is refused unless its volume keeps this much free once the file is stored: room for
    # its preview proxy (about 1 GB an hour), Clips and the Job's other files.
    upload_reserve_bytes: int = 2 * 10**9
    frontend_dir: Path = FRONTEND_DIST

    @property
    def ffprobe_bin(self) -> Path:
        return self.ffmpeg_bin.with_name("ffprobe")

    @property
    def llm(self) -> LlmChoice:
        if self.llm_provider == "gemini":
            return LlmChoice("gemini", self.gemini_model)
        return LlmChoice("openai", self.llm_model, self.llm_thinking if self.llm_name == "DeepSeek" else None)

    @property
    def llm_name(self) -> str:
        """The LLM's service as messages name it: Gemini, DeepSeek, or the host of LLM_BASE_URL."""
        if self.llm_provider == "gemini":
            return "Gemini"
        host = urlsplit(self.llm_base_url).hostname or self.llm_base_url
        return "DeepSeek" if host == DEEPSEEK_HOST else host


def load_settings(env_file: Path = ENV_FILE) -> Settings:
    """Read settings; environment variables win over `env_file`, empty values mean unset."""
    env = {**dotenv_values(env_file), **os.environ}

    def get(key: str, default: str = "") -> str:
        return (env.get(key) or "").strip() or default

    data_dir = Path(get("DATA_DIR", "data")).expanduser()
    if not data_dir.is_absolute():
        data_dir = REPO_ROOT / data_dir
    provider = get("LLM_PROVIDER", "gemini").lower()
    if provider not in REQUEST_INTERVAL_SECS:
        raise ValueError(f"LLM_PROVIDER must be gemini or openai, got {provider!r}")
    thinking = get("LLM_THINKING", "disabled").lower()
    if thinking not in _THINKING:
        raise ValueError(f"LLM_THINKING must be enabled or disabled, got {thinking!r}")
    interval = get("LLM_REQUEST_INTERVAL_SECS")

    return Settings(
        llm_provider=provider,
        gemini_api_key=get("GEMINI_API_KEY") or None,
        gemini_model=get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        llm_base_url=get("LLM_BASE_URL", DEFAULT_LLM_BASE_URL),
        llm_api_key=get("LLM_API_KEY") or None,
        llm_model=get("LLM_MODEL", DEFAULT_LLM_MODEL),
        llm_thinking=_THINKING[thinking],
        whisper_model=get("WHISPER_MODEL", DEFAULT_WHISPER_MODEL),
        ffmpeg_bin=Path(get("FFMPEG_BIN", DEFAULT_FFMPEG_BIN)).expanduser(),
        data_dir=data_dir,
        ytdlp_cookies_from_browser=get("YTDLP_COOKIES_FROM_BROWSER") or None,
        selection_audio_signal=_parse_bool("SELECTION_AUDIO_SIGNAL", get("SELECTION_AUDIO_SIGNAL", "false")),
        quota=QuotaTuning(
            request_interval_secs=_parse_secs("LLM_REQUEST_INTERVAL_SECS", interval)
            if interval
            else REQUEST_INTERVAL_SECS[provider]
        ),
    )


def _parse_bool(key: str, value: str) -> bool:
    if value.lower() in _TRUE:
        return True
    if value.lower() in _FALSE:
        return False
    raise ValueError(f"{key} must be true or false, got {value!r}")


def _parse_secs(key: str, value: str) -> float:
    try:
        if (secs := float(value)) >= 0:
            return secs
    except ValueError:
        pass
    raise ValueError(f"{key} must be a number of seconds, got {value!r}")
