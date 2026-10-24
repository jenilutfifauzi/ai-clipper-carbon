import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from app import api, fonts, looks
from app.agent import routes as agent_routes
from app.agent.scope import ScopeRegistry
from app.config import Settings, load_settings
from app.jobs import JobStore
from app.kokoro import KokoroSpeech
from app.logos import LOGOS_DIR, LogoStore
from app.matte import MatteRunner
from app.mcp_server import build_mcp
from app.media import MEDIA_DIR, MediaStore
from app.media_words import MediaWordsStore
from app.narration import NARRATIONS_DIR, VOICE_SAMPLES_DIR, NarrationRunner
from app.pipeline import Pipeline
from app.ports import Ports, real_ports
from app.profile import PROFILE_FILE, ProfileStore
from app.rendering import Renders
from app.starred_effects import STARRED_FILE, StarredStore
from app.styles import PRESETS_FILE, PresetStore
from app.text_presets import TEXT_PRESETS_FILE, TextPresetStore
from app.templates import TEMPLATES_FILE, TemplateStore
from app.uploads import UPLOADS_DIR
from app.worker import Worker


def create_app(settings: Settings | None = None, ports: Ports | None = None) -> FastAPI:
    """The app, wired to `ports` (the real ones by default). Run with `uvicorn --factory app.main:create_app`."""
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # What is there is left from uploads cut short when the app last stopped: none was complete.
    shutil.rmtree(settings.data_dir / UPLOADS_DIR, ignore_errors=True)
    # And from Narrations being made: none was added.
    shutil.rmtree(settings.data_dir / NARRATIONS_DIR, ignore_errors=True)
    media = MediaStore(settings.data_dir / MEDIA_DIR, settings.ffmpeg_bin, settings.ffprobe_bin)
    store = JobStore(settings.data_dir / "jobs", media.sizes)
    ports = ports or real_ports(settings)
    # One for the app, so that what the render queue has queued shows in the editor.
    media_words = MediaWordsStore(settings.data_dir / MEDIA_DIR, settings.whisper_model)
    # One for the app: a Matte piece is made one at a time, for the editor or a render.
    mattes = MatteRunner(ports.person_model, ports.matter, settings.ffmpeg_bin)
    renders = Renders(store, settings, ports.transcriber, media_words, mattes)
    templates = TemplateStore(settings.data_dir / TEMPLATES_FILE)
    worker = Worker(store, Pipeline(store, ports, settings, templates, media.lengths), renders)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The MCP server's sessions: a mounted app's own lifespan doesn't run.
        async with app.state.mcp.session_manager.run(), app.state.agent_mcp.session_manager.run():
            worker.start()
            yield
            worker.stop()

    app = FastAPI(title="AI Clipper", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.worker = worker
    app.state.profiles = ProfileStore(settings.data_dir / PROFILE_FILE)
    app.state.presets = PresetStore(settings.data_dir / PRESETS_FILE)
    app.state.text_presets = TextPresetStore(settings.data_dir / TEXT_PRESETS_FILE)
    app.state.export_presets = renders.export_presets
    app.state.templates = templates
    app.state.starred = StarredStore(settings.data_dir / STARRED_FILE)
    app.state.logos = LogoStore(settings.data_dir / LOGOS_DIR, settings.ffmpeg_bin)
    app.state.media = media
    # One for the app: a Narration is made one at a time, whichever tab or agent asks. Kokoro, on this
    # Mac, after the cloud engines; its model downloaded one at a time, apart from the runner.
    app.state.kokoro = ports.kokoro
    # The person model, for Background removal's Matte: downloaded from the Inspector or by the agent.
    app.state.person_model = ports.person_model
    app.state.mattes = mattes
    engines = [*ports.voices, *([KokoroSpeech(ports.kokoro)] if ports.kokoro else [])]
    app.state.narrations = NarrationRunner(
        media, engines, settings.ffmpeg_bin, settings.data_dir / NARRATIONS_DIR, samples_dir=settings.data_dir / VOICE_SAMPLES_DIR
    )
    app.state.media_words = media_words
    app.state.faces = fonts.use(settings.data_dir / fonts.IMPORTED_DIR)
    app.state.looks = looks.use(settings.data_dir / looks.IMPORTED_DIR)
    app.include_router(api.router)
    app.include_router(api.media)
    app.include_router(agent_routes.router)
    # The MCP server at /mcp (streamable HTTP; localhost only), ahead of the frontend's catch-all. Its
    # route is added as it is, not mounted: a mount at /mcp wouldn't match /mcp itself.
    app.state.mcp = build_mcp(app)
    app.router.routes.extend(app.state.mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True).routes)
    # The Agent's at /mcp/agent (localhost only too): its tools only, bound by a bearer token to one Candidate.
    app.state.agent_scopes = ScopeRegistry()
    app.state.agent_mcp = build_mcp(app, scoped=True)
    app.router.routes.extend(app.state.agent_mcp.streamable_http_app(streamable_http_path="/mcp/agent", stateless_http=True).routes)
    if (settings.frontend_dir / "index.html").is_file():
        _serve_frontend(app, settings.frontend_dir)
    return app


def _serve_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built frontend: its files as they are, and index.html for every other path, so that
    the client-side routes (such as /jobs/<id>) survive a reload. Unknown /api, /media and /mcp paths stay 404."""
    dist = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path.split("/", 1)[0] in {"api", "media", "mcp"}:
            raise HTTPException(404)
        file = (dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(dist):
            return FileResponse(file)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
