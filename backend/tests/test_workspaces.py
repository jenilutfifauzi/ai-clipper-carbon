from dataclasses import replace
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import auth, main as main_module
from app.ports import Ports
from app.workspace import user_data_dir
from fakes import FakeLlm


@pytest.fixture
def authenticated_client(monkeypatch, settings, tmp_path):
    """A production-mode app with test Clerk claims and a cheap per-user port factory."""
    auth._clerk_options.cache_clear()
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / "unused-clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")

    def authenticate(request, options):
        authorization = request.headers.get("authorization", "")
        scheme, _, subject = authorization.partition(" ")
        if scheme.lower() != "bearer" or not subject:
            return SimpleNamespace(is_signed_in=False, payload={})
        return SimpleNamespace(is_signed_in=True, payload={"sub": subject})

    monkeypatch.setattr(auth, "authenticate_request", authenticate)
    base = replace(
        settings,
        data_dir=tmp_path / "shared-data",
        llm_api_key=None,
        gemini_api_key=None,
        llm_model="default-model",
        gemini_model="default-gemini",
        ytdlp_cookies_file=None,
    )
    monkeypatch.setattr(main_module, "load_settings", lambda: base)
    app = main_module.create_app(
        ports_factory=lambda _settings: Ports(None, None, FakeLlm()),
        test_mode=False,
    )
    with TestClient(app) as client:
        yield client, base
    auth._clerk_options.cache_clear()


def test_production_api_rejects_requests_without_a_clerk_session(authenticated_client):
    client, _ = authenticated_client

    assert not hasattr(client.app.state, "store")
    assert not hasattr(client.app.state, "settings")
    assert client.get("/api/settings").status_code == 401
    assert client.get("/api/profile").status_code == 401
    assert client.get("/media/no-such-job/source.mp4").status_code == 401


def test_settings_injection_cannot_disable_auth_without_explicit_test_mode(authenticated_client):
    _, base = authenticated_client

    with pytest.raises(ValueError, match="requires test_mode=True"):
        main_module.create_app(base, Ports(None, None, FakeLlm()), test_mode=False)


def test_production_mcp_tool_calls_require_clerk_and_use_the_authenticated_workspace(authenticated_client):
    client, _ = authenticated_client
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_jobs", "arguments": {}}}
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "Host": "127.0.0.1:8000",
    }

    denied = client.post("/mcp", json=request, headers=headers)
    assert denied.status_code == 200
    denied_data = next(json.loads(line.removeprefix("data: ")) for line in denied.text.splitlines() if line.startswith("data: "))
    assert denied_data["result"]["isError"] is True
    assert "Authentication required" in denied_data["result"]["content"][0]["text"]

    allowed = client.post("/mcp", json=request, headers=headers | {"Authorization": "Bearer user_test_A"})
    assert allowed.status_code == 200
    allowed_data = next(json.loads(line.removeprefix("data: ")) for line in allowed.text.splitlines() if line.startswith("data: "))
    assert allowed_data["result"]["isError"] is False
    assert json.loads(allowed_data["result"]["content"][0]["text"]) == {"jobs": []}


def test_accounts_get_private_workspaces_and_legacy_data_is_not_assigned(authenticated_client):
    client, base = authenticated_client
    legacy_settings = base.data_dir / "settings.json"
    legacy_settings.parent.mkdir(parents=True, exist_ok=True)
    legacy_bytes = b'{"llm_provider":"openai","llm_model":"legacy-model","llm_base_url":"https://legacy.invalid","llm_api_key":"legacy-secret"}'
    legacy_settings.write_bytes(legacy_bytes)

    account_a = {"Authorization": "Bearer user_test_A"}
    account_b = {"Authorization": "Bearer user_test_B"}

    initial_a = client.get("/api/settings", headers=account_a)
    initial_b = client.get("/api/settings", headers=account_b)
    assert initial_a.status_code == initial_b.status_code == 200
    assert initial_a.json()["model"] == "default-gemini"
    assert initial_b.json()["model"] == "default-gemini"
    assert "legacy-secret" not in initial_a.text + initial_b.text
    assert "legacy-model" not in initial_a.text + initial_b.text

    saved_a = client.put(
        "/api/settings",
        headers=account_a,
        json={"provider": "gemini", "model": "account-a-model", "api_key": "account-a-secret"},
    )
    assert saved_a.status_code == 200
    assert "account-a-secret" not in saved_a.text
    assert client.get("/api/settings", headers=account_a).json()["api_key_configured"] is True
    assert client.get("/api/settings", headers=account_b).json()["api_key_configured"] is False
    assert client.get("/api/settings", headers=account_b).json()["model"] == "default-gemini"

    assert client.get("/api/jobs", headers=account_a).json() == []
    assert client.get("/api/jobs", headers=account_b).json() == []
    assert client.get("/api/media", headers=account_a).json() == []
    assert client.get("/api/media", headers=account_b).json() == []

    profile_a = client.put(
        "/api/profile",
        headers=account_a,
        json={"niche": "A only", "audience": "", "clip_style": "", "avoid": ""},
    )
    assert profile_a.status_code == 200
    assert client.get("/api/profile", headers=account_a).json()["niche"] == "A only"
    assert client.get("/api/profile", headers=account_b).json()["niche"] == ""

    path_a = user_data_dir(base.data_dir, "user_test_A")
    path_b = user_data_dir(base.data_dir, "user_test_B")
    assert path_a != path_b
    assert (path_a / "settings.json").is_file()
    assert not (path_b / "settings.json").exists()
    assert legacy_settings.read_bytes() == legacy_bytes
    assert legacy_settings.stat().st_mode & 0o777 == 0o644
    assert (base.data_dir / "users").stat().st_mode & 0o777 == 0o700


def test_user_workspace_path_does_not_expose_or_interpret_the_subject(tmp_path):
    root = tmp_path / "data"
    safe = user_data_dir(root, "../../outside/identifier")

    assert safe.parent == root / "users"
    assert "outside" not in str(safe)
    assert "identifier" not in str(safe)
    assert len(safe.name) == 64
