"""Jobs and the Job store: one directory per Job, holding `job.json` and the Job's stage artifacts."""

import os
import re
import tempfile
import threading
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from pydantic import Field, TypeAdapter

from app.transcript import Transcript
from app.video_source import Source

DEFAULT_LANGUAGE = "id"

STATE_FILE = "job.json"
TRANSCRIPT_FILE = "transcript.json"

_JOB_ID = re.compile(r"[0-9a-f]{12}")


class JobStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    # Where the pipeline ends for now; Selection (ticket 04) continues to analyzing → review.
    TRANSCRIBED = "transcribed"
    ERROR = "error"


@dataclass(frozen=True)
class JobOptions:
    language: Annotated[str, Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$")] = DEFAULT_LANGUAGE
    min_secs: Annotated[float, Field(gt=0)] = 20
    max_secs: Annotated[float, Field(gt=0)] = 90
    captions: bool = True
    brief: str | None = None

    def __post_init__(self) -> None:
        if self.min_secs >= self.max_secs:
            raise ValueError("min_secs must be less than max_secs")


@dataclass(frozen=True)
class Transition:
    status: JobStatus
    at: datetime


@dataclass(frozen=True)
class Job:
    id: str
    url: str
    options: JobOptions
    created_at: datetime
    updated_at: datetime
    status: JobStatus = JobStatus.QUEUED
    # The stage running now, or the one the Job stopped in (with `error` set); None when queued or done.
    stage: JobStatus | None = None
    error: str | None = None
    source: Source | None = None
    history: list[Transition] = field(default_factory=list)


class JobNotFound(LookupError):
    pass


_JOB = TypeAdapter(Job)
_TRANSCRIPT = TypeAdapter(Transcript)


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()

    def create(self, url: str, options: JobOptions) -> Job:
        now = datetime.now(UTC)
        job = Job(
            id=uuid4().hex[:12],
            url=url,
            options=options,
            created_at=now,
            updated_at=now,
            history=[Transition(JobStatus.QUEUED, now)],
        )
        self.job_dir(job.id).mkdir(parents=True)
        self._save(job)
        return job

    def get(self, job_id: str) -> Job:
        try:
            return _JOB.validate_json((self.job_dir(job_id) / STATE_FILE).read_bytes())
        except FileNotFoundError:
            raise JobNotFound(job_id) from None

    def all(self) -> list[Job]:
        """Every Job, newest first."""
        jobs = [_JOB.validate_json(path.read_bytes()) for path in self.root.glob(f"*/{STATE_FILE}")]
        return sorted(jobs, key=lambda job: job.created_at, reverse=True)

    def update(self, job_id: str, **changes: Any) -> Job:
        """Apply `changes` to the stored Job; a status change is appended to its history."""
        with self._lock:
            job = self.get(job_id)
            now = datetime.now(UTC)
            if changes.get("status", job.status) != job.status:
                changes["history"] = [*job.history, Transition(changes["status"], now)]
            job = replace(job, **changes, updated_at=now)
            self._save(job)
            return job

    def job_dir(self, job_id: str) -> Path:
        if not _JOB_ID.fullmatch(job_id):
            raise JobNotFound(job_id)
        return self.root / job_id

    def save_transcript(self, job_id: str, transcript: Transcript) -> None:
        write_atomic(self.job_dir(job_id) / TRANSCRIPT_FILE, _TRANSCRIPT.dump_json(transcript))

    def load_transcript(self, job_id: str) -> Transcript | None:
        path = self.job_dir(job_id) / TRANSCRIPT_FILE
        return _TRANSCRIPT.validate_json(path.read_bytes()) if path.is_file() else None

    def _save(self, job: Job) -> None:
        write_atomic(self.job_dir(job.id) / STATE_FILE, _JOB.dump_json(job, indent=2))


def write_atomic(path: Path, data: bytes) -> None:
    """Write via a temporary file and a rename, so readers never see a partial file."""
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as tmp:
        tmp.write(data)
        tmp.flush()
        os.fsync(tmp.fileno())
    Path(tmp.name).replace(path)
