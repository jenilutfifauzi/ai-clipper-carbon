"""HTTP API routes. Services come from `app.state`, set up by `create_app`."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, StringConstraints

from app.candidates import Candidate
from app.config import Settings
from app.jobs import Job, JobConflict, JobNotFound, JobOptions, JobStore
from app.profile import ChannelProfile, ProfileStore
from app.storage import DiskUsage, disk_usage
from app.transcript import Transcript
from app.worker import Worker

router = APIRouter(prefix="/api")


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _worker(request: Request) -> Worker:
    return request.app.state.worker


def _profiles(request: Request) -> ProfileStore:
    return request.app.state.profiles


AppSettings = Annotated[Settings, Depends(_settings)]
Store = Annotated[JobStore, Depends(_store)]
JobWorker = Annotated[Worker, Depends(_worker)]
Profiles = Annotated[ProfileStore, Depends(_profiles)]


class JobRequest(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    options: JobOptions = JobOptions()


@dataclass(frozen=True)
class JobDetail(Job):
    transcript: Transcript | None = None
    # Best first; None until the Job has been analyzed.
    candidates: list[Candidate] | None = None


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
    return JobDetail(
        **vars(job), transcript=store.load_transcript(job_id), candidates=store.load_candidates(job_id)
    )


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
