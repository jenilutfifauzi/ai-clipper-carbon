"""Jobs and the Job store: one directory per Job, holding `job.json` and the Job's stage artifacts."""

import fcntl
import json
import logging
import re
import shutil
import threading
from collections.abc import Callable, Collection, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from pydantic import Field, TypeAdapter, ValidationError

from app.candidates import Candidate
from app.clips import Clip
from app.llm import ScoreResponse
from app.profile import ChannelProfile
from app.selection import Selection
from app.storage import write_atomic
from app.transcript import Transcript
from app.video_source import Source

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE = "id"

STATE_FILE = "job.json"
TRANSCRIPT_FILE = "transcript.json"
CANDIDATES_FILE = "candidates.json"
# The run of Selection that produced the Candidates, for inspection and evaluation.
SELECTION_FILE = "selection.json"
# The Score pass's answers so far, while the analyzing stage runs (see Pipeline._analyze).
SCORES_FILE = "scores.json"
# The Job's Clips: their render requests and finished renders (app/rendering.py).
CLIPS_FILE = "clips.json"
# Held (flock) by the process running the Job's stages, or rendering its Clips.
RUN_LOCK = "run.lock"

# An uploaded master file, named so plus the extension it was uploaded with (ffprobe goes by the
# contents, the browser's player by the extension).
MASTER_FILE = "master"

_JOB_ID = re.compile(r"[0-9a-f]{12}")
_SUFFIX = re.compile(r"\.[a-z0-9]{1,8}")


class JobStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    REVIEW = "review"
    # In review, with Clips queued or being rendered; back to review once they are done.
    RENDERING = "rendering"
    WAITING_QUOTA = "waiting_quota"
    ERROR = "error"


# The statuses in which a process is running one of the Job's stages.
RUNNING = frozenset({JobStatus.DOWNLOADING, JobStatus.TRANSCRIBING, JobStatus.ANALYZING})


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
class JobWarning:
    """Something that went wrong without failing the Job, e.g. a stretch of audio left untranscribed.
    It is dropped when its stage runs again."""

    stage: JobStatus
    message: str


@dataclass(frozen=True)
class QuotaWait:
    """Gemini's quota errors in a row (or overloads that outlasted Selection's retries), and the wait
    they have put the Job in."""

    # When the first of them came, and how many there have been.
    since: datetime
    errors: int
    # When the Job runs again.
    retry_at: datetime
    # How many Score batches had been answered by then. A quota error after more have been starts a new run.
    scored: int


@dataclass(frozen=True)
class Upload:
    """The master file the owner uploaded for a Job, in place of a URL (app/uploads.py)."""

    # Its name on the owner's machine, and its size in bytes.
    name: str
    size: int
    # The stored file's name in the Job's directory.
    file: str


@dataclass(frozen=True)
class Job:
    id: str
    # The episode's YouTube URL; empty for an uploaded master file.
    url: str
    options: JobOptions
    created_at: datetime
    updated_at: datetime
    # The Channel Profile as it was when the Job was created: Selection steers by this snapshot. An
    # eval run replaces it with the current profile before analyzing the Job again.
    profile: ChannelProfile = ChannelProfile()
    status: JobStatus = JobStatus.QUEUED
    # The stage running now, or the one the Job stopped in (with `error` set, or waiting for quota);
    # None when queued or done.
    stage: JobStatus | None = None
    error: str | None = None
    # Percent done and a status line for the running stage, when it reports them.
    progress: float | None = None
    message: str | None = None
    warnings: list[JobWarning] = field(default_factory=list)
    # Set while the Job meets quota errors or overloads in the analyzing stage, until it gets past
    # them or fails.
    quota: QuotaWait | None = None
    # Set when the Source is a master file the owner uploaded.
    upload: Upload | None = None
    source: Source | None = None
    # The version of the Selection prompts that produced the Job's Candidates.
    prompt_version: str | None = None
    history: list[Transition] = field(default_factory=list)


