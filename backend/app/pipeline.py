"""Runs a Job's stages in order, recording each status change in the Job store."""

import logging
import time
from collections.abc import Callable

from app.audio import SileroVad, chunks
from app.config import Settings
from app.jobs import Job, JobStatus, JobStore
from app.ports import Ports
from app.transcriber import TranscriptionStalled, Watchdog
from app.transcript import Transcript, parse_json3

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, store: JobStore, ports: Ports, settings: Settings) -> None:
        self.store = store
        self.ports = ports
        self.settings = settings
        self.stages: list[tuple[JobStatus, Callable[[Job], Job]]] = [
            (JobStatus.DOWNLOADING, self._download),
            (JobStatus.TRANSCRIBING, self._transcribe),
        ]

    def run(self, job_id: str) -> Job:
        job = self.store.get(job_id)
        for stage, run_stage in self.stages:
            logger.info("Job %s: %s", job_id, stage)
            job = self.store.update(job_id, status=stage, stage=stage, progress=None, message=None)
            try:
                job = run_stage(job)
            except Exception as exc:
                logger.exception("Job %s failed while %s", job_id, stage)
                error = str(exc) or type(exc).__name__
                return self.store.update(job_id, status=JobStatus.ERROR, error=error, message=None)
        logger.info("Job %s: %s", job_id, JobStatus.TRANSCRIBED)
        return self.store.update(job_id, status=JobStatus.TRANSCRIBED, stage=None, progress=None, message=None)

    def _download(self, job: Job) -> Job:
        source = self.ports.video_source.fetch(job.url, job.options.language, self.store.job_dir(job.id))
        return self.store.update(job.id, source=source)

    def _transcribe(self, job: Job) -> Job:
        assert job.source is not None
        if job.source.caption_track is None or job.options.transcribe_locally:
            return self._transcribe_locally(job)
        track = self.store.job_dir(job.id) / job.source.caption_track
        self.store.save_transcript(job.id, parse_json3(track.read_bytes(), job.options.language))
        return job

    def _transcribe_locally(self, job: Job) -> Job:
        """The whole Source through the Transcriber, in chunks cut at pauses, each under the watchdog.

        A chunk the watchdog gives up on is left out, with a warning on the Job.
        """
        assert job.source is not None
        media = self.store.job_dir(job.id) / job.source.video
        duration = job.source.metadata.duration
        language = job.options.language
        tuning = self.settings.transcription
        reason = "YouTube captions ignored" if job.source.caption_track else f"no '{language}' YouTube captions"
        job = self.store.update(
            job.id,
            progress=0.0,
            message=f"Transcribing the whole episode locally ({reason}). "
            "Close heavy apps such as browsers and editors to free memory.",
        )

        watchdog = Watchdog(self.ports.transcriber, tuning)
        ranges = chunks(
            self.settings.ffmpeg_bin, media, duration, SileroVad(), tuning.chunk_secs, tuning.cut_search_secs
        )
        parts: list[Transcript] = []
        began = time.monotonic()
        try:
            for start, end in ranges:
                try:
                    parts.append(watchdog.transcribe(media, language, start, end))
                except TranscriptionStalled as stalled:
                    job = self.store.update(job.id, warnings=[*job.warnings, str(stalled)])
                job = self.store.update(job.id, progress=round(100 * end / duration, 1))
        finally:
            self.ports.transcriber.stop()  # frees the model's memory for the stages after this one

        transcript = Transcript(
            language=language,
            source="whisper",
            words=[word for part in parts for word in part.words],
            segments=[segment for part in parts for segment in part.segments],
        )
        self.store.save_transcript(job.id, transcript)
        elapsed = time.monotonic() - began
        logger.info(
            "Job %s: transcribed %.0f s locally in %.0f s (%.2fx realtime), %d words",
            job.id, duration, elapsed, duration / max(elapsed, 1e-6), len(transcript.words),
        )
        return job
