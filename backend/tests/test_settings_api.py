import stat
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ports import Ports
from app.video_source import YtDlpVideoSource
from fakes import FakeLlm

SECRET = "sk-settings-test-secret"
COOKIE = (
    b"# Netscape HTTP Cookie File\n"
    b".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tprivate-cookie-value\n"
)


@pytest.fixture

def app_settings(settings):
    return replace(
        settings,
        llm_provider="gemini",
        llm_api_key=None,
        gemini_api_key=None,
        llm_base_url="https://api.deepseek.com",
        llm_model="deepseek-flash",
        gemini_model="gemini-3.8-flash",
    )


@pytest.fixture

def client(app_settings):
    with TestClient(create_app(app_settings, Ports(None, None, FakeLlm()))) as client:
        yield client


def test_settings_api_never_returns_saved_api_keys(client, app_settings):
    assert client.get("/api/settings").json()["api_key_configured"] is False

    response = client.put(
        "/api/settings",
        json={"provider": "gemini", "model": "gemini-3.8-flash", "api_key": SECRET},
    )
    assert response.status_code == 200
    assert SECRET not in response.text
    assert client.get("/api/settings").json()["api_key_configured"] is True
    assert app_settings.gemini_api_key == SECRET

    path = app_settings.data_dir / "settings.json"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_openai_compatible_settings_update_live_and_persist(client, app_settings):
    response = client.put(
        "/api/settings",
        json={
            "provider": "openai-compatible",
            "model": "deepseek-reasoner",
            "base_url": "https://api.deepseek.com/",
            "api_key": SECRET,
            "thinking": True,
        },
    )
    assert response.status_code == 200
    assert SECRET not in response.text
    assert response.json() == {
        "provider": "openai-compatible",
        "model": "deepseek-reasoner",
        "base_url": "https://api.deepseek.com",
        "thinking": True,
        "api_key_configured": True,
        "youtube_cookies_uploaded": False,
    }
    assert app_settings.llm_provider == "openai"
    assert app_settings.llm_api_key == SECRET

    restarted_settings = replace(app_settings, llm_api_key=None, gemini_api_key=None)
    restarted = create_app(restarted_settings, Ports(None, None, FakeLlm()))
    with TestClient(restarted) as again:
        saved = again.get("/api/settings").json()
        assert saved["provider"] == "openai-compatible"
        assert saved["model"] == "deepseek-reasoner"
        assert saved["api_key_configured"] is True
        assert SECRET not in again.get("/api/settings").text


def test_cookie_upload_is_validated_private_and_used_for_future_youtube_downloads(client, app_settings):
    response = client.post(
        "/api/settings/youtube-cookies",
        files={"file": ("cookies.txt", COOKIE, "text/plain")},
    )
    assert response.status_code == 200
    assert response.json()["youtube_cookies_uploaded"] is True
    assert b"private-cookie-value" not in response.content

    path = app_settings.data_dir / "youtube" / "cookies.txt"
    assert path.read_bytes() == COOKIE
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert YtDlpVideoSource(app_settings)._options("en", app_settings.data_dir)["cookiefile"] == str(path)

    assert client.delete("/api/settings/youtube-cookies").status_code == 204
    assert not path.exists()
    assert app_settings.ytdlp_cookies_file is None
    assert client.get("/api/settings").json()["youtube_cookies_uploaded"] is False


def test_cookie_upload_rejects_non_netscape_or_non_youtube_files(client, app_settings):
    response = client.post(
        "/api/settings/youtube-cookies",
        files={"file": ("cookies.txt", b"not a cookie file", "text/plain")},
    )
    assert response.status_code == 422
    assert not (app_settings.data_dir / "youtube" / "cookies.txt").exists()

    response = client.post(
        "/api/settings/youtube-cookies",
        files={"file": ("cookies.csv", COOKIE, "text/plain")},
    )
    assert response.status_code == 422


def test_openai_settings_reject_invalid_or_credential_bearing_urls(client):
    missing = client.put("/api/settings", json={"provider": "openai-compatible", "model": "custom"})
    assert missing.status_code == 422
    unsafe = client.put(
        "/api/settings",
        json={"provider": "openai-compatible", "model": "custom", "base_url": "https://user:pass@example.com"},
    )
    assert unsafe.status_code == 422
