"""Agent Providers (app/agent/): the catalog, saved keys, and whether each is ready."""

import stat
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ports import Ports
from fakes import FakeLlm

ACP_IDS = ["claude-code", "codex", "gemini-cli", "antigravity"]
API_IDS = ["deepseek", "openai-compatible", "anthropic", "gemini"]
SECRET = "sk-test-not-to-be-seen"


@pytest.fixture
def agent_settings(settings):
    """No key from .env, whatever it holds: each test says which it has."""
    return replace(settings, llm_api_key=None, gemini_api_key=None, anthropic_api_key=None)


def make_client(settings) -> TestClient:
    return TestClient(create_app(settings, Ports(None, None, FakeLlm())))


@pytest.fixture
def client(agent_settings):
    with make_client(agent_settings) as client:
        yield client


def listing(client) -> dict[str, dict]:
    response = client.get("/api/agent/providers")
    assert response.status_code == 200
    return {entry["provider"]["id"]: entry for entry in response.json()}


def test_the_catalog_lists_the_eight_providers(client):
    providers = listing(client)

    assert list(providers) == ACP_IDS + API_IDS
    assert {providers[id]["provider"]["kind"] for id in ACP_IDS} == {"acp"}
    assert {providers[id]["provider"]["kind"] for id in API_IDS} == {"api"}
    deepseek = providers["deepseek"]["provider"]
    assert deepseek["base_url"] == "https://api.deepseek.com"
    assert deepseek["models"] == ["deepseek-chat", "deepseek-reasoner"]
    assert providers["antigravity"]["provider"]["warning"]
    assert providers["claude-code"]["provider"]["warning"] is None


def test_a_saved_deepseek_key_makes_it_ready_and_is_never_sent_back(client):
    assert listing(client)["deepseek"]["status"]["ready"] is False

    saved = client.put("/api/agent/credentials/deepseek", json={"api_key": SECRET, "model": "deepseek-reasoner"})

    assert saved.status_code == 200
    assert SECRET not in saved.text
    assert SECRET not in client.get("/api/agent/providers").text
    status = listing(client)["deepseek"]["status"]
    assert status["ready"] is True
    assert status["has_key"] is True
    assert status["key_source"] == "saved"
    assert status["model"] == "deepseek-reasoner"


def test_deleting_the_deepseek_key_falls_back_to_llm_api_key_when_llm_base_url_is_deepseeks(agent_settings):
    settings = replace(agent_settings, llm_api_key="sk-from-env", llm_base_url="https://api.deepseek.com")
    with make_client(settings) as client:
        client.put("/api/agent/credentials/deepseek", json={"api_key": SECRET})
        assert listing(client)["deepseek"]["status"]["key_source"] == "saved"

        assert client.delete("/api/agent/credentials/deepseek").status_code == 204

        providers = listing(client)
        assert providers["deepseek"]["status"]["ready"] is True
        assert providers["deepseek"]["status"]["key_source"] == "env"
        # LLM_API_KEY is DeepSeek's here, not the OpenAI-compatible provider's.
        assert providers["openai-compatible"]["status"]["ready"] is False
        assert "sk-from-env" not in client.get("/api/agent/providers").text


def test_llm_api_key_belongs_to_the_openai_compatible_provider_when_llm_base_url_points_elsewhere(agent_settings):
    settings = replace(agent_settings, llm_api_key="sk-from-env", llm_base_url="https://api.openai.com/v1")
    with make_client(settings) as client:
        providers = listing(client)

    assert providers["deepseek"]["status"]["ready"] is False
    assert providers["openai-compatible"]["status"]["ready"] is True
    assert providers["openai-compatible"]["status"]["base_url"] == "https://api.openai.com/v1"


def test_the_credentials_file_is_readable_by_the_owner_only(client, agent_settings):
    client.put("/api/agent/credentials/anthropic", json={"api_key": SECRET})

    path = agent_settings.data_dir / "agent" / "credentials.json"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_a_base_url_is_saved_only_where_it_may_be_changed(client):
    refused = client.put("/api/agent/credentials/deepseek", json={"base_url": "https://example.com"})
    assert refused.status_code == 400

    saved = client.put(
        "/api/agent/credentials/openai-compatible",
        json={"api_key": SECRET, "base_url": "https://llm.example.com/v1", "model": "some-model"},
    )
    assert saved.status_code == 200
    status = listing(client)["openai-compatible"]["status"]
    assert status["base_url"] == "https://llm.example.com/v1"
    assert status["model"] == "some-model"


def test_credentials_are_refused_for_an_unknown_or_an_acp_provider(client):
    assert client.put("/api/agent/credentials/nope", json={"api_key": SECRET}).status_code == 404
    assert client.delete("/api/agent/credentials/nope").status_code == 404
    assert client.put("/api/agent/credentials/claude-code", json={"api_key": SECRET}).status_code == 400


def test_an_acp_provider_without_its_command_or_npx_is_not_installed(client, tmp_path, monkeypatch):
    empty = tmp_path / "empty-bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))

    claude = listing(client)["claude-code"]

    assert claude["status"]["installed"] is False
    assert claude["status"]["ready"] is False
    assert claude["status"]["command"] is None
    assert claude["status"]["login"] == "unknown"
    assert "claude-agent-acp" in claude["provider"]["install_hint"]


def fake_binary(folder, name: str, output: str = "") -> None:
    path = folder / name
    path.write_text(f"#!/bin/sh\necho '{output}'\n")
    path.chmod(0o755)


def test_an_acp_provider_prefers_its_installed_adapter_and_falls_back_to_npx(client, tmp_path, monkeypatch):
    folder = tmp_path / "bin"
    folder.mkdir()
    fake_binary(folder, "claude-agent-acp", "claude-agent-acp 1.2.3")
    fake_binary(folder, "npx")
    monkeypatch.setenv("PATH", str(folder))

    providers = listing(client)

    claude = providers["claude-code"]["status"]
    assert claude["installed"] is True
    assert claude["command"] == ["claude-agent-acp"]
    assert claude["version"] == "claude-agent-acp 1.2.3"
    codex = providers["codex"]["status"]
    assert codex["installed"] is True
    assert codex["command"] == ["npx", "-y", providers["codex"]["provider"]["npx_package"]]
    # Gemini CLI has no npx fallback.
    assert providers["gemini-cli"]["status"]["installed"] is False


def test_detection_is_cached(client, tmp_path, monkeypatch):
    empty = tmp_path / "empty-bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    assert listing(client)["antigravity"]["status"]["installed"] is False

    fake_binary(empty, "agy_acp_server")

    assert listing(client)["antigravity"]["status"]["installed"] is False
