"""Runs a Job's stages in order, recording each status change in the Job store.

A Job resumes where it stopped: a run skips the stages whose output is complete (see `_done`).
"""

import hashlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta

from app.audio import SileroVad, chunks
from app.config import LlmChoice, Settings
from app.fewshot import FEWSHOT_DIR, few_shot_examples
from app.jobs import TRANSCRIPT_FILE, Job, JobStatus, JobStore, JobWarning, QuotaWait
from app.llm import DetailResponse, Llm, LlmRequest, Overloaded, PacedLlm, QuotaExceeded, ScoreResponse
from app.ports import Ports
from app.prompts import PROMPT_VERSION
from app.selection import select
from app.transcriber import TranscriptionStalled, Watchdog
from app.transcript import Transcript, parse_json3

logger = logging.getLogger(__name__)

DOWNLOAD_HINT = "If YouTube changed something, updating the downloader may fix it: run `make update-ytdlp`, then retry."


class Pipeline:
    def __init__(self, store: JobStore, ports: Ports, settings: Settings) -> None:
        self.store = store
        self.ports = ports
        self.settings = settings
        self.llm = PacedLlm(ports.llm, settings.quota.request_interval_secs)
        self.stages: list[tuple[JobStatus, Callable[[Job], Job]]] = [
            (JobStatus.DOWNLOADING, self._download),
            (JobStatus.TRANSCRIBING, self._transcribe),
            (JobStatus.ANALYZING, self._analyze),
        ]

    def run(self, job_id: str) -> Job:
        """Run the Job's stages from the first whose output isn't complete: from the stage it failed
        in, was interrupted in or waited for Gemini in, or from analyzing for a Job in review.

        Ends in `review`, `error` or `waiting_quota`. Raises JobConflict when another process is
        running the Job.
        """
        with self.store.running(job_id):
            return self._run(job_id)

    def run_until_done(self, job_id: str, waiting: Callable[[Job], None] = lambda job: None) -> Job:
        """`run`, sleeping through the waits for Gemini: for the CLI and the eval, which have no worker
        to come back to the Job. `waiting` is called with the Job as each wait starts. Ends in
        `review` or `error`."""
        with self.store.running(job_id):
            while (job := self._run(job_id)).status is JobStatus.WAITING_QUOTA:
                assert job.quota is not None
                waiting(job)
                time.sleep(max(0.0, (job.quota.retry_at - datetime.now(UTC)).total_seconds()))
            return job

    def _run(self, job_id: str) -> Job:
        job = self.store.get(job_id)
        start = next(i for i, (stage, _) in enumerate(self.stages) if not self._done(job, stage))
        for stage, run_stage in self.stages[start:]:
            logger.info("Job %s: %s", job_id, stage)
            job = self.store.update(
                job_id,
                status=stage,
                stage=stage,
                error=None,
                progress=None,
                message=None,
                warnings=[warning for warning in job.warnings if warning.stage is not stage],
            )
            try:
                job = run_stage(job)
            except (QuotaExceeded, Overloaded) as exc:
                return self._wait_for_gemini(job_id, exc)
            except Exception as exc:
                logger.exception("Job %s failed while %s", job_id, stage)
                error = str(exc) or type(exc).__name__
                if stage is JobStatus.DOWNLOADING:
                    error = f"{error.rstrip('. ')}. {DOWNLOAD_HINT}"
                return self.store.update(job_id, status=JobStatus.ERROR, error=error, message=None, quota=None)
        logger.info("Job %s: %s", job_id, JobStatus.REVIEW)
        return self.store.update(
            job_id, status=JobStatus.REVIEW, stage=None, progress=None, message=None, quota=None
        )

    def _done(self, job: Job, stage: JobStatus) -> bool:
        """Whether a stage's output is complete, so that a run can skip it.

        Downloading is complete once the Video Source has returned, which is when `job.source` is
        recorded (a half-written or interrupted download never has it), and the files it names
        exist. Transcribing is complete once transcript.json exists: it is written whole, as the
        stage's last step. Analyzing, the last stage, always runs.
        """
        job_dir = self.store.job_dir(job.id)
        if stage is JobStatus.DOWNLOADING:
            return job.source is not None and all(
                (job_dir / name).is_file() for name in (job.source.video, job.source.caption_track) if name
            )
        if stage is JobStatus.TRANSCRIBING:
            return (job_dir / TRANSCRIPT_FILE).is_file()
        return False

    def _wait_for_gemini(self, job_id: str, exc: QuotaExceeded | Overloaded) -> Job:
        """Put the Job in `waiting_quota`, as Gemini's quota is used up or Gemini stays busy: for the
        wait the quota error suggests, else for one that doubles with each such error in a row (see
        QuotaTuning). Or in `error` once they have gone on for too long. A run of errors starts over
        when a Score batch was answered since the last one."""
        tuning = self.settings.quota
        job = self.store.get(job_id)
        now = datetime.now(UTC)
        scored = len(self.store.load_scores(job_id))
        if job.quota is None or scored > job.quota.scored:
            since, errors = now, 0
        else:
            since, errors = job.quota.since, job.quota.errors
        if (now - since).total_seconds() >= tuning.give_up_secs:
            name = self.settings.llm_name
            logger.warning("Job %s: gave up waiting for %s after %d errors", job_id, name, errors + 1)
            what = f"{name}'s quota" if isinstance(exc, QuotaExceeded) else name
            error = f"Gave up after waiting {_duration(tuning.give_up_secs)} for {what}. {exc}"
            return self.store.update(job_id, status=JobStatus.ERROR, error=error, message=None, quota=None)
        if isinstance(exc, QuotaExceeded) and exc.retry_after is not None:
            delay = exc.retry_after + tuning.retry_margin_secs
        else:
            delay = min(tuning.max_wait_secs, tuning.wait_secs * 2**errors)
        retry_at = now + timedelta(seconds=delay)
        message = f"Trying again at {retry_at.astimezone():%H:%M:%S} (in {_duration(delay)}). {exc}"
        logger.warning("Job %s: %s", job_id, message)
        return self.store.update(
            job_id, status=JobStatus.WAITING_QUOTA, quota=QuotaWait(since, errors + 1, retry_at, scored), message=message
        )

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
                    warning = JobWarning(JobStatus.TRANSCRIBING, str(stalled))
                    job = self.store.update(job.id, warnings=[*job.warnings, warning])
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

    def _analyze(self, job: Job) -> Job:
        """Selection on the Job's Transcript. The Score pass's answers are kept as they come in
        (see `_KeptScores`) until the stage completes, so that a run resumed after a quota wait or an
        error doesn't send the batches it already has again."""
        assert job.source is not None
        transcript = self.store.load_transcript(job.id)
        assert transcript is not None

        def progress(message: str, percent: float | None = None) -> None:
            if percent is None:
                self.store.update(job.id, message=message)
            else:
                self.store.update(job.id, message=message, progress=round(percent, 1))

        examples, warnings = few_shot_examples(
            self.settings.reference_set,
            self.ports.video_source,
            self.settings.data_dir / FEWSHOT_DIR,
            job.options.language,
            self.settings.selection,
            progress,
        )
        if warnings:
            job = self.store.update(
                job.id, warnings=[*job.warnings, *(JobWarning(JobStatus.ANALYZING, w) for w in warnings)]
            )
        selection = select(
            _KeptScores(self.llm, self.store, job.id, self.settings.llm),
            self.settings.selection,
            transcript,
            duration=job.source.metadata.duration,
            min_secs=job.options.min_secs,
            max_secs=job.options.max_secs,
            profile=job.profile,
            brief=job.options.brief,
            examples=examples,
            progress=progress,
        )
        selection = replace(selection, llm=self.settings.llm)
        self.store.save_selection(job.id, selection)
        self.store.save_candidates(job.id, selection.candidates)
        self.store.discard_scores(job.id)
        logger.info(
            "Job %s: %d Candidates from %d Windows and %d few-shot examples (prompt %s, %s)",
            job.id, len(selection.candidates), len(selection.windows), len(examples), selection.prompt_version,
            selection.llm,
        )
        return self.store.update(job.id, prompt_version=selection.prompt_version)


