from pathlib import Path

import pytest
from dotenv import dotenv_values

from app.config import REPO_ROOT, LlmChoice, load_settings

KEYS = (
    "LLM_PROVIDER",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_THINKING",
    "LLM_REQUEST_INTERVAL_SECS",
    "WHISPER_MODEL",
    "FFMPEG_BIN",
    "DATA_DIR",
    "YTDLP_COOKIES_FROM_BROWSER",
    "SELECTION_AUDIO_SIGNAL",
    "TTS_GEMINI_MODEL",
    "TTS_BASE_URL",
    "TTS_API_KEY",
    "TTS_MODEL",
    "TTS_VOICES",
    "TTS_STYLE",
)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults_without_env_file(tmp_path):
    settings = load_settings(env_file=tmp_path / ".env")

    assert settings.llm_provider == "gemini"
    assert settings.gemini_api_key is None
    assert settings.gemini_model == "gemini-3.8-flash"
    assert settings.llm_base_url == "https://api.deepseek.com"
    assert settings.llm_api_key is None
    assert settings.llm_model == "deepseek-flash"
    assert settings.llm_thinking is False
    assert settings.quota.request_interval_secs == 13
    assert settings.llm == LlmChoice("gemini", "gemini-3.8-flash")
    assert settings.whisper_model == "mlx-community/whisper-large-v3-turbo"
    assert settings.ffmpeg_bin == Path("/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg")
    assert settings.ffprobe_bin == Path("/opt/homebrew/opt/ffmpeg-full/bin/ffprobe")
    assert settings.data_dir == REPO_ROOT / "data"
    assert settings.ytdlp_cookies_from_browser is None
    assert settings.selection_audio_signal is False
    assert settings.tts_gemini_model == "gemini-3.8-flash-lite-tts"
    assert (settings.tts_base_url, settings.tts_api_key, settings.tts_model, settings.tts_voices) == (None, None, None, ())
    assert settings.tts_style is None


def test_env_file_is_read_and_environment_wins(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "GEMINI_API_KEY=secret\n"
        "GEMINI_MODEL=from-file\n"
        "FFMPEG_BIN=/usr/local/bin/ffmpeg\n"
        "DATA_DIR=/tmp/clips\n"
        "YTDLP_COOKIES_FROM_BROWSER=safari\n"
        "SELECTION_AUDIO_SIGNAL=true\n"
    )
    monkeypatch.setenv("GEMINI_MODEL", "from-environment")

    settings = load_settings(env_file=env_file)

    assert settings.gemini_api_key == "secret"
    assert settings.gemini_model == "from-environment"
    assert settings.ffprobe_bin == Path("/usr/local/bin/ffprobe")
    assert settings.data_dir == Path("/tmp/clips")
    assert settings.ytdlp_cookies_from_browser == "safari"
    assert settings.selection_audio_signal is True


def test_the_openai_provider_is_read_with_its_own_key_and_a_short_request_interval(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_PROVIDER=openai\nLLM_API_KEY=sk-secret\nGEMINI_API_KEY=gemini-secret\nLLM_THINKING=enabled\n")

    settings = load_settings(env_file=env_file)

    assert (settings.llm_provider, settings.llm_api_key, settings.llm_thinking) == ("openai", "sk-secret", True)
    assert settings.quota.request_interval_secs == 1
    assert settings.llm == LlmChoice("openai", "deepseek-flash", thinking=True)
    assert settings.llm_name == "DeepSeek"
    assert "secret" not in repr(settings)

    # Another OpenAI-compatible host isn't sent DeepSeek's thinking parameter, so none is recorded.
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("LLM_MODEL", "gpt-6-mini")
    settings = load_settings(env_file=env_file)
    assert (settings.llm, settings.llm_name) == (LlmChoice("openai", "gpt-6-mini"), "api.openai.com")


def test_the_openai_compatible_speech_settings_are_read_apart_from_the_llms(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LLM_PROVIDER=openai\nLLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=sk-llm\n"
        "TTS_BASE_URL=https://api.openai.com/v1/\nTTS_API_KEY=sk-speech\nTTS_MODEL=gpt-4o-mini-tts\n"
        "TTS_VOICES= coral, ,onyx \n"
    )

    settings = load_settings(env_file=env_file)

    assert (settings.tts_base_url, settings.tts_api_key, settings.tts_model) == ("https://api.openai.com/v1", "sk-speech", "gpt-4o-mini-tts")
    assert settings.tts_voices == ("coral", "onyx")
    assert settings.tts_style is None
    assert "sk-speech" not in repr(settings)
    # The LLM's settings are its own.
    assert (settings.llm_base_url, settings.llm_api_key, settings.llm_name) == ("https://api.deepseek.com", "sk-llm", "DeepSeek")


def test_the_request_interval_can_be_set(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_REQUEST_INTERVAL_SECS", "0")

    assert load_settings(env_file=tmp_path / ".env").quota.request_interval_secs == 0


def test_relative_data_dir_resolves_against_repo_root(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", "scratch/jobs")

    assert load_settings(env_file=tmp_path / ".env").data_dir == REPO_ROOT / "scratch" / "jobs"


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("SELECTION_AUDIO_SIGNAL", "sometimes"),
        ("LLM_PROVIDER", "deepseek"),
        ("LLM_THINKING", "true"),
        ("LLM_REQUEST_INTERVAL_SECS", "soon"),
        ("LLM_REQUEST_INTERVAL_SECS", "-1"),
    ],
)
def test_invalid_values_are_rejected(tmp_path, monkeypatch, key, value):
    monkeypatch.setenv(key, value)

    with pytest.raises(ValueError, match=key):
        load_settings(env_file=tmp_path / ".env")


def test_env_example_lists_every_key_with_the_defaults(tmp_path):
    example = REPO_ROOT / ".env.example"

    assert set(dotenv_values(example)) == set(KEYS)
    assert load_settings(env_file=example) == load_settings(env_file=tmp_path / ".env")


@pytest.mark.parametrize(("value", "style"), [("true", True), ("off", False), ("", None)])
def test_tts_style_is_read_as_a_switch_empty_meaning_by_the_model(tmp_path, value, style):
    env_file = tmp_path / ".env"
    env_file.write_text(f"TTS_STYLE={value}\n")
    assert load_settings(env_file=env_file).tts_style is style


def test_a_tts_style_that_isnt_a_switch_is_refused(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("TTS_STYLE=sometimes\n")
    with pytest.raises(ValueError, match="TTS_STYLE must be true or false"):
        load_settings(env_file=env_file)
