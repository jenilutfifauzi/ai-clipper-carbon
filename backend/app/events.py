"""A Job's progress as server-sent events, sent each time the Job changes."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime

from fastapi.sse import ServerSentEvent

from app.jobs import Job, JobNotFound, JobStatus, JobStore, JobWarning

# The statuses a Job stays in until the owner acts (reviews it, or retries it): the stream ends there.
SETTLED = frozenset({JobStatus.REVIEW, JobStatus.ERROR})
# How often the stream reads the Job again by itself. The store announces its own changes as they
# happen; this catches those made by another process, such as a CLI run.
RECHECK_SECS = 2.0


@dataclass(frozen=True)
class JobProgress:
    """What the Job page shows while a Job runs."""

    status: JobStatus
    stage: JobStatus | None
    progress: float | None
    message: str | None
    error: str | None
    warnings: list[JobWarning]
    # While waiting_quota: when the Job runs again.
    retry_at: datetime | None

    @classmethod
    def of(cls, job: Job) -> "JobProgress":
        return cls(
            status=job.status,
            stage=job.stage,
            progress=job.progress,
            message=job.message,
            error=job.error,
            warnings=job.warnings,
            retry_at=job.quota.retry_at if job.quota else None,
        )


async def job_events(store: JobStore, job_id: str, recheck_secs: float = RECHECK_SECS) -> AsyncIterator[ServerSentEvent]:
    """A `job` event with the Job's progress now, then one each time it changes. Once the Job is in
    review or error, an `end` event follows with its status, and the stream ends; also when the Job
    is deleted, with "deleted".

    Every change the store makes is sent, in order, even when they come faster than the client reads;
    a change that leaves the progress as it was (such as recording the Source) sends nothing.
    """
    loop = asyncio.get_running_loop()
    changes: asyncio.Queue[Job | None] = asyncio.Queue()

    def changed(changed_id: str, job: Job | None) -> None:
        if changed_id == job_id:
            with suppress(RuntimeError):  # the event loop has closed: the app is stopping
                loop.call_soon_threadsafe(changes.put_nowait, job)

    with store.watch(changed):
        # Read after subscribing, so that no change falls between the two.
        job = _read(store, job_id)
        sent = None
        while job is not None:
            progress = JobProgress.of(job)
            if progress != sent:
                yield ServerSentEvent(event="job", data=progress)
                sent = progress
            if job.status in SETTLED:
                yield ServerSentEvent(event="end", data=job.status)
                return
            try:
                change = await asyncio.wait_for(changes.get(), recheck_secs)
            except TimeoutError:
                change = _read(store, job_id)
            # A change announced after a recheck had already read a later one is stale.
            if change is None or change.updated_at >= job.updated_at:
                job = change
        yield ServerSentEvent(event="end", data="deleted")


def _read(store: JobStore, job_id: str) -> Job | None:
    try:
        return store.get(job_id)
    except JobNotFound:
        return None
