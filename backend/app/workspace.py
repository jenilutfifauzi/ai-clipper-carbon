"""Account-scoped application state and on-disk workspaces.

The pre-authentication DATA_DIR is deliberately not a tenant workspace. New signed-in
users receive isolated data under DATA_DIR/users/<sha256(clerk-sub)>; existing shared
files in DATA_DIR remain untouched and are never assigned automatically.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import threading
from collections.abc import AsyncIterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from typing import Callable

from fastapi import HTTPException, Request

from app.config import Settings
from app.database import Database
from app.documents import Documents, FileDocuments, PostgresDocuments
from app.machine import Machine, this_machine
from app.sealing import Sealer

logger = logging.getLogger(__name__)

# Left in an account's directory once it is imported into Postgres (app/account_import.py).
IMPORTED_MARK = ".imported-to-postgres"
from app.ports import Ports, real_ports


def user_data_dir(data_root: Path, user_id: str) -> Path:
    """Return a traversal-safe, non-identifying directory for a verified Clerk subject."""
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    return data_root / "users" / digest


def workspace_for_request(request: Request) -> UserWorkspace:
    """The per-user workspace for this request (or the explicit test-injected workspace)."""
    default = getattr(request.app.state, "default_workspace", None)
    if default is not None:
        return default

    user_id = getattr(request.state, "clerk_user_id", None)
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    registry: WorkspaceRegistry = request.app.state.workspace_registry
    return registry.for_user(user_id)


def workspace_for_app_context(app) -> UserWorkspace:
    """Resolve a trusted MCP tool's account without accepting an identity from its arguments."""
    default = getattr(app.state, "default_workspace", None)
    if default is not None:
        return default
    from app.auth import current_internal_user

    user_id = current_internal_user()
    if not user_id:
        raise RuntimeError("An authenticated account context is required for this operation")
    return app.state.workspace_registry.for_user(user_id)


async def bind_workspace(request: Request) -> AsyncIterator[UserWorkspace]:
    """Keep process-level font/look helpers bound to this account for the whole request."""
    workspace = workspace_for_request(request)
    request.state.workspace = workspace
    # Settings saved on another machine since are this one's too, from its next request on.
    if workspace.settings_store.refresh():
        workspace.settings_changed()
    with workspace.activate():
        yield workspace


class UserWorkspace:
    """All mutable services and stores for one account, backed by one private data directory."""

    def __init__(
        self,
        settings: Settings,
        app,
        scopes,
        *,
        user_id: str,
        ports: Ports | None = None,
        ports_factory: Callable[[Settings], Ports] = real_ports,
        documents: Documents | None = None,
        machine: Machine | None = None,
    ) -> None:
        from app import fonts, looks
        from app.agent.credentials import CREDENTIALS_FILE
        from app.agent.providers import DetectionCache
        from app.agent.sessions import AgentSessionManager
        from app.jobs import JobStore
        from app.kokoro import KokoroSpeech
        from app.logos import LOGOS_DIR, LOGOS_INDEX, LogoStore
        from app.matte import MatteRunner
        from app.media import MEDIA_DIR, MEDIA_INDEX, MediaStore
        from app.media_words import MediaWordsStore
        from app.narration import NARRATIONS_DIR, VOICE_SAMPLES_DIR, NarrationRunner
        from app.pipeline import Pipeline
        from app.profile import PROFILE_FILE, ProfileStore
        from app.rendering import Renders
        from app.settings_store import SettingsStore
        from app.starred_effects import STARRED_FILE, StarredStore
        from app.styles import PRESETS_FILE, PresetStore
        from app.templates import TEMPLATES_FILE, TemplateStore
        from app.text_presets import TEXT_PRESETS_FILE, TextPresetStore
        from app.uploads import UPLOADS_DIR
        from app.worker import Worker

        self.user_id = user_id
        self.settings = settings
        self.settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.settings.data_dir, 0o700)
        # The account's documents: rows in Postgres, or without a database, files in its data directory.
        documents = documents or FileDocuments(self.settings.data_dir)

        self.settings_store = SettingsStore(self.settings, documents)
        self.settings_store.apply()
        self.ports = ports or ports_factory(self.settings)

        # Only incomplete transient inputs are cleaned. The parent DATA_DIR and any
        # pre-authentication shared data are never traversed, moved, or deleted.
        shutil.rmtree(self.settings.data_dir / UPLOADS_DIR, ignore_errors=True)
        shutil.rmtree(self.settings.data_dir / NARRATIONS_DIR, ignore_errors=True)

        media = MediaStore(
            self.settings.data_dir / MEDIA_DIR, self.settings.ffmpeg_bin, self.settings.ffprobe_bin, documents.doc(MEDIA_INDEX)
        )
        store = JobStore(self.settings.data_dir / "jobs", media.sizes, documents.under("jobs"), machine)
        media_words = MediaWordsStore(self.settings.data_dir / MEDIA_DIR, self.settings.whisper_model)
        mattes = MatteRunner(self.ports.person_model, self.ports.matter, self.settings.ffmpeg_bin)
        renders = Renders(store, self.settings, self.ports.transcriber, media_words, mattes, documents)
        templates = TemplateStore(documents.doc(TEMPLATES_FILE))
        pipeline = Pipeline(store, self.ports, self.settings, templates, media.lengths)
        self.faces = fonts.Faces(self.settings.data_dir / fonts.IMPORTED_DIR, documents.doc(fonts.IMPORTED_INDEX))
        self.looks = looks.ImportedLooks(self.settings.data_dir / looks.IMPORTED_DIR, documents.doc(looks.IMPORTED_INDEX))
        worker = Worker(store, pipeline, renders, workspace_context=self.activate)

        self.pipeline = pipeline
        self.store = store
        self.worker = worker
        self.profiles = ProfileStore(documents.doc(PROFILE_FILE))
        self.presets = PresetStore(documents.doc(PRESETS_FILE))
        self.text_presets = TextPresetStore(documents.doc(TEXT_PRESETS_FILE))
        self.export_presets = renders.export_presets
        self.templates = templates
        self.starred = StarredStore(documents.doc(STARRED_FILE))
        self.logos = LogoStore(self.settings.data_dir / LOGOS_DIR, self.settings.ffmpeg_bin, documents.doc(LOGOS_INDEX))
        self.media = media
        self.kokoro = self.ports.kokoro
        self.person_model = self.ports.person_model
        self.mattes = mattes
        engines = [*self.ports.voices, *([KokoroSpeech(self.ports.kokoro)] if self.ports.kokoro else [])]
        self.narrations = NarrationRunner(
            media,
            engines,
            self.settings.ffmpeg_bin,
            self.settings.data_dir / NARRATIONS_DIR,
            samples_dir=self.settings.data_dir / VOICE_SAMPLES_DIR,
        )
        self.media_words = media_words
        self.agent_credentials = documents.secret(CREDENTIALS_FILE.as_posix())
        self.agent_scopes = scopes
        self.agent_sessions = AgentSessionManager(app, self, self.ports.agent_transport)
        self.agent_detection = DetectionCache()
        self._started = False

    @contextmanager
    def activate(self):
        """Select this workspace's registries inside the current async task or worker thread."""
        from app import fonts, looks

        with fonts.using_registry(self.faces), looks.using_store(self.looks):
            yield

    def settings_changed(self) -> None:
        """Have the LLM follow the settings as they are now saved."""
        refresh = getattr(self.ports.llm, "refresh", None)
        if refresh:
            refresh()
        # Keep future requests paced for the selected provider. The worker is the
        # only caller that wraps the LLM with PacedLlm.
        self.pipeline.llm.interval = 13.0 if self.settings.llm_provider == "gemini" else 1.0

    def start(self) -> None:
        if not self._started:
            self.worker.start()
            self._started = True

    async def stop(self) -> None:
        if self._started:
            self.worker.stop()
            self._started = False
        await self.agent_sessions.close()


