"""Runs a Job's stages in order, recording each status change in the Job store."""

import logging
from collections.abc import Callable

from app.jobs import Job, JobStatus, JobStore
from app.ports import Ports
from app.transcript import parse_json3

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, store: JobStore, ports: Ports) -> None:
        self.store = store
        self.ports = ports
        self.stages: list[tuple[JobStatus, Callable[[Job], Job]]] = [
            (JobStatus.DOWNLOADING, self._download),
            (JobStatus.TRANSCRIBING, self._transcribe),
        ]

    def run(self, job_id: str) -> Job:
        job = self.store.get(job_id)
        for stage, run_stage in self.stages:
            logger.info("Job %s: %s", job_id, stage)
            job = self.store.update(job_id, status=stage, stage=stage)
            try:
                job = run_stage(job)
            except Exception as exc:
                logger.exception("Job %s failed while %s", job_id, stage)
                return self.store.update(job_id, status=JobStatus.ERROR, error=str(exc) or type(exc).__name__)
        logger.info("Job %s: %s", job_id, JobStatus.TRANSCRIBED)
        return self.store.update(job_id, status=JobStatus.TRANSCRIBED, stage=None)

    def _download(self, job: Job) -> Job:
        source = self.ports.video_source.fetch(job.url, job.options.language, self.store.job_dir(job.id))
        return self.store.update(job.id, source=source)

    def _transcribe(self, job: Job) -> Job:
        assert job.source is not None
        if job.source.caption_track is None:
            raise RuntimeError(f"No '{job.options.language}' auto-captions, and local transcription isn't available yet")
        track = self.store.job_dir(job.id) / job.source.caption_track
        self.store.save_transcript(job.id, parse_json3(track.read_bytes(), job.options.language))
        return job
