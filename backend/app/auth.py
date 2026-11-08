"""Clerk session authentication for the app's HTTP API."""

import os
from contextlib import contextmanager
from contextvars import ContextVar, Token
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Iterator

from clerk_backend_api import AuthenticateRequestOptions, authenticate_request
from dotenv import dotenv_values
from fastapi import HTTPException, Request

REPO_ROOT = Path(__file__).resolve().parents[2]
CLERK_ENV_FILE = REPO_ROOT / ".clerk.env"
DEFAULT_AUTHORIZED_PARTIES = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://ai-clipper.sistems.web.id",
)
_trusted_internal_user: ContextVar[str | None] = ContextVar("trusted_internal_user", default=None)


@contextmanager
def internal_user_context(user_id: str) -> Iterator[None]:
    """Carry an already-verified identity through an in-process MCP-to-API call."""
    token: Token[str | None] = _trusted_internal_user.set(user_id)
    try:
        yield
    finally:
        _trusted_internal_user.reset(token)


def current_internal_user() -> str | None:
    """The identity bound to a trusted in-process MCP call, if one is active."""
    return _trusted_internal_user.get()


@lru_cache(maxsize=1)
def _clerk_options() -> AuthenticateRequestOptions | None:
    """Load Clerk credentials privately; no secret is returned to a response or client."""
    values = {**dotenv_values(CLERK_ENV_FILE), **os.environ}
    secret_key = str(values.get("CLERK_SECRET_KEY") or "").strip()
    if not secret_key:
        return None

    authorized_parties_value = str(values.get("CLERK_AUTHORIZED_PARTIES") or "")
    authorized_parties = [part.strip() for part in authorized_parties_value.split(",") if part.strip()]
    if not authorized_parties:
        authorized_parties = list(DEFAULT_AUTHORIZED_PARTIES)

    jwt_key = str(values.get("CLERK_JWT_KEY") or "").strip() or None
    return AuthenticateRequestOptions(
        secret_key=secret_key,
        jwt_key=jwt_key,
        authorized_parties=authorized_parties,
        accepts_token=["session_token"],
    )


def _session_cookies(request: Request) -> list[str]:
    """The Clerk session cookies of a request without a bearer token (a <video> or <img> can't send
    one), each to be tried: `__session` and the `__session_<suffix>` of every Clerk instance that has
    set one on this host. Read with Starlette's parser, since Clerk's (SimpleCookie) stops at the first
    cookie it can't parse, which other apps on localhost leave, and takes only the first it finds."""
    if request.headers.get("authorization"):
        return []
    return [value for name, value in request.cookies.items() if name.startswith("__session") and value]


def require_auth(request: Request):
    """Reject unauthenticated API requests; accepts Clerk's bearer token or same-origin session cookie."""
    internal_user_id = _trusted_internal_user.get()
    if internal_user_id:
        request.state.clerk_user_id = internal_user_id
        return SimpleNamespace(is_signed_in=True, payload={"sub": internal_user_id})

    options = _clerk_options()
    if options is None:
        raise HTTPException(status_code=503, detail="Authentication is not configured")

    for each in [SimpleNamespace(headers={"Authorization": f"Bearer {token}"}) for token in _session_cookies(request)] or [request]:
        state = authenticate_request(each, options)
        if state.is_signed_in:
            break
    if not state.is_signed_in:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = getattr(state, "payload", None)
    user_id = payload.get("sub") if isinstance(payload, dict) else getattr(payload, "sub", None)
    user_id = user_id or getattr(state, "user_id", None)
    if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > 256:
        raise HTTPException(status_code=401, detail="Authenticated session has no valid user identity")
    request.state.clerk_user_id = user_id.strip()
    return state