class WorkspaceRegistry:
    """Lazily create one independent runtime and storage tree for each verified Clerk subject."""

    def __init__(
        self,
        settings: Settings,
        app,
        scopes,
        ports_factory: Callable[[Settings], Ports] = real_ports,
        database: Database | None = None,
    ) -> None:
        self.settings = settings
        self.database = database
        # Raises when the accounts' secrets would go to Postgres with no SECRETS_KEY to seal them.
        self.sealer = Sealer(settings.secrets_key) if database else None
        self.machine = this_machine(settings.data_dir, settings.machine_name) if database else None
        self.app = app
        self.scopes = scopes
        self.ports_factory = ports_factory
        self.users_dir = settings.data_dir / "users"
        self._workspaces: dict[str, UserWorkspace] = {}
        self._lock = threading.RLock()
        self._started = False

    def for_user(self, user_id: str) -> UserWorkspace:
        digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
        with self._lock:
            workspace = self._workspaces.get(digest)
            if workspace is None:
                self.users_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                if self.users_dir.is_symlink():
                    raise RuntimeError("Refusing a symlink as the account workspaces directory")
                os.chmod(self.users_dir, 0o700)
                directory = self.users_dir / digest
                if directory.is_symlink():
                    raise RuntimeError("Refusing a symlink as an account data directory")
                if self.database is None and (directory / IMPORTED_MARK).exists():
                    logger.warning(
                        "Account %s was imported into Postgres, but DATABASE_URL is unset: showing the files as they were then",
                        digest[:12],
                    )
                account_settings = replace(self.settings, data_dir=directory, ytdlp_cookies_file=None)
                workspace = UserWorkspace(
                    account_settings,
                    self.app,
                    self.scopes,
                    user_id=user_id,
                    ports_factory=self.ports_factory,
                    documents=PostgresDocuments(self.database, digest, self.sealer) if self.database else None,
                    machine=self.machine,
                )
                self._workspaces[digest] = workspace
                if self._started:
                    workspace.start()
            return workspace

    def start(self) -> None:
        with self._lock:
            self._started = True
            for workspace in self._workspaces.values():
                workspace.start()

    async def stop(self) -> None:
        with self._lock:
            self._started = False
            workspaces = list(self._workspaces.values())
        await asyncio.gather(*(workspace.stop() for workspace in workspaces))
