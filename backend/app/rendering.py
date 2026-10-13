"""The render queue: Candidates asked to be rendered in review become Clips, rendered one at a time.

A request queues a Clip per Candidate in the Job's clips.json and puts the Job in `rendering`. The
worker (or the CLI) then renders the Job's queued Clips one after another, the earliest asked for
first, and puts the Job back in `review` when none is left. The owner can go on reviewing meanwhile.
Each render uses the Candidate as it is when its render starts, and replaces the Candidate's
previous Clip once it is done.
"""

import logging
import time
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime

from pydantic import TypeAdapter

from app.candidates import Candidate
from app.clips import CLIPS_DIR, Clip, ClipStatus, RenderedClip, clip_files
from app.config import Settings
from app.jobs import Job, JobStatus, JobStore
from app.planner import RenderPlan, plan_render
from app.renderer import Renderer, RenderStopped
from app.review import CandidateNotFound
from app.storage import write_atomic
from app.video_source import probe

logger = logging.getLogger(__name__)

# The statuses in which Candidates can be asked to be rendered.
RENDERABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})

_PLAN = TypeAdapter(RenderPlan)


class NothingToRender(ValueError):
    pass


class Renders:
    def __init__(self, store: JobStore, settings: Settings) -> None:
        self.store = store
        self.settings = settings
        self.renderer = Renderer(settings.ffmpeg_bin, settings.render)

    def request(self, job_id: str, candidate_ids: list[str] | None = None) -> bool:
        """Queue the Candidates' Clips: those of `candidate_ids`, or of the selected Candidates. A Clip
        already queued keeps its place; one being rendered is rendered again after. Returns whether
        the Job has just started rendering, so that it needs running. Raises JobConflict unless the
        Job is in review or rendering, CandidateNotFound and NothingToRender."""

        def queue(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, bool]:
            candidates = self.store.load_candidates(job_id) or []
            ids = [c.id for c in candidates if c.selected] if candidate_ids is None else list(dict.fromkeys(candidate_ids))
            if not ids:
                raise NothingToRender("Select at least one Candidate to render")
            known = {candidate.id for candidate in candidates}
            if missing := [id for id in ids if id not in known]:
                raise CandidateNotFound(missing[0])
            now = datetime.now(UTC)
            by_id = {clip.candidate_id: clip for clip in clips}
            for id in ids:
                old = by_id.get(id)
                if old is None:
                    by_id[id] = Clip(id, ClipStatus.QUEUED, now)
                elif old.status is ClipStatus.RENDERING:
                    by_id[id] = replace(old, requested_at=now)
                elif old.status is not ClipStatus.QUEUED:
                    by_id[id] = replace(old, status=ClipStatus.QUEUED, requested_at=now, error=None)
            starting = job.status is JobStatus.REVIEW
            changes = {"status": JobStatus.RENDERING, "stage": JobStatus.RENDERING} if starting else {}
            return list(by_id.values()), changes, starting

        return self.store.change_clips(job_id, queue, expect=RENDERABLE)

    def run(self, job_id: str, rendered: Callable[[Clip, Candidate], None] = lambda clip, candidate: None) -> int:
        """Render the Job's queued Clips one at a time, including those queued meanwhile, then put the
        Job back in review. `rendered` is called with each Clip as its render ends, done or failed.
        Returns how many were rendered. Raises JobConflict when another process is rendering the Job,
        and RenderStopped when the app stops: the Clip being rendered is queued again at the next start."""
        with self.store.running(job_id):
            count = 0
            while (started := self._next(job_id, count)) is not None:
                job, clip, candidate = started
                clip = self._render(job, clip, candidate)
                count += 1
                rendered(clip, candidate)
            return count

    def recover(self, job_id: str) -> None:
        """Queue again the Clips a previous process left being rendered."""

        def requeue(_: Job, clips: list[Clip]) -> tuple[list[Clip], dict, None]:
            return [
                replace(clip, status=ClipStatus.QUEUED) if clip.status is ClipStatus.RENDERING else clip for clip in clips
            ], {}, None

        self.store.change_clips(job_id, requeue, expect={JobStatus.RENDERING})

    def stop(self) -> None:
        self.renderer.stop()

    def _next(self, job_id: str, count: int) -> tuple[Job, Clip, Candidate] | None:
        """Start the earliest queued Clip, with the Candidate as it is now; or, with none left, put the
        Job back in review. A Clip whose Candidate is gone fails."""

        def start(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, tuple[Job, Clip, Candidate] | None]:
            candidates = {candidate.id: candidate for candidate in self.store.load_candidates(job_id) or []}
            queued = sorted((clip for clip in clips if clip.status is ClipStatus.QUEUED), key=lambda c: c.requested_at)
            for clip in queued:
                if (candidate := candidates.get(clip.candidate_id)) is None:
                    clips = _put(clips, replace(clip, status=ClipStatus.ERROR, error="Its Candidate no longer exists"))
                    continue
                started = replace(clip, status=ClipStatus.RENDERING, error=None)
                name = candidate.title or f"clip {candidate.id}"
                message = f"Rendering clip {count + 1} of {count + len(queued)}: {name}"
                return _put(clips, started), {"progress": 0.0, "message": message}, (job, started, candidate)
            changes = {"status": JobStatus.REVIEW, "stage": None, "progress": None, "message": None}
            return clips, changes, None

        return self.store.change_clips(job_id, start, expect={JobStatus.RENDERING})

    def _render(self, job: Job, clip: Clip, candidate: Candidate) -> Clip:
        """Render one Clip, and record how it went. A Clip asked for again while it rendered is queued again."""
        assert job.source is not None
        job_dir = self.store.job_dir(job.id)
        (job_dir / CLIPS_DIR).mkdir(exist_ok=True)
        video, poster, plan_file = clip_files(candidate.id)
        plan = plan_render(candidate.start, candidate.end, job.source.metadata)
        write_atomic(job_dir / plan_file, _PLAN.dump_json(plan, indent=2))

        shown = 0

        def progress(done: float) -> None:
            nonlocal shown
            if (percent := int(100 * done)) > shown:
                shown = percent
                self.store.update(job.id, progress=float(percent))

        began = time.monotonic()
        try:
            encoder = self.renderer.render(job_dir / job.source.video, plan, job_dir / video, job_dir / poster, progress)
            duration = probe(self.settings.ffprobe_bin, job_dir / video).duration
        except RenderStopped:
            raise
        except Exception as exc:
            logger.exception("Job %s: rendering Candidate %s failed", job.id, candidate.id)
            outcome = replace(clip, status=ClipStatus.ERROR, error=str(exc))
        else:
            secs = time.monotonic() - began
            size = (job_dir / video).stat().st_size
            output = RenderedClip(
                start=candidate.start,
                end=candidate.end,
                hook_text=candidate.hook_text,
                layout=candidate.layout,
                video=video,
                poster=poster,
                plan=plan_file,
                duration=duration,
                size_bytes=size,
                encoder=encoder,
                render_secs=round(secs, 1),
                at=datetime.now(UTC),
            )
            logger.info(
                "Job %s: rendered Candidate %s (%.1f s) in %.1f s with %s, %.1f MB",
                job.id, candidate.id, duration, secs, encoder, size / 1e6,
            )
            outcome = replace(clip, status=ClipStatus.DONE, output=output, error=None)

        def finish(_: Job, clips: list[Clip]) -> tuple[list[Clip], dict, Clip]:
            now = next(c for c in clips if c.candidate_id == clip.candidate_id)
            again = now.requested_at > clip.requested_at
            ended = replace(outcome, status=ClipStatus.QUEUED if again else outcome.status, requested_at=now.requested_at)
            return _put(clips, ended), {}, ended

        return self.store.change_clips(job.id, finish)


def ranked_clips(clips: list[Clip], candidates: list[Candidate]) -> list[Clip]:
    """The Clips in their Candidates' order (by score, then the manual ones); any whose Candidate is gone last."""
    rank = {candidate.id: i for i, candidate in enumerate(candidates)}
    return sorted(clips, key=lambda clip: rank.get(clip.candidate_id, len(rank)))


def _put(clips: list[Clip], new: Clip) -> list[Clip]:
    return [new if clip.candidate_id == new.candidate_id else clip for clip in clips]