class _KeptScores:
    """The LLM port, with each Score answer kept in the Job's scores.json as it comes in.

    An answer is kept under a hash of all that shaped it: the prompt version, the LLM (provider,
    model and thinking), the temperature and the prompt itself, which holds the Windows' text and
    times (so the Transcript and the Window tuning), the language, the duration range, the profile
    summary and the Brief. A change to any of them asks again.
    """

    def __init__(self, llm: Llm, store: JobStore, job_id: str, choice: LlmChoice) -> None:
        self.llm = llm
        self.store = store
        self.job_id = job_id
        self.choice = choice
        self.answers = store.load_scores(job_id)

    def score(self, request: LlmRequest) -> ScoreResponse:
        key = hashlib.sha256(
            json.dumps([PROMPT_VERSION, asdict(self.choice), request.temperature, request.prompt]).encode()
        ).hexdigest()
        if (answer := self.answers.get(key)) is None:
            answer = self.answers[key] = self.llm.score(request)
            self.store.save_scores(self.job_id, self.answers)
        return answer

    def detail(self, request: LlmRequest) -> DetailResponse:
        return self.llm.detail(request)


def _duration(seconds: float) -> str:
    """A duration such as "45 s", "15 min" or "24 h"."""
    if seconds < 60:
        return f"{seconds:.3g} s"
    if seconds < 3600:
        return f"{seconds / 60:.3g} min"
    return f"{seconds / 3600:.3g} h"
