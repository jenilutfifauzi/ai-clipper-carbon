import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse

from app import api
from app.agent import routes as agent_routes
from app.agent.scope import ScopeRegistry
from app.auth import require_auth
from app.config import Settings, load_settings
from app.mcp_server import build_mcp
from app.ports import Ports, real_ports
from app.settings_api import router as settings_router
from app.workspace import UserWorkspace, WorkspaceRegistry, bind_workspace


def create_app(
    settings: Settings | None = None,
    ports: Ports | None = None,
    *,
    ports_factory: Callable[[Settings], Ports] | None = None,
    test_mode: bool | None = None,
) -> FastAPI:
    """Create the app. Production requests get a private workspace selected by verified Clerk subject.

    Only `test_mode=True` allows explicit Settings/Ports injection and disables Clerk dependencies.
    The test suite opts into this through its own bootstrap; production callers cannot disable auth merely
    by supplying a Settings object.
    """
    if test_mode is None:
        test_mode = os.environ.get("AI_CLIPPER_TEST_MODE") == "1"
    if test_mode:
        if settings is None:
            raise ValueError("test_mode requires explicit Settings")
        if ports_factory is not None:
            raise ValueError("Use injected Ports or a per-user ports_factory, not both")
    elif settings is not None or ports is not None:
        raise ValueError("Explicit Settings/Ports injection requires test_mode=True")

    settings = settings or load_settings()
    auth_dependencies = [Depends(bind_workspace)] if test_mode else [Depends(require_auth), Depends(bind_workspace)]

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The MCP servers are app-wide, while their tool calls resolve an account workspace from
        # authenticated context. Jobs and Agent sessions themselves are owned by each workspace.
        async with app.state.mcp.session_manager.run(), app.state.agent_mcp.session_manager.run():
            if app.state.default_workspace is not None:
                app.state.default_workspace.start()
            else:
                app.state.workspace_registry.start()
            try:
                yield
            finally:
                if app.state.default_workspace is not None:
                    await app.state.default_workspace.stop()
                else:
                    await app.state.workspace_registry.stop()

    app = FastAPI(title="AI Clipper", lifespan=lifespan)
    app.state.default_workspace = None
    app.state.workspace_registry = None
    app.state.agent_scopes = ScopeRegistry()

    app.include_router(api.router, dependencies=auth_dependencies)
    app.include_router(api.media, dependencies=auth_dependencies)
    app.include_router(settings_router, dependencies=auth_dependencies)
    app.include_router(agent_routes.router, dependencies=auth_dependencies)
    app.include_router(agent_routes.candidate_router, dependencies=auth_dependencies)

    # The MCP server at /mcp (streamable HTTP). Its tool calls require Clerk auth; API calls made
    # in-process by a tool inherit that verified identity through a task-local context.
    app.state.mcp = build_mcp(app, authenticated=not test_mode)
    app.router.routes.extend(app.state.mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True).routes)
    # The Agent's /mcp/agent tools additionally require an unguessable, user-bound Candidate scope.
    app.state.agent_mcp = build_mcp(app, scoped=True)
    app.router.routes.extend(app.state.agent_mcp.streamable_http_app(streamable_http_path="/mcp/agent", stateless_http=True).routes)

    if test_mode:
        app.state.default_workspace = UserWorkspace(
            settings,
            app,
            app.state.agent_scopes,
            # This factory path exists only for explicit isolated test injection, not production auth.
            user_id="test-injected-workspace",
            ports=ports,
        )
        # Preserve the old single-workspace test helpers without adding these shared aliases to production.
        for name in (
            "settings",
            "settings_store",
            "store",
            "worker",
            "profiles",
            "presets",
            "text_presets",
            "export_presets",
            "templates",
            "starred",
            "logos",
            "media",
            "narrations",
            "kokoro",
            "person_model",
            "mattes",
            "media_words",
            "looks",
            "faces",
            "agent_sessions",
            "agent_detection",
        ):
            setattr(app.state, name, getattr(app.state.default_workspace, name))
    else:
        app.state.workspace_registry = WorkspaceRegistry(
            settings,
            app,
            app.state.agent_scopes,
            ports_factory=ports_factory or real_ports,
        )

    if (settings.frontend_dir / "index.html").is_file():
        _serve_frontend(app, settings.frontend_dir)
    return app


def _serve_frontend(app: FastAPI, dist: Path) -> None:
    """Serve built assets and client-side routes; unknown API, media and MCP paths stay 404."""
    dist = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path.split("/", 1)[0] in {"api", "media", "mcp"}:
            raise HTTPException(404)
        file = (dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(dist):
            return FileResponse(file)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
