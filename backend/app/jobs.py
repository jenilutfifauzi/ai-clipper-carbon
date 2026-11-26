"""Jobs and the Job store: one directory per Job, holding the Job's media and stage artifacts, and its
documents (`job.json`, its transcript, Candidates and Clips), kept there or in Postgres (ADR 0033)."""

import fcntl
import json
import logging
import re
import shutil
import threading
from collections.abc import Callable, Collection, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
from functools import cached_property
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from pydantic import Field, TypeAdapter, ValidationError

from app.candidates import Candidate, MediaId, TemplateId
from app.canvas import Aspect
from app.clips import Clip
from app.documents import Document, Documents, FileDocuments
from app.llm import ScoreResponse
from app.machine import Machine
from app.migration import Sizes, migrated_candidate, migrated_clip
from app.profile import ChannelProfile
from app.revisions import Edit, HistoryEntry, recorded
from app.selection import Selection
from app.transcript import Language, Transcript
from app.video_source import Source

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE = "id"

STATE_FILE = "job.json"
TRANSCRIPT_FILE = "transcript.json"
CANDIDATES_FILE = "candidates.json"
# Each Candidate's Revision History, as <candidate id>.json.
REVISIONS_DIR = "revisions"
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
    # Stopped by the owner before review; Continue queues it again, and it resumes where it stopped.
    STOPPED = "stopped"
    ERROR = "error"


# The statuses in which a process is running one of the Job's stages.
RUNNING = frozenset({JobStatus.DOWNLOADING, JobStatus.TRANSCRIBING, JobStatus.ANALYZING})
# The statuses in which the owner can stop a Job: on its way to review.
STOPPABLE = frozenset({JobStatus.QUEUED, JobStatus.WAITING_QUOTA, *RUNNING})


# A new Job's Template when none is chosen: the default Template, whichever it is then.
DEFAULT_TEMPLATE = "default"


@dataclass(frozen=True)
class JobOptions:
    language: Language = DEFAULT_LANGUAGE
    min_secs: Annotated[float, Field(gt=0)] = 20
    max_secs: Annotated[float, Field(gt=0)] = 90
    captions: bool = True
    # What to look for in this episode, e.g. "find the funny moments"; it steers Selection.
    brief: str | None = None
    # Ignore YouTube's captions and transcribe the whole Source with Whisper.
    transcribe_locally: bool = False
    # The Template its new Candidates get (GLOSSARY.md, Template): DEFAULT_TEMPLATE as asked, resolved
    # to the default Template's id (or None) when the Job is created; an id; or None for none.
    template: TemplateId | None = DEFAULT_TEMPLATE
    # The Canvas Aspect (docs/adr/0022) of its Candidates, Selection's and those added by hand.
    aspect: Aspect = Aspect.PORTRAIT

    def __post_init__(self) -> None:
        if self.min_secs >= self.max_secs:
            raise ValueError("min_secs must be less than max_secs")
        object.__setattr__(self, "brief", (self.brief or "").strip() or None)


@dataclass(frozen=True)
class StatusChange:
    """An entry of a Job's history: the status it moved to, and when. (Not a video Transition.)"""

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
class Project:
    """What makes a Job a Project (GLOSSARY.md): opened straight in the Advanced Edit, its uploaded
    master file the first video on the Main Track and these Media Library videos after it, in order.
    It is neither transcribed nor analyzed."""

    media: list[MediaId] = field(default_factory=list)


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
    # The stage running now, or the one the Job stopped in (with `error` set, waiting for quota, or
    # stopped by the owner);
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
    # Set for a Project: an uploaded Job opened straight in the Advanced Edit.
    project: Project | None = None
    source: Source | None = None
    # The machine the Job was made on, which has its media (ADR 0033); None for a Job whose documents
    # are files in its directory.
    host: Machine | None = None
    # The version of the Selection prompts that produced the Job's Candidates.
    prompt_version: str | None = None
    history: list[StatusChange] = field(default_factory=list)
    # Candidates queued to be prepared for the clip editor (their caption Words transcribed and their
    # range analysed, without an encode), by the render queue before its Clips.
    preparing: list[str] = field(default_factory=list)
    # Media Library videos queued to have their Media Words transcribed in their language for this
    # Job (a Retry or "Transcribe again"), by the render queue before its preparations.
    transcribing: list[str] = field(default_factory=list)


# Called with a Job's id and its new state each time the store saves it, or None once it's deleted.
JobListener = Callable[[str, Job | None], None]


class JobNotFound(LookupError):
    pass


class JobConflict(RuntimeError):
    """The Job's status, or another process running it, rules the change out."""


