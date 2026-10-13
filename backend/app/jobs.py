"""Jobs and the Job store: one directory per Job, holding `job.json` and the Job's stage artifacts."""

import json
import re
import threading
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from pydantic import Field, TypeAdapter

from app.candidates import Candidate
from app.profile import ChannelProfile
from app.selection import Selection
from app.storage import write_atomic
from app.transcript import Transcript
from app.video_source import Source

DEFAULT_LANGUAGE = "id"

STATE_FILE = "job.json"
TRANSCRIPT_FILE = "transcript.json"
CANDIDATES_FILE = "candidates.json"
# The run of Selection that produced the Candidates, for inspection and evaluation.
SELECTION_FILE = "selection.json"

_JOB_ID = re.compile(r"[0-9a-f]{12}")


class JobStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    REVIEW = "review"
    ERROR = "error"


@dataclass(frozen=True)
class JobOptions:
    language: Annotated[str, Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$")] = DEFAULT_LANGUAGE
    min_secs: Annotated[float, Field(gt=0)] = 20
    max_secs: Annotated[float, Field(gt=0)] = 90
    captions: bool = True
    # What to look for in this episode, e.g. "find the funny moments"; it steers Selection.
    brief: str | None = None
    # Ignore YouTube's captions and transcribe the whole Source with Whisper.
    transcribe_locally: bool = False

    def __post_init__(self) -> None:
        if self.min_secs >= self.max_secs:
            raise ValueError("min_secs must be less than max_secs")
        object.__setattr__(self, "brief", (self.brief or "").strip() or None)


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
    # The Channel Profile as it was when the Job was created: Selection steers by this snapshot. An
    # eval run replaces it with the current profile before analyzing the Job again.
    profile: ChannelProfile = ChannelProfile()
    status: JobStatus = JobStatus.QUEUED
    # The stage running now, or the one the Job stopped in (with `error` set); None when queued or done.
    stage: JobStatus | None = None
    error: str | None = None
    # Percent done and a status line for the running stage, when it reports them.
    progress: float | None = None
    message: str | None = None
    # Things that went wrong without failing the Job, e.g. a stretch of audio left untranscribed.
    warnings: list[str] = field(default_factory=list)
    source: Source | None = None
    # The version of the Selection prompts that produced the Job's Candidates.
    prompt_version: str | None = None
    history: list[Transition] = field(default_factory=list)


class JobNotFound(LookupError):
    pass


_JOB = TypeAdapter(Job)
_TRANSCRIPT = TypeAdapter(Transcript)
_CANDIDATES = TypeAdapter(list[Candidate])
_SELECTION = TypeAdapter(Selection)


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()

    def create(self, url: str, options: JobOptions, profile: ChannelProfile) -> Job:
        now = datetime.now(UTC)
        job = Job(
            id=uuid4().hex[:12],
            url=url,
            options=options,
            created_at=now,
            updated_at=now,
            profile=profile,
            history=[Transition(JobStatus.QUEUED, now)],
        )
        self.job_dir(job.id).mkdir(parents=True)
        self._save(job)
        return job

    def get(self, job_id: str) -> Job:
        try:
            return _parse_job((self.job_dir(job_id) / STATE_FILE).read_bytes())
        except FileNotFoundError:
            raise JobNotFound(job_id) from None

    def all(self) -> list[Job]:
        """Every Job, newest first."""
        jobs = [_parse_job(path.read_bytes()) for path in self.root.glob(f"*/{STATE_FILE}")]
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

    def save_candidates(self, job_id: str, candidates: list[Candidate]) -> None:
        write_atomic(self.job_dir(job_id) / CANDIDATES_FILE, _CANDIDATES.dump_json(candidates, indent=2))

    def load_candidates(self, job_id: str) -> list[Candidate] | None:
        path = self.job_dir(job_id) / CANDIDATES_FILE
        return _CANDIDATES.validate_json(path.read_bytes()) if path.is_file() else None

    def save_selection(self, job_id: str, selection: Selection) -> None:
        write_atomic(self.job_dir(job_id) / SELECTION_FILE, _SELECTION.dump_json(selection, indent=2))

    def load_selection(self, job_id: str) -> Selection | None:
        path = self.job_dir(job_id) / SELECTION_FILE
        return _SELECTION.validate_json(path.read_bytes()) if path.is_file() else None

    def _save(self, job: Job) -> None:
        write_atomic(self.job_dir(job.id) / STATE_FILE, _JOB.dump_json(job, indent=2))


def _parse_job(data: bytes) -> Job:
    """A stored Job. Jobs saved before Selection existed ended in `transcribed`: they are read as
    having stopped before analyzing, so re-running that stage takes them on to review."""
    state = json.loads(data)
    if state["status"] != "transcribed":
        return _JOB.validate_json(data)
    hint = f"Not analyzed yet: run `make reanalyze JOB={state['id']}`"
    for change in state["history"]:
        if change["status"] == "transcribed":
            change["status"] = JobStatus.ERROR
    return _JOB.validate_python(state | {"status": JobStatus.ERROR, "stage": JobStatus.ANALYZING, "error": hint})
