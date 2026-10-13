from pathlib import Path

import pytest
from dotenv import dotenv_values

from app.config import REPO_ROOT, load_settings

KEYS = (
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "WHISPER_MODEL",
    "FFMPEG_BIN",
    "DATA_DIR",
    "YTDLP_COOKIES_FROM_BROWSER",
    "SELECTION_AUDIO_SIGNAL",
)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults_without_env_file(tmp_path):
    settings = load_settings(env_file=tmp_path / ".env")

    assert settings.gemini_api_key is None
    assert settings.gemini_model == "gemini-3.8-flash"
    assert settings.whisper_model == "mlx-community/whisper-large-v3-turbo"
    assert settings.ffmpeg_bin == Path("/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg")
    assert settings.ffprobe_bin == Path("/opt/homebrew/opt/ffmpeg-full/bin/ffprobe")
    assert settings.data_dir == REPO_ROOT / "data"
    assert settings.ytdlp_cookies_from_browser is None
    assert settings.selection_audio_signal is False


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


def test_relative_data_dir_resolves_against_repo_root(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", "scratch/jobs")

    assert load_settings(env_file=tmp_path / ".env").data_dir == REPO_ROOT / "scratch" / "jobs"


def test_invalid_audio_signal_flag_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTION_AUDIO_SIGNAL", "sometimes")

    with pytest.raises(ValueError, match="SELECTION_AUDIO_SIGNAL"):
        load_settings(env_file=tmp_path / ".env")


def test_env_example_lists_every_key_with_the_defaults(tmp_path):
    example = REPO_ROOT / ".env.example"

    assert set(dotenv_values(example)) == set(KEYS)
    assert load_settings(env_file=example) == load_settings(env_file=tmp_path / ".env")
