"""HTTP API routes. Services come from `app.state`, set up by `create_app`."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, FiniteFloat, StringConstraints

from app import review
from app.candidates import Candidate, Layout
from app.clips import Clip
from app.config import Settings
from app.events import job_events
from app.jobs import Job, JobConflict, JobNotFound, JobOptions, JobStatus, JobStore
from app.profile import ChannelProfile, ProfileStore
from app.rendering import NothingToRender, ranked_clips
from app.review import CandidateChange, CandidateNotFound, Episode, InvalidEdit
from app.storage import DiskUsage, disk_usage
from app.transcript import Transcript
from app.worker import Worker

router = APIRouter(prefix="/api")
media = APIRouter(prefix="/media")

# The statuses in which the owner can change a Job's Candidates: not before the Job has them, nor
# while it is analyzed again and its untouched Candidates are about to be replaced. Review goes on
# while Clips render; each render takes its Candidate as it is when the render starts.
EDITABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})
# What /media serves from a Job's directory: its video, and its Clips and their posters.
MEDIA_SUFFIXES = frozenset({".mp4", ".m4a", ".jpg", ".png"})
# The longest hook text accepted; the UI warns well before this, at about 40 characters.
HOOK_MAX_CHARS = 200


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _worker(request: Request) -> Worker:
    return request.app.state.worker


def _profiles(request: Request) -> ProfileStore:
    return request.app.state.profiles


def _job(job_id: str, request: Request) -> Job:
    """The Job, or a 404. For streaming routes, which can't answer 404 once they have started."""
    try:
        return _store(request).get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None


AppSettings = Annotated[Settings, Depends(_settings)]
Store = Annotated[JobStore, Depends(_store)]
JobWorker = Annotated[Worker, Depends(_worker)]
Profiles = Annotated[ProfileStore, Depends(_profiles)]
ExistingJob = Annotated[Job, Depends(_job)]


