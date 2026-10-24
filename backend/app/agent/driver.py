"""What runs one Agent Turn for an Agent Provider, whatever it speaks: a driver is handed a
`TurnContext` and yields the turn's `AgentEvent`s, ending with `turn_finished`. The API tool loop
(api_loop.py) is one; the ACP client is another. The session (sessions.py) publishes what it yields,
adds the Revisions saved, and ends the turn itself when it is cancelled or fails."""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

import httpx
import httpx2
from fastapi import FastAPI
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel

from app.agent.credentials import Credential
from app.agent.events import AgentEvent
from app.agent.providers import AcpProvider, ApiProvider

# Where the scoped MCP server answers. Its routes take localhost only, so this is also the Host sent.
SCOPED_MCP_ORIGIN = "http://127.0.0.1:8000"
SCOPED_MCP_PATH = "/mcp/agent"


class ChatMessage(BaseModel):
    """An earlier turn's words: the owner's prompt, or what the Agent answered."""

    role: Literal["user", "assistant"]
    text: str


@dataclass(frozen=True)
class ScopedEndpoint:
    """The scoped MCP server as one Agent Session reaches it: with its bearer token."""

    app: FastAPI
    token: str

    @property
    def url(self) -> str:
        return SCOPED_MCP_ORIGIN + SCOPED_MCP_PATH

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[Client]:
        """An MCP client of the scoped server, over streamable HTTP into the app in-process: the
        server reads the token from the request's headers, which an in-memory client has none of."""
        transport = httpx2.ASGITransport(app=self.app)
        async with httpx2.AsyncClient(transport=transport, base_url=SCOPED_MCP_ORIGIN, headers=self.headers) as http:
            async with Client(streamable_http_client(self.url, http_client=http)) as client:
                yield client


@dataclass(frozen=True)
class TurnContext:
    turn: str
    provider: ApiProvider | AcpProvider
    model: str | None
    # An API provider's key, base URL and model; None for an ACP agent.
    credential: Credential | None
    system: str
    # Earlier turns' words, oldest first.
    history: list[ChatMessage]
    prompt: str
    tools: ScopedEndpoint
    # What an API provider is called through: None, the network (tests pass a fake).
    http_transport: httpx.AsyncBaseTransport | None = None


Driver = Callable[[TurnContext], AsyncIterator[AgentEvent]]
