from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import api
from app.config import Settings, load_settings
from app.jobs import JobStore
from app.pipeline import Pipeline
from app.ports import Ports, real_ports
from app.profile import PROFILE_FILE, ProfileStore
from app.worker import Worker


def create_app(settings: Settings | None = None, ports: Ports | None = None) -> FastAPI:
    """The app, wired to `ports` (the real ones by default). Run with `uvicorn --factory app.main:create_app`."""
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = JobStore(settings.data_dir / "jobs")
    worker = Worker(store, Pipeline(store, ports or real_ports(settings), settings))

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        worker.start()
        yield
        worker.stop()

    app = FastAPI(title="AI Clipper", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.worker = worker
    app.state.profiles = ProfileStore(settings.data_dir / PROFILE_FILE)
    app.include_router(api.router)
    return app