class JobElsewhere(RuntimeError):
    """The Job's media aren't on this machine: its Host alone can read them, run it and render it."""

    def __init__(self, job_id: str) -> None:
        super().__init__(f"Job {job_id}'s files aren't on this machine")
        self.job_id = job_id


_JOB = TypeAdapter(Job)
_TRANSCRIPT = TypeAdapter(Transcript)
_CANDIDATES = TypeAdapter(list[Candidate])
_SELECTION = TypeAdapter(Selection)
_SCORES = TypeAdapter(dict[str, ScoreResponse])
_CLIPS = TypeAdapter(list[Clip])
_HISTORY = TypeAdapter(list[HistoryEntry])


class JobStore:
    def __init__(
        self,
        root: Path,
        media_sizes: Callable[[], Sizes] = dict,
        documents: Documents | None = None,
        machine: Machine | None = None,
    ) -> None:
        """The Jobs in `root`. `media_sizes` gives the Media Library items' picture sizes, by which
        Candidates saved in an older shape are read in today's (app/migration.py). `documents` keeps
        each Job's documents under its id; without them, they are files in its directory. `machine`
        is this one, when other machines read the documents too: the Host of the Jobs made here."""
        self.root = root
        self.machine = machine
        self._media_sizes = media_sizes
        self._documents = documents or FileDocuments(root)
        self._lock = threading.Lock()
        # On a thread inside `_changing`, `untold`: the changes listeners are told once all are saved.
        self._change = threading.local()
        self._listeners: tuple[JobListener, ...] = ()
        self._listeners_lock = threading.Lock()
        # Who saved each Candidate's latest Revision in this process, and when, by Job and Candidate id.
        self._edits: dict[tuple[str, str], tuple[int, Edit, datetime]] = {}

    def create(
        self,
        url: str,
        options: JobOptions,
        profile: ChannelProfile,
        upload: tuple[Path, str] | None = None,
        project: Project | None = None,
    ) -> Job:
        """A new queued Job. For an uploaded master file, `upload` is the complete file and its name
        on the owner's machine: the file is moved into the Job's directory (on the same volume) before
        the Job is saved, so that no Job is ever without its whole upload. `project` makes it a Project."""
        now = datetime.now(UTC)
        job = Job(
            id=uuid4().hex[:12],
            url=url,
            options=options,
            created_at=now,
            updated_at=now,
            profile=profile,
            project=project,
            host=self.machine,
            history=[StatusChange(JobStatus.QUEUED, now)],
        )
        self._dir(job.id).mkdir(parents=True)
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
        saved = self._doc(job_id, STATE_FILE).read()
        if saved is None:
            raise JobNotFound(job_id)
        return _parse_job(saved)

    def all(self) -> list[Job]:
        """Every Job, newest first."""
        jobs = [_parse_job(saved) for saved in self._documents.read_named(STATE_FILE).values()]
        return sorted(jobs, key=lambda job: job.created_at, reverse=True)

    def update(self, job_id: str, *, expect: Collection[JobStatus] | None = None, **changes: Any) -> Job:
        """Apply `changes` to the stored Job; a status change is appended to its history. With
        `expect`, only if the Job's status is one of those: otherwise JobConflict is raised."""
        with self._changing(job_id):
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            job = _changed(job, changes)
            self._save(job)
            return job

    def set_captions(self, job_id: str, captions: bool) -> Job:
        """Turn the Job's captions on or off. Refused (JobConflict) while one of its stages runs."""
        with self._changing(job_id):
            job = self.get(job_id)
            if job.status in RUNNING:
                raise JobConflict(f"Job {job_id} is {job.status}")
            job = _changed(job, {"options": replace(job.options, captions=captions)})
            self._save(job)
            return job

    def delete(self, job_id: str) -> None:
        """Remove the Job's directory with all its files, and its documents. Refused (JobConflict)
        while one of its stages runs, here or in another process."""
        with self._changing(job_id):
            job = self.get(job_id)
            if job.status in RUNNING:
                raise JobConflict(f"Job {job_id} is {job.status}")
            # Deleted from another machine than its Host, its media are left on that one.
            if self._dir(job_id).is_dir():
                with self.running(job_id):
                    shutil.rmtree(self._dir(job_id))
            self._documents.delete_under(job_id)
            self._edits = {key: saved for key, saved in self._edits.items() if key[0] != job_id}
            self._tell(job_id, None)

    @contextmanager
    def watch(self, listener: JobListener) -> Iterator[None]:
        """Call `listener` with every change this store makes to a Job, until the block ends.

        It is called on the thread making the change (the worker's, mostly), while the store's lock
        is held, so a Job's changes arrive in order, and once the change is saved; it must return
        quickly. Changes made by another process, such as a CLI run, or on another machine aren't
        seen: re-read the Job now and then to catch those.
        """
        with self._listeners_lock:
            self._listeners = (*self._listeners, listener)
        try:
            yield
        finally:
            with self._listeners_lock:
                self._listeners = tuple(other for other in self._listeners if other is not listener)

    @contextmanager
    def _changing(self, job_id: str) -> Iterator[None]:
        """A block that reads the Job's documents and writes them back, with no other change to them
        in between, in this process or on another machine; listeners are told as it ends."""
        with self._lock:
            untold: list[tuple[str, Job | None]] = []
            self._change.untold = untold
            try:
                with self._doc(job_id, STATE_FILE).changing():
                    yield
            finally:
                del self._change.untold
            for told in untold:
                self._notify(*told)

    def _tell(self, job_id: str, job: Job | None) -> None:
        untold = getattr(self._change, "untold", None)
        if untold is None:
            self._notify(job_id, job)
        else:
            untold.append((job_id, job))

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
        """The Job's directory, with its media. JobElsewhere when other machines read the Jobs'
        documents too and this one hasn't the directory: the Job was made on another."""
        path = self._dir(job_id)
        if self.machine is not None and not path.is_dir():
            raise JobElsewhere(job_id)
        return path

    def here(self, job_id: str) -> bool:
        """Whether the Job's media are on this machine."""
        return self.machine is None or self._dir(job_id).is_dir()

    def _dir(self, job_id: str) -> Path:
        if not _JOB_ID.fullmatch(job_id):
            raise JobNotFound(job_id)
        return self.root / job_id

    def documents(self, job_id: str) -> Documents:
        """The Job's documents, by their paths in its directory: for what else is kept with a Job."""
        self._dir(job_id)
        return self._documents.under(job_id)

    def _doc(self, job_id: str, name: str) -> Document:
        self._dir(job_id)
        return self._documents.doc(f"{job_id}/{name}")

    def save_transcript(self, job_id: str, transcript: Transcript) -> None:
        self._doc(job_id, TRANSCRIPT_FILE).write(_TRANSCRIPT.dump_json(transcript))

    def load_transcript(self, job_id: str) -> Transcript | None:
        saved = self._doc(job_id, TRANSCRIPT_FILE).read()
        return None if saved is None else _TRANSCRIPT.validate_json(saved)

    def has_transcript(self, job_id: str) -> bool:
        """Whether the Job's transcript is saved, without reading it."""
        return self._doc(job_id, TRANSCRIPT_FILE).version() is not None

    def save_candidates(self, job_id: str, candidates: list[Candidate]) -> None:
        self._doc(job_id, CANDIDATES_FILE).write(_CANDIDATES.dump_json(candidates, indent=2))

    def load_candidates(self, job_id: str) -> list[Candidate] | None:
        saved = self._doc(job_id, CANDIDATES_FILE).read()
        if saved is None:
            return None
        sizes = self._sizes()
        return _CANDIDATES.validate_python([migrated_candidate(c, sizes) for c in json.loads(saved)])

    def change_candidates[R](
        self,
        job_id: str,
        change: Callable[[Job, list[Candidate]], tuple[list[Candidate], R]],
        *,
        expect: Collection[JobStatus] | None = None,
        edit: Edit = Edit(),
    ) -> R:
        """Save the Candidates `change` makes of the Job's, and return what else it returns. This
        happens under the store's lock, so review edits and a run of Selection never overwrite each
        other's Candidates. Like any change to the Job, it moves `updated_at` and listeners are told.
        Each Candidate it gives a new Revision is recorded as saved by `edit` (see `edit_of`). With
        `expect`, as `update`."""
        with self._changing(job_id):
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            before = self.load_candidates(job_id) or []
            candidates, result = change(job, before)
            self.save_candidates(job_id, candidates)
            previous = {candidate.id: candidate for candidate in before}
            now = datetime.now(UTC)
            for candidate in candidates:
                old = previous.get(candidate.id)
                if old is not None and old.revision == candidate.revision:
                    continue
                if old is not None:
                    history = recorded(self.revision_history(job_id, old.id), old, candidate, edit, self._saved(job_id, old), now)
                    self._save_history(job_id, old.id, history)
                self._edits[(job_id, candidate.id)] = (candidate.revision, edit, now)
            self._save(replace(job, updated_at=now))
            return result

    def revision_history(self, job_id: str, candidate_id: str) -> list[HistoryEntry]:
        """The Candidate's Revision History, oldest first; empty until it is first changed."""
        saved = self._doc(job_id, f"{REVISIONS_DIR}/{candidate_id}.json").read()
        if saved is None:
            return []
        entries, sizes = json.loads(saved), self._sizes()
        return _HISTORY.validate_python([entry | {"candidate": migrated_candidate(entry["candidate"], sizes)} for entry in entries])

    def _save_history(self, job_id: str, candidate_id: str, history: list[HistoryEntry]) -> None:
        self._doc(job_id, f"{REVISIONS_DIR}/{candidate_id}.json").write(_HISTORY.dump_json(history, indent=2))

    def edit_of(self, job_id: str, candidate_id: str, revision: int) -> Edit:
        """Who saved this Revision of the Candidate: unknown when it wasn't saved by this process."""
        saved, edit, _ = self._edits.get((job_id, candidate_id), (None, Edit(), None))
        return edit if saved == revision else Edit()

    def _saved(self, job_id: str, candidate: Candidate) -> tuple[Edit, datetime | None]:
        """Who saved the Candidate as it is, and when: unknown when it wasn't saved by this process."""
        saved, edit, at = self._edits.get((job_id, candidate.id), (None, Edit(), None))
        return (edit, at) if saved == candidate.revision else (Edit(), None)

    def load_clips(self, job_id: str) -> list[Clip]:
        saved = self._doc(job_id, CLIPS_FILE).read()
        if saved is None:
            return []
        sizes = self._sizes()
        return _CLIPS.validate_python([migrated_clip(clip, sizes) for clip in json.loads(saved)])

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
        with self._changing(job_id):
            job = self.get(job_id)
            if expect is not None and job.status not in expect:
                raise JobConflict(f"Job {job_id} is {job.status}")
            clips, changes, result = change(job, self.load_clips(job_id))
            self._doc(job_id, CLIPS_FILE).write(_CLIPS.dump_json(clips, indent=2))
            self._save(_changed(job, changes))
            return result

    def save_selection(self, job_id: str, selection: Selection) -> None:
        self._doc(job_id, SELECTION_FILE).write(_SELECTION.dump_json(selection, indent=2))

    def load_selection(self, job_id: str) -> Selection | None:
        saved = self._doc(job_id, SELECTION_FILE).read()
        return None if saved is None else _SELECTION.validate_json(saved)

    def save_scores(self, job_id: str, scores: dict[str, ScoreResponse]) -> None:
        self._doc(job_id, SCORES_FILE).write(_SCORES.dump_json(scores))

    def load_scores(self, job_id: str) -> dict[str, ScoreResponse]:
        """The kept Score answers; none when they were kept under response schemas that have changed since."""
        saved = self._doc(job_id, SCORES_FILE).read()
        try:
            return {} if saved is None else _SCORES.validate_json(saved)
        except ValidationError:
            return {}

    def discard_scores(self, job_id: str) -> None:
        self._doc(job_id, SCORES_FILE).delete()

    def _sizes(self) -> Sizes:
        """The Media Library's sizes for one read, read only if it holds a Candidate of an older shape."""
        return _MediaSizes(self._media_sizes)

    def _save(self, job: Job) -> None:
        self._doc(job.id, STATE_FILE).write(_JOB.dump_json(job, indent=2))
        self._tell(job.id, job)


