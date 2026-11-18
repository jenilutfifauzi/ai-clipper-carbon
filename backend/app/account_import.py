"""Bringing the accounts' documents from their data directories into Postgres, once (ADR 0033).

`python -m app.cli import-accounts` reads each DATA_DIR/users/<account>/ and writes its documents and
secrets as the app keeps them in Postgres. Nothing in the directories is changed or removed: the
media stay where they are, and the files that were imported are left as they were. What Postgres
already has is kept, so it can be run again.
"""

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from app import fonts, looks
from app.agent.credentials import CREDENTIALS_FILE
from app.agent.attachments import IMAGES_DIR
from app.agent.transcript_store import TRANSCRIPTS_DIR
from app.documents import Document, Documents
from app.export_presets import EXPORT_PRESETS_FILE
from app.jobs import CANDIDATES_FILE, CLIPS_FILE, REVISIONS_DIR, SCORES_FILE, SELECTION_FILE, STATE_FILE, TRANSCRIPT_FILE
from app.logos import LOGOS_INDEX
from app.machine import Machine
from app.media import MEDIA_INDEX
from app.profile import PROFILE_FILE
from app.settings_store import SETTINGS_FILE, YOUTUBE_COOKIE_RELATIVE
from app.starred_effects import STARRED_FILE
from app.styles import PRESETS_FILE
from app.templates import TEMPLATES_FILE
from app.text_presets import TEXT_PRESETS_FILE
from app.workspace import IMPORTED_MARK

_ACCOUNT = re.compile(r"[0-9a-f]{64}")
_JOB = re.compile(r"[0-9a-f]{12}")
_ACCOUNT_DOCUMENTS = (
    PROFILE_FILE, PRESETS_FILE, TEMPLATES_FILE, TEXT_PRESETS_FILE, EXPORT_PRESETS_FILE, STARRED_FILE,
    MEDIA_INDEX, LOGOS_INDEX, fonts.IMPORTED_INDEX, looks.IMPORTED_INDEX,
)  # fmt: skip
_JOB_DOCUMENTS = (STATE_FILE, TRANSCRIPT_FILE, CANDIDATES_FILE, CLIPS_FILE, SELECTION_FILE, SCORES_FILE)
_SECRETS = (SETTINGS_FILE, CREDENTIALS_FILE.as_posix(), YOUTUBE_COOKIE_RELATIVE.as_posix())


@dataclass
class Imported:
    """What importing one account did, by key."""

    written: list[str] = field(default_factory=list)
    # Already in Postgres, and left as they are there.
    kept: list[str] = field(default_factory=list)
    # Not imported, and why.
    skipped: dict[str, str] = field(default_factory=dict)


def account_folders(data_dir: Path, account: str | None = None) -> list[Path]:
    """The accounts' directories in `data_dir`, or the one of `account`: never the files directly in
    `data_dir`, which are no account's (ADR 0032)."""
    folders = sorted(folder for folder in (data_dir / "users").glob("*") if folder.is_dir() and _ACCOUNT.fullmatch(folder.name))
    return [folder for folder in folders if account in (None, folder.name)]


def import_account(folder: Path, documents: Documents, machine: Machine, *, overwrite: bool = False, dry_run: bool = False) -> Imported:
    """Write the account's documents and secrets in `folder` to `documents`, each Job with `machine`,
    which has its media, as its Host. What `documents` already has is kept, unless `overwrite`; with
    `dry_run`, nothing is written."""
    imported = Imported()

    def bring(key: str, data: bytes, target: Document) -> None:
        if not overwrite and target.version() is not None:
            imported.kept.append(key)
            return
        if not dry_run:
            target.write(data)
        imported.written.append(key)

    for key, data in _documents(folder, machine, imported):
        bring(key, data, documents.doc(key))
    for key in _SECRETS:
        if (folder / key).is_file():
            bring(key, (folder / key).read_bytes(), documents.secret(key))
    if not dry_run:
        (folder / IMPORTED_MARK).touch()
    return imported


def _documents(folder: Path, machine: Machine, imported: Imported) -> Iterator[tuple[str, bytes]]:
    """The account's documents as Postgres takes them, by key; those that aren't JSON are skipped."""
    for key in (*_ACCOUNT_DOCUMENTS, *_job_keys(folder, imported)):
        path = folder / key
        if not path.is_file():
            continue
        try:
            read = json.loads(path.read_bytes())
        except ValueError:
            imported.skipped[key] = "not JSON"
            continue
        if path.name == STATE_FILE and path.parent.parent.name == "jobs":
            read = {**read, "host": {"id": machine.id, "name": machine.name}}
        yield key, json.dumps(read, ensure_ascii=False).encode()


def _job_keys(folder: Path, imported: Imported) -> Iterator[str]:
    for job in sorted((folder / "jobs").glob("*")):
        if not _JOB.fullmatch(job.name) or not (job / STATE_FILE).is_file():
            continue
        at = f"jobs/{job.name}"
        yield from (f"{at}/{name}" for name in _JOB_DOCUMENTS)
        yield from (f"{at}/{REVISIONS_DIR}/{path.name}" for path in sorted((job / REVISIONS_DIR).glob("*.json")))
        for path in sorted((job / TRANSCRIPTS_DIR).glob("*.json")):
            if not (job / TRANSCRIPTS_DIR / path.stem).is_dir():
                imported.skipped[f"{at}/{TRANSCRIPTS_DIR}/{path.name}"] = (
                    "a chat from before Agent Threads: open the Candidate's Agent tab once with no database, then import again"
                )
        # Each Candidate's Threads; its attachments' pictures stay with the media.
        yield from (
            f"{at}/{TRANSCRIPTS_DIR}/{path.parent.name}/{path.name}"
            for path in sorted((job / TRANSCRIPTS_DIR).glob("*/*.json"))
            if path.parent != job / IMAGES_DIR
        )