class JobRequest(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    options: JobOptions = JobOptions()


class CandidateUpdate(BaseModel):
    """A review edit; a field left out stays as it is. `start` and `end` are snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat | None = None
    end: FiniteFloat | None = None
    hook_text: Annotated[str, StringConstraints(max_length=HOOK_MAX_CHARS)] | None = None
    layout: Layout | None = None
    selected: bool | None = None


class ManualCandidate(BaseModel):
    """A transcript range to make a manual Candidate of, snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat
    end: FiniteFloat


class RenderRequest(BaseModel):
    """The Candidates to render; the selected ones when left out."""

    model_config = ConfigDict(extra="forbid")

    candidate_ids: list[str] | None = None


@dataclass(frozen=True)
class JobDetail(Job):
    transcript: Transcript | None = None
    # Best first; None until the Job has been analyzed.
    candidates: list[Candidate] | None = None
    # In their Candidates' order.
    clips: list[Clip] = field(default_factory=list)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/jobs", status_code=201)
def create_job(body: JobRequest, store: Store, profiles: Profiles, worker: JobWorker) -> Job:
    job = store.create(body.url, body.options, profiles.load())
    worker.submit(job.id)
    return job


@router.get("/jobs")
def list_jobs(store: Store) -> list[Job]:
    return store.all()


@router.get("/jobs/{job_id}")
def get_job(job_id: str, store: Store) -> JobDetail:
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    candidates = store.load_candidates(job_id)
    return JobDetail(
        **vars(job),
        transcript=store.load_transcript(job_id),
        candidates=candidates,
        clips=ranked_clips(store.load_clips(job_id), candidates or []),
    )


@router.get("/jobs/{job_id}/events", response_class=EventSourceResponse)
async def stream_job_events(job: ExistingJob, store: Store) -> AsyncIterator[ServerSentEvent]:
    """The Job's progress (status, stage, percent, message, error, warnings, retry_at) as `job`
    events: one now, then one per change. The stream ends with an `end` event once the Job is in
    review or error, or is deleted; after a retry, open it again."""
    async for event in job_events(store, job.id):
        yield event


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, worker: JobWorker) -> Job:
    """Queue a Job in `error` again. It resumes from the stage it failed in."""
    try:
        return worker.retry(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: only a Job in error can be retried") from None


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, store: Store) -> None:
    """Delete a Job and all its files. Refused while one of its stages runs; a queued Job is
    deleted before it runs, and a Job waiting for quota stops waiting."""
    try:
        store.delete(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: wait until its stage ends or fails, then delete it") from None


@router.patch("/jobs/{job_id}/candidates/{candidate_id}")
def update_candidate(
    job_id: str, candidate_id: str, body: CandidateUpdate, store: Store, settings: AppSettings
) -> Candidate:
    """Change a Candidate's bounds (snapped to Words), hook text, layout or selected flag, and save it
    at once. 422 for a range that isn't a usable clip; 409 unless the Job is in review."""
    change = CandidateChange(**body.model_dump())
    return _review(
        store, settings, job_id, lambda candidates, episode: review.update(candidates, candidate_id, change, episode)
    )


@router.post("/jobs/{job_id}/candidates", status_code=201)
def add_candidate(job_id: str, body: ManualCandidate, store: Store, settings: AppSettings) -> Candidate:
    """Add a manual Candidate for a transcript range, snapped to Words, after the AI's Candidates."""
    return _review(
        store, settings, job_id, lambda candidates, episode: review.add_manual(candidates, body.start, body.end, episode)
    )


def _review(
    store: JobStore,
    settings: Settings,
    job_id: str,
    change: Callable[[list[Candidate], Episode], tuple[list[Candidate], Candidate]],
) -> Candidate:
    def edit(job: Job, candidates: list[Candidate]) -> tuple[list[Candidate], Candidate]:
        transcript = store.load_transcript(job.id)
        assert job.source is not None and transcript is not None  # a Job in review has both
        episode = Episode(transcript, job.source.metadata.duration, job.options.max_secs, settings.selection)
        return change(candidates, episode)

    try:
        return store.change_candidates(job_id, edit, expect=EDITABLE)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be changed while it is in review") from None
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/jobs/{job_id}/render")
def render(job_id: str, store: Store, worker: JobWorker, body: RenderRequest | None = None) -> list[Clip]:
    """Queue Clips of the selected Candidates (or of `candidate_ids`); the Job is `rendering` until
    they are done. A Candidate rendered before is rendered again, replacing its Clip. Returns the
    Job's Clips. 422 when no Candidate is selected; 409 unless the Job is in review or rendering."""
    try:
        worker.render(job_id, body.candidate_ids if body else None)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be rendered once it is in review") from None
    except NothingToRender as exc:
        raise HTTPException(422, str(exc)) from None
    return list_clips(job_id, store)


@router.get("/jobs/{job_id}/clips")
def list_clips(job_id: str, store: Store) -> list[Clip]:
    """The Job's Clips in their Candidates' order: the AI's by score, then the manual ones."""
    try:
        store.get(job_id)
        return ranked_clips(store.load_clips(job_id), store.load_candidates(job_id) or [])
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None


@router.get("/system/disk")
def disk(settings: AppSettings) -> DiskUsage:
    """The data directory's size, and the free space on its volume."""
    return disk_usage(settings.data_dir, settings.low_disk_bytes)


@router.get("/profile")
def get_profile(profiles: Profiles) -> ChannelProfile:
    return profiles.load()


@router.put("/profile")
def put_profile(profile: ChannelProfile, profiles: Profiles) -> ChannelProfile:
    """Replace the Channel Profile. New Jobs steer by it; existing Jobs keep their snapshot."""
    profiles.save(profile)
    return profile


@media.get("/{job_id}/{path:path}")
def media_file(job_id: str, path: str, store: Store) -> FileResponse:
    """A video or image from a Job's directory, with HTTP range support (206 Partial Content), so
    the browser's player can seek in a long Source. Only files inside that directory are served."""
    try:
        job_dir = store.job_dir(job_id).resolve()
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    file = (job_dir / path).resolve()
    if not (file.is_relative_to(job_dir) and file.suffix.lower() in MEDIA_SUFFIXES and file.is_file()):
        raise HTTPException(404, f"No media {path!r} in Job {job_id}")
    return FileResponse(file)