class _MediaSizes(Mapping[str, tuple[int, int]]):
    """The Media Library's picture sizes, read only when a Candidate in an older shape needs one."""

    def __init__(self, load: Callable[[], Sizes]) -> None:
        self._load = load

    @cached_property
    def _sizes(self) -> Sizes:
        return self._load()

    def __getitem__(self, media_id: str) -> tuple[int, int]:
        return self._sizes[media_id]

    def __iter__(self) -> Iterator[str]:
        return iter(self._sizes)

    def __len__(self) -> int:
        return len(self._sizes)


def _changed(job: Job, changes: dict[str, Any]) -> Job:
    """The Job with `changes` applied, now; a status change is appended to its history."""
    now = datetime.now(UTC)
    if changes.get("status", job.status) != job.status:
        changes = changes | {"history": [*job.history, StatusChange(changes["status"], now)]}
    return replace(job, **changes, updated_at=now)


def _parse_job(data: bytes) -> Job:
    """A stored Job. Jobs saved before Selection existed ended in `transcribed`: they are read as
    having stopped before analyzing, so re-running that stage takes them on to review. Those saved
    before Templates have none."""
    state = json.loads(data)
    # A Job made before Templates has none.
    state["options"].setdefault("template", None)
    if state["status"] != "transcribed":
        return _JOB.validate_python(state)
    hint = f"Not analyzed yet: run `make reanalyze JOB={state['id']}`"
    for change in state["history"]:
        if change["status"] == "transcribed":
            change["status"] = JobStatus.ERROR
    return _JOB.validate_python(state | {"status": JobStatus.ERROR, "stage": JobStatus.ANALYZING, "error": hint})
