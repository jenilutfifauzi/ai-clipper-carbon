"""The single-worker queue: submitted Jobs run one at a time on a background thread.

A Job that runs out of Gemini quota, or finds Gemini busy, leaves the queue while it waits, so that
other Jobs' stages can run meanwhile, and is queued again when its wait is over.

Renders share the queue: a Job asked to render Clips is submitted like a new Job, and when its turn
comes the worker renders its queued Clips one after another. So only one heavy tool (yt-dlp's
merge, Whisper, Selection's requests or an ffmpeg encode) runs at a time, which an 8 GB Mac needs.
"""

import logging
import threading
from datetime import UTC, datetime
from queue import Queue

from app.jobs import RUNNING, Job, JobConflict, JobNotFound, JobStatus, JobStore
from app.pipeline import Pipeline
from app.renderer import RenderStopped
from app.rendering import Renders

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, store: JobStore, pipeline: Pipeline, renders: Renders) -> None:
        self._store = store
        self._pipeline = pipeline
        self._renders = renders
        self._queue: Queue[str | None] = Queue()
        self._stopping = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="job-worker", daemon=True)
        self._timers: dict[str, threading.Timer] = {}
        self._timers_lock = threading.Lock()

    def start(self) -> None:
        """Start, taking back the Jobs a previous process left unfinished: those queued or in a
        stage are queued again, oldest first, and those waiting for quota wait out what is left of
        their wait. A Job left rendering renders its queued Clips, and the one it was rendering, again.
        A Job that another process (a CLI run) is running is left to it."""
        resumed = {JobStatus.QUEUED, JobStatus.WAITING_QUOTA, JobStatus.RENDERING, *RUNNING}
        for job in sorted(self._store.all(), key=lambda job: job.created_at):
            if job.status not in resumed or self._store.busy(job.id):
                continue
            if job.status is JobStatus.WAITING_QUOTA:
                self._wake_later(job)
                continue
            if job.status is JobStatus.RENDERING:
                self._renders.recover(job.id)
                self.submit(job.id)
                continue
            if job.status is not JobStatus.QUEUED:
                logger.info("Job %s was left %s: queued again", job.id, job.status)
                self._store.update(job.id, status=JobStatus.QUEUED, stage=None, progress=None, message=None)
            self.submit(job.id)
        self._thread.start()

    def submit(self, job_id: str) -> None:
        self._queue.put(job_id)

    def retry(self, job_id: str) -> Job:
        """Queue a Job in `error` again; it resumes from the stage it failed in. Raises JobConflict
        for a Job in any other status."""
        job = self._store.update(
            job_id,
            expect={JobStatus.ERROR},
            status=JobStatus.QUEUED,
            stage=None,
            error=None,
            progress=None,
            message=None,
        )
        self.submit(job_id)
        return job

    def render(self, job_id: str, candidate_ids: list[str] | None = None) -> None:
        """Queue Clips of the Job's Candidates (see Renders.request); they are rendered in the Job's turn."""
        if self._renders.request(job_id, candidate_ids):
            self.submit(job_id)

    def stop(self, timeout: float = 5) -> None:
        """Stop after the running Job's stage, cutting a render short; Jobs still queued, waiting for
        quota or rendering are taken back at the next start."""
        self._stopping.set()
        with self._timers_lock:
            for timer in self._timers.values():
                timer.cancel()
        self._renders.stop()
        self._queue.put(None)
        self._thread.join(timeout)

    def _loop(self) -> None:
        while (job_id := self._queue.get()) is not None and not self._stopping.is_set():
            try:
                status = self._store.get(job_id).status
                if status is JobStatus.RENDERING:
                    self._renders.run(job_id)
                    continue
                if status is not JobStatus.QUEUED:
                    continue
                job = self._pipeline.run(job_id)
            except JobNotFound:
                logger.info("Job %s was deleted while queued", job_id)
            except JobConflict as exc:
                logger.warning("Skipped: %s", exc)
            except RenderStopped:
                logger.info("Job %s: rendering stopped; it resumes at the next start", job_id)
            except Exception:
                logger.exception("Job %s failed outside its stages", job_id)
            else:
                if job.status is JobStatus.WAITING_QUOTA:
                    self._wake_later(job)

    def _wake_later(self, job: Job) -> None:
        """Queue the Job again once its quota wait is over. While stopping, the next start does it."""
        assert job.quota is not None
        if self._stopping.is_set():
            return
        delay = max(0.0, (job.quota.retry_at - datetime.now(UTC)).total_seconds())
        timer = threading.Timer(delay, self._wake, args=(job.id,))
        timer.daemon = True
        with self._timers_lock:
            self._timers[job.id] = timer
        timer.start()

    def _wake(self, job_id: str) -> None:
        with self._timers_lock:
            self._timers.pop(job_id, None)
        try:
            self._store.update(
                job_id,
                expect={JobStatus.WAITING_QUOTA},
                status=JobStatus.QUEUED,
                stage=None,
                progress=None,
                message=None,
            )
        except (JobNotFound, JobConflict):
            return  # deleted, or run by a CLI meanwhile
        self.submit(job_id)
