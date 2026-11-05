from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import auth


@pytest.fixture(autouse=True)
def clear_clerk_options_cache():
    auth._clerk_options.cache_clear()
    yield
    auth._clerk_options.cache_clear()


def request_without_credentials() -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/jobs",
            "raw_path": b"/api/jobs",
            "query_string": b"",
            "headers": [],
            "server": ("localhost", 8000),
            "client": ("localhost", 50000),
        }
    )


def test_auth_fails_closed_when_clerk_is_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / ".clerk.env")
    monkeypatch.delenv("CLERK_SECRET_KEY", raising=False)

    with pytest.raises(HTTPException) as exc:
        auth.require_auth(request_without_credentials())

    assert exc.value.status_code == 503
    assert exc.value.detail == "Authentication is not configured"


def test_auth_rejects_unsigned_in_session(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / ".clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")
    captured = {}

    def reject_session(request, options):
        captured["options"] = options
        return SimpleNamespace(is_signed_in=False)

    monkeypatch.setattr(auth, "authenticate_request", reject_session)

    with pytest.raises(HTTPException) as exc:
        auth.require_auth(request_without_credentials())

    assert exc.value.status_code == 401
    assert captured["options"].accepts_token == ["session_token"]
    assert captured["options"].authorized_parties == list(auth.DEFAULT_AUTHORIZED_PARTIES)
    assert "https://ai-clipper.sistems.web.id" in captured["options"].authorized_parties


def test_auth_accepts_a_valid_session_token_from_the_production_origin(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / ".clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    monkeypatch.setenv("CLERK_JWT_KEY", public_key)
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)
    auth._clerk_options.cache_clear()

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": "user_test",
            "sid": "sess_test",
            "azp": "https://ai-clipper.sistems.web.id",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + timedelta(minutes=2),
        },
        private_key,
        algorithm="RS256",
    )
    app = FastAPI()

    @app.get("/api/jobs")
    def list_jobs(request: Request, _auth=Depends(auth.require_auth)):
        return {"user_id": request.state.clerk_user_id}

    with TestClient(app) as client:
        response = client.get("/api/jobs", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": "user_test"}


def test_auth_returns_verified_session_state(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / ".clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")
    session = SimpleNamespace(is_signed_in=True, payload={"sub": "user_test"})
    monkeypatch.setattr(auth, "authenticate_request", lambda request, options: session)
    request = request_without_credentials()

    assert auth.require_auth(request) is session
    assert request.state.clerk_user_id == "user_test"


def test_auth_rejects_signed_in_session_without_a_user_subject(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "CLERK_ENV_FILE", tmp_path / ".clerk.env")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(auth, "authenticate_request", lambda request, options: SimpleNamespace(is_signed_in=True, payload={}))

    with pytest.raises(HTTPException) as exc:
        auth.require_auth(request_without_credentials())

    assert exc.value.status_code == 401
    assert "no valid user identity" in exc.value.detail
