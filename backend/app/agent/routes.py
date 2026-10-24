"""The Agent's HTTP routes, under /api/agent. Included from `create_app`."""

import asyncio

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.agent.credentials import SavedCredential, credential_for, delete_credential, save_credential
from app.agent.providers import (
    PROVIDERS,
    AcpProvider,
    ApiProvider,
    DetectionCache,
    ProviderListing,
    api_status,
    provider_by_id,
)
from app.config import Settings

router = APIRouter(prefix="/api/agent")


class CredentialUpdate(BaseModel):
    """What the setup form saves; a field left out keeps what was saved."""

    api_key: str | None = Field(default=None, min_length=1, repr=False)
    base_url: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)


@router.get("/providers")
async def list_providers(request: Request) -> list[ProviderListing]:
    settings = _settings(request)
    detection = _detection(request)
    acp = [provider for provider in PROVIDERS if isinstance(provider, AcpProvider)]
    acp_statuses = dict(zip([p.id for p in acp], await asyncio.gather(*(detection.status(p) for p in acp))))
    return [
        ProviderListing(
            provider=provider,
            status=acp_statuses[provider.id]
            if isinstance(provider, AcpProvider)
            else api_status(provider, credential_for(settings, provider.id)),
        )
        for provider in PROVIDERS
    ]


@router.put("/credentials/{provider_id}")
async def put_credential(provider_id: str, update: CredentialUpdate, request: Request) -> ProviderListing:
    provider = _api_provider(provider_id)
    if update.base_url and not provider.base_url_editable:
        raise HTTPException(400, f"{provider.label}'s base URL can't be changed")
    settings = _settings(request)
    await asyncio.to_thread(save_credential, settings, provider.id, SavedCredential(**update.model_dump(exclude_unset=True)))
    return ProviderListing(provider=provider, status=api_status(provider, credential_for(settings, provider.id)))


@router.delete("/credentials/{provider_id}", status_code=204)
async def remove_credential(provider_id: str, request: Request) -> Response:
    provider = _api_provider(provider_id)
    await asyncio.to_thread(delete_credential, _settings(request), provider.id)
    return Response(status_code=204)


def _api_provider(provider_id: str) -> ApiProvider:
    provider = provider_by_id(provider_id)
    if provider is None:
        raise HTTPException(404, f"No Agent Provider {provider_id!r}")
    if not isinstance(provider, ApiProvider):
        raise HTTPException(400, f"{provider.label} signs in with its own login, not a key")
    return provider


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _detection(request: Request) -> DetectionCache:
    """One per app, made on first use."""
    state = request.app.state
    if getattr(state, "agent_detection", None) is None:
        state.agent_detection = DetectionCache()
    return state.agent_detection