# Called with a Job's id and its new state each time the store saves it, or None once it's deleted.
JobListener = Callable[[str, Job | None], None]


class JobNotFound(LookupError):
    pass


class JobConflict(RuntimeError):
    """The Job's status, or another process running it, rules the change out."""


_JOB = TypeAdapter(Job)
_TRANSCRIPT = TypeAdapter(Transcript)
_CANDIDATES = TypeAdapter(list[Candidate])
_SELECTION = TypeAdapter(Selection)
_SCORES = TypeAdapter(dict[str, ScoreResponse])
_CLIPS = TypeAdapter(list[Clip])


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self._listeners: tuple[JobListener, ...] = ()
        self._listeners_lock = threading.Lock()

    def create(
        self, url: str, options: JobOptions, profile: ChannelProfile, upload: tuple[Path, str] | None = None
    ) -> Job:
        """A new queued Job. For an uploaded master file, `upload` is the complete file and its name
        on the owner's machine: the file is moved into the Job's directory (on the same volume) before
        the Job is saved, so that no Job is ever without its whole upload."""
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
        if upload is not None:
            path, name = upload
            suffix = Path(name).suffix.lower()
            stored = MASTER_FILE + (suffix if _SUFFIX.fullmatch(suffix) else "")
            size = path.stat().st_size
            path.replace(self.job_dir(job.id) / stored)
            job = replace(job, upload=Upload(name, size, stored))
        self._save(job)
        return job

    def get(self, job_id: str) -> Job:
        try:
            return _parse_job((self.job_dir(job_id) / STATE_FILE).read_bytes())
        except FileNotFoundError:
            raise JobNotFound(job_id) from None

    def all(self) -> list[Job]:
        """Every Job, newest first."""
        jobs = []
        for path in self.root.glob(f"*/{STATE_FILE}"):
            with suppress(FileNotFoundError):  # deleted meanwhile
                jobs.append(_parse_job(path.read_bytes()))
        return sorted(jobs, key=lambda job: job.created_at, reverse=True)

    def update(self, job_id: str, *, expect: Collection[JobStatus] | None = None, **changes: Any) -> Job:
        """Apply `changes` to the stored Job; a status change is appended to its history. With
        `expect`, only if the Job's status is one of those: otherwise JobConflict is raised."""
        with self._lock:
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            job = _changed(job, changes)
            self._save(job)
            return job

    def delete(self, job_id: str) -> None:
        """Remove the Job's directory with all its files. Refused (JobConflict) while one of its
        stages runs, here or in another process."""
        with self._lock:
            job = self.get(job_id)
            if job.status in RUNNING:
                raise JobConflict(f"Job {job_id} is {job.status}")
            with self.running(job_id):
                shutil.rmtree(self.job_dir(job_id))
            self._notify(job_id, None)

    @contextmanager
    def watch(self, listener: JobListener) -> Iterator[None]:
        """Call `listener` with every change this store makes to a Job, until the block ends.

        It is called on the thread making the change (the worker's, mostly), while the store's lock
        is held, so a Job's changes arrive in order; it must return quickly. Changes made by another
        process, such as a CLI run, aren't seen: re-read the Job now and then to catch those.
        """
        with self._listeners_lock:
            self._listeners = (*self._listeners, listener)
        try:
            yield
        finally:
            with self._listeners_lock:
                self._listeners = tuple(other for other in self._listeners if other is not listener)

    def _notify(self, job_id: str, job: Job | None) -> None:
        for listener in self._listeners:
            try:
                listener(job_id, job)
            except Exception:
                logger.exception("A Job listener failed")

    @contextmanager
    def running(self, job_id: str) -> Iterator[None]:
        """Hold the Job's run lock, so that two processes (the app and a CLI run) never run its
        stages at once. Raises JobConflict when another one holds it. The lock goes when its
        process does, however that ends."""
        try:
            lock = open(self.job_dir(job_id) / RUN_LOCK, "a")
        except FileNotFoundError:
            raise JobNotFound(job_id) from None
        with lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise JobConflict(f"Job {job_id} is being run by another process") from None
            yield

    def busy(self, job_id: str) -> bool:
        """Whether another process is running the Job's stages."""
        try:
            with self.running(job_id):
                return False
        except JobConflict:
            return True

    def wait_until_free(self, job_id: str) -> None:
        """Block until no other process holds the Job's run lock (at once if none does)."""
        try:
            lock = open(self.job_dir(job_id) / RUN_LOCK, "a")
        except FileNotFoundError:
            raise JobNotFound(job_id) from None
        with lock:
            fcntl.flock(lock, fcntl.LOCK_EX)

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

    def change_candidates[R](
        self,
        job_id: str,
        change: Callable[[Job, list[Candidate]], tuple[list[Candidate], R]],
        *,
        expect: Collection[JobStatus] | None = None,
    ) -> R:
        """Save the Candidates `change` makes of the Job's, and return what else it returns. This
        happens under the store's lock, so review edits and a run of Selection never overwrite each
        other's Candidates. Like any change to the Job, it moves `updated_at` and listeners are told.
        With `expect`, as `update`."""
        with self._lock:
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            candidates, result = change(job, self.load_candidates(job_id) or [])
            self.save_candidates(job_id, candidates)
            self._save(replace(job, updated_at=datetime.now(UTC)))
            return result

    def load_clips(self, job_id: str) -> list[Clip]:
        path = self.job_dir(job_id) / CLIPS_FILE
        return _CLIPS.validate_json(path.read_bytes()) if path.is_file() else []

    def change_clips[R](
        self,
        job_id: str,
        change: Callable[[Job, list[Clip]], tuple[list[Clip], dict[str, Any], R]],
        *,
        expect: Collection[JobStatus] | None = None,
    ) -> R:
        """Save the Clips `change` makes of the Job's, apply the changes to the Job it also returns (as
        `update`), and return what else it returns, all under the store's lock: so a render request and
        the end of a render queue never miss each other. With `expect`, as `update`."""
        with self._lock:
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            clips, changes, result = change(job, self.load_clips(job_id))
            write_atomic(self.job_dir(job_id) / CLIPS_FILE, _CLIPS.dump_json(clips, indent=2))
            self._save(_changed(job, changes))
            return result

    def save_selection(self, job_id: str, selection: Selection) -> None:
        write_atomic(self.job_dir(job_id) / SELECTION_FILE, _SELECTION.dump_json(selection, indent=2))

    def load_selection(self, job_id: str) -> Selection | None:
        path = self.job_dir(job_id) / SELECTION_FILE
        return _SELECTION.validate_json(path.read_bytes()) if path.is_file() else None

    def save_scores(self, job_id: str, scores: dict[str, ScoreResponse]) -> None:
        write_atomic(self.job_dir(job_id) / SCORES_FILE, _SCORES.dump_json(scores))

    def load_scores(self, job_id: str) -> dict[str, ScoreResponse]:
        """The kept Score answers; none when they were kept under response schemas that have changed since."""
        path = self.job_dir(job_id) / SCORES_FILE
        try:
            return _SCORES.validate_json(path.read_bytes())
        except (FileNotFoundError, ValidationError):
            return {}

    def discard_scores(self, job_id: str) -> None:
        (self.job_dir(job_id) / SCORES_FILE).unlink(missing_ok=True)

    def _save(self, job: Job) -> None:
        write_atomic(self.job_dir(job.id) / STATE_FILE, _JOB.dump_json(job, indent=2))
        self._notify(job.id, job)


def _changed(job: Job, changes: dict[str, Any]) -> Job:
    """The Job with `changes` applied, now; a status change is appended to its history."""
    now = datetime.now(UTC)
    if changes.get("status", job.status) != job.status:
        changes = changes | {"history": [*job.history, Transition(changes["status"], now)]}
    return replace(job, **changes, updated_at=now)


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
