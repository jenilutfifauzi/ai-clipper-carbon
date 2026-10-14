"""The render queue: Candidates asked to be rendered in review become Clips, rendered one at a time.

A request queues a Clip per Candidate in the Job's clips.json and puts the Job in `rendering`. The
worker (or the CLI) then renders the Job's queued Clips one after another, the earliest asked for
first, and puts the Job back in `review` when none is left. The owner can go on reviewing meanwhile.
Each render uses the Candidate as it is when its render starts, and replaces the Candidate's
previous Clip once it is done.

The clip editor can also queue a Candidate to be prepared: its Words transcribed and its range
analysed as a render would, without an encode, so that its preview (app/editor.py) shows the Clip's
own captions and Scenes. Preparations run before the queued Clips.

A Clip is captioned (unless its Job's captions are off) from a fresh transcription of its own range
and CAPTION_MARGIN_SECS either side, so that Whisper hears its first and last Words whole, in the
Job's language and under the watchdog. The Words are saved with the Job and reused while the Clip's
range, the language and the Whisper model stay the same (see `words_file`): a hook or layout edit
doesn't transcribe again, a bounds edit does. Whisper keeps its model loaded (about 2 GB) from one
Clip to the next and is stopped when the Job's queued Clips are done, which frees that memory. It
never runs at the same time as the face detection or an encode: each Clip's steps run one after another.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.analysis import Analyzer, ClipAnalysis, analysis_file
from app.candidates import Candidate
from app.clips import CLIPS_DIR, Clip, ClipStatus, RenderedClip, clip_files
from app.config import BLAZE_FACE_MODEL, AnalysisTuning, CameraTuning, Settings
from app.jobs import Job, JobStatus, JobStore, JobWarning
from app.planner import RenderPlan, plan_render, reframes
from app.renderer import Renderer, RenderStopped
from app.review import CandidateNotFound
from app.storage import write_atomic
from app.styles import PRESETS_FILE, PresetStore
from app.transcript import Transcript
from app.transcriber import Transcriber, TranscriptionStalled, TranscriptionStopped, Watchdog
from app.transcript import Word
from app.video_source import SourceMetadata, probe

logger = logging.getLogger(__name__)

# The statuses in which Candidates can be asked to be rendered.
RENDERABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})
# A Clip's captions are transcribed from this long before its start to this long after its end.
CAPTION_MARGIN_SECS = 2.0
WORDS_DIR = "words"


@dataclass(frozen=True)
class ClipWords:
    """The Words transcribed for a Clip's captions, in seconds into the Clip (those in the margins
    before and after it included), with the Clip's range on the Source's timeline, and the language
    and Whisper model they were transcribed with."""

    start: float
    end: float
    language: str
    model: str
    words: list[Word]


def words_file(start: float, end: float) -> str:
    """The cached caption Words of the Clip from `start` to `end` on the Source, relative to the Job's directory."""
    return f"{WORDS_DIR}/{round(start * 1000)}-{round(end * 1000)}.json"


_PLAN = TypeAdapter(RenderPlan)
_ANALYSIS = TypeAdapter(ClipAnalysis)
_WORDS = TypeAdapter(ClipWords)


def saved_words(job_dir: Path, start: float, end: float, language: str, model: str) -> list[Word] | None:
    """The caption Words saved for the Clip from `start` to `end` of the Source in `language` with the
    Whisper `model`, in seconds into the Clip; None when there are none (or they don't validate)."""
    path = job_dir / words_file(start, end)
    if not path.is_file():
        return None
    try:
        saved = _WORDS.validate_json(path.read_bytes())
    except ValidationError:
        return None
    return saved.words if (saved.start, saved.end, saved.language, saved.model) == (start, end, language, model) else None


def saved_analysis(job_dir: Path, start: float, end: float, tuning: AnalysisTuning, model: str) -> ClipAnalysis | None:
    """The analysis saved for the Clip from `start` to `end` of the Source with this `tuning` and face
    `model` (its file name); None when there is none. (An analysis saved before the model was
    recorded doesn't validate.)"""
    path = job_dir / analysis_file(start, end)
    if not path.is_file():
        return None
    try:
        saved = _ANALYSIS.validate_json(path.read_bytes())
    except ValidationError:
        return None
    if (saved.start, saved.end, saved.tuning, saved.model) != (start, end, tuning, model):
        return None
    return saved


def transcript_words(transcript: Transcript, start: float, end: float, duration: float) -> list[Word]:
    """The Transcript's Words from CAPTION_MARGIN_SECS before `start` to as long after `end` (within
    the Source's `duration`), in seconds into the Clip from `start` to `end`: what a Clip's own
    transcription would give, for a preview before there is one."""
    lo, hi = max(0.0, start - CAPTION_MARGIN_SECS), min(duration, end + CAPTION_MARGIN_SECS)
    return [
        Word(word.text, round(word.start - start, 3), round(word.end - start, 3))
        for word in transcript.words
        if word.end > lo and word.start < hi
    ]


def candidate_plan(
    candidate: Candidate,
    source: SourceMetadata,
    words: list[Word] | None,
    analysis: ClipAnalysis | None,
    presets: PresetStore,
    camera: CameraTuning,
) -> RenderPlan:
    """The Render Plan of the Candidate as it is, captioned with `words` (None: no captions) and framed
    by `analysis` (None: unanalysed, or a Source passed through). Renders and the editor's preview both
    plan by this, so that the preview shows what the render will."""
    caption_style, hook_style = presets.styles(candidate.preset_id, candidate.style_overrides)
    return plan_render(
        candidate.start, candidate.end, source,
        scenes=analysis.scenes if analysis else None, faces=analysis.frames if analysis else None,
        layout=candidate.layout, words=words, hook=candidate.hook_text, camera=camera,
        caption_style=caption_style, hook_style=hook_style,
        word_edits=[replace(edit, at=edit.at - candidate.start) for edit in candidate.word_edits],
        hook_start=candidate.hook_start, hook_secs=candidate.hook_secs,
        layout_overrides=[replace(o, at=o.at - candidate.start) for o in candidate.layout_overrides],
    )


class NothingToRender(ValueError):
    pass


class Renders:
    def __init__(self, store: JobStore, settings: Settings, transcriber: Transcriber) -> None:
        self.store = store
        self.settings = settings
        self.presets = PresetStore(settings.data_dir / PRESETS_FILE)
        self.renderer = Renderer(settings.ffmpeg_bin, settings.render)
        self.analyzer = Analyzer(settings.ffmpeg_bin, BLAZE_FACE_MODEL, settings.analysis)
        self.transcriber = transcriber
        self.watchdog = Watchdog(transcriber, settings.transcription)
        self._stopping = threading.Event()
        self._transcribing = False

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

    def prepare(self, job_id: str, candidate_id: str) -> bool:
        """Queue the Candidate to be prepared for the editor: its Words transcribed (unless the Job's
        captions are off) and its range analysed, as its render would, without an encode. Nothing is
        queued when both are saved already. Returns whether the Job has just started rendering, so
        that it needs running. Raises JobConflict unless the Job is in review or rendering, and
        CandidateNotFound."""

        def queue(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, bool]:
            candidate = next((c for c in self.store.load_candidates(job_id) or [] if c.id == candidate_id), None)
            if candidate is None:
                raise CandidateNotFound(candidate_id)
            if candidate_id in job.preparing or self.prepared(job, candidate):
                return clips, {}, False
            changes: dict = {"preparing": [*job.preparing, candidate_id]}
            starting = job.status is JobStatus.REVIEW
            if starting:
                changes |= {"status": JobStatus.RENDERING, "stage": JobStatus.RENDERING}
            return clips, changes, starting

        return self.store.change_clips(job_id, queue, expect=RENDERABLE)

    def prepared(self, job: Job, candidate: Candidate) -> bool:
        """Whether the Candidate's Words (when its Job is captioned) and analysis (when its Source is
        reframed) are saved for its range as it is."""
        assert job.source is not None
        job_dir = self.store.job_dir(job.id)
        words = not job.options.captions or saved_words(
            job_dir, candidate.start, candidate.end, job.options.language, self.settings.whisper_model
        ) is not None
        analysed = not reframes(job.source.metadata) or saved_analysis(
            job_dir, candidate.start, candidate.end, self.analyzer.tuning, self.analyzer.model.name
        ) is not None
        return words and analysed

    def run(self, job_id: str, rendered: Callable[[Clip, Candidate], None] = lambda clip, candidate: None) -> int:
        """Prepare the Job's queued Candidates, then render its queued Clips, one at a time, including
        those queued meanwhile, then put the Job back in review. `rendered` is called with each Clip
        as its render ends, done or failed. Returns how many were rendered. Raises JobConflict when
        another process is rendering the Job, and RenderStopped when the app stops: the Clip being
        rendered (or the Candidate being prepared) is queued again at the next start."""
        with self.store.running(job_id):
            count = 0
            try:
                while (started := self._next(job_id, count)) is not None:
                    job, clip, candidate = started
                    if clip is None:
                        self._prepare(job, candidate)
                        continue
                    clip = self._render(job, clip, candidate)
                    count += 1
                    rendered(clip, candidate)
            finally:
                self.transcriber.stop()  # frees Whisper's memory, if a Clip was transcribed
            return count

    def recover(self, job_id: str) -> None:
        """Queue again the Clips a previous process left being rendered."""

        def requeue(_: Job, clips: list[Clip]) -> tuple[list[Clip], dict, None]:
            return [
                replace(clip, status=ClipStatus.QUEUED) if clip.status is ClipStatus.RENDERING else clip for clip in clips
            ], {}, None

        self.store.change_clips(job_id, requeue, expect={JobStatus.RENDERING})

    def stop(self) -> None:
        self._stopping.set()
        if self._transcribing:
            self.transcriber.stop()
        self.analyzer.stop()
        self.renderer.stop()

    def _next(self, job_id: str, count: int) -> tuple[Job, Clip | None, Candidate] | None:
        """The next thing to do: the first Candidate queued to be prepared, as it is now (with no
        Clip; it stays queued until it is done); else the earliest queued Clip, started, with its
        Candidate as it is now; or, with neither left, put the Job back in review. A Clip whose
        Candidate is gone fails; a preparation whose Candidate is gone is dropped."""

        def start(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, tuple[Job, Clip | None, Candidate] | None]:
            candidates = {candidate.id: candidate for candidate in self.store.load_candidates(job_id) or []}
            preparing = [id for id in job.preparing if id in candidates]
            if preparing:
                candidate = candidates[preparing[0]]
                message = f"Preparing {candidate.title or f'clip {candidate.id}'} for the editor"
                return clips, {"preparing": preparing, "progress": 0.0, "message": message}, (job, None, candidate)
            queued = sorted((clip for clip in clips if clip.status is ClipStatus.QUEUED), key=lambda c: c.requested_at)
            for clip in queued:
                if (candidate := candidates.get(clip.candidate_id)) is None:
                    clips = _put(clips, replace(clip, status=ClipStatus.ERROR, error="Its Candidate no longer exists"))
                    continue
                started = replace(clip, status=ClipStatus.RENDERING, error=None)
                name = candidate.title or f"clip {candidate.id}"
                message = f"Rendering clip {count + 1} of {count + len(queued)}: {name}"
                return _put(clips, started), {"progress": 0.0, "message": message}, (job, started, candidate)
            changes = {"status": JobStatus.REVIEW, "stage": None, "progress": None, "message": None, "preparing": []}
            return clips, changes, None

        return self.store.change_clips(job_id, start, expect={JobStatus.RENDERING})

    def _prepare(self, job: Job, candidate: Candidate) -> None:
        """Transcribe and analyse the Candidate's range, as its render would, and take it off the
        preparation queue. A failure is kept as a warning on the Job."""
        assert job.source is not None
        shown = 0

        def progress(done: float) -> None:
            nonlocal shown
            if (percent := int(100 * done)) > shown:
                shown = percent
                self.store.update(job.id, progress=float(percent))

        warning = None
        try:
            if job.options.captions:
                self._words(job, candidate, lambda done: progress(done / 2))
            self._analysis(job, candidate, lambda done: progress(0.5 + done / 2))
        except RenderStopped:
            raise
        except Exception as exc:
            logger.exception("Job %s: preparing Candidate %s for the editor failed", job.id, candidate.id)
            warning = JobWarning(JobStatus.RENDERING, f"Preparing {candidate.title or f'clip {candidate.id}'} failed: {exc}")

        def done(now: Job, clips: list[Clip]) -> tuple[list[Clip], dict, None]:
            changes: dict = {"preparing": [id for id in now.preparing if id != candidate.id]}
            if warning is not None:
                changes["warnings"] = [*now.warnings, warning]
            return clips, changes, None

        self.store.change_clips(job.id, done)

    def _render(self, job: Job, clip: Clip, candidate: Candidate) -> Clip:
        """Render one Clip, and record how it went. A Clip asked for again while it rendered is queued again."""
        assert job.source is not None
        job_dir = self.store.job_dir(job.id)
        (job_dir / CLIPS_DIR).mkdir(exist_ok=True)
        video, poster, plan_file = clip_files(candidate.id)
        shown = 0

        def progress(done: float) -> None:
            nonlocal shown
            if (percent := int(100 * done)) > shown:
                shown = percent
                self.store.update(job.id, progress=float(percent))

        def step(share: float) -> Callable[[float], None]:
            """Progress for a step that takes `share` of the Clip's, after what has been shown so far.
            (A step done before, as a cached transcription or analysis, shows none.)"""
            begin = shown / 100
            return lambda done: progress(begin + share * done)

        began = time.monotonic()
        try:
            words = self._words(job, candidate, step(1 / 3)) if job.options.captions else None
            analysis = self._analysis(job, candidate, step(1 / 3))
            plan = candidate_plan(candidate, job.source.metadata, words, analysis, self.presets, self.settings.camera)
            write_atomic(job_dir / plan_file, _PLAN.dump_json(plan, indent=2))
            encoder = self.renderer.render(
                job_dir / job.source.video, plan, job_dir / video, job_dir / poster, step(1 - shown / 100)
            )
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
                preset_id=candidate.preset_id,
                style_overrides=candidate.style_overrides,
                word_edits=candidate.word_edits,
                hook_start=candidate.hook_start,
                hook_secs=candidate.hook_secs,
                layout_overrides=candidate.layout_overrides,
                caption_style=plan.caption_style,
                hook_style=plan.hook_style,
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

    def _words(self, job: Job, candidate: Candidate, progress: Callable[[float], None]) -> list[Word]:
        """The Words of the Candidate's range and CAPTION_MARGIN_SECS either side, in seconds into the
        Clip: as saved by an earlier render of the same range in the same language with the same
        Whisper model, or transcribed now and saved."""
        assert job.source is not None
        language, model = job.options.language, self.settings.whisper_model
        path = self.store.job_dir(job.id) / words_file(candidate.start, candidate.end)
        saved = saved_words(self.store.job_dir(job.id), candidate.start, candidate.end, language, model)
        if saved is not None:
            return saved
        start = max(0.0, candidate.start - CAPTION_MARGIN_SECS)
        end = min(job.source.metadata.duration, candidate.end + CAPTION_MARGIN_SECS)
        source = self.store.job_dir(job.id) / job.source.video
        began = time.monotonic()
        self._transcribing = True
        try:
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping")
            transcript = self.watchdog.transcribe(source, language, start, end)
        except TranscriptionStopped as exc:
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping") from exc
            raise
        except TranscriptionStalled as exc:
            raise RuntimeError(f"Transcribing the Clip for its captions stalled twice; try again ({exc})") from exc
        finally:
            self._transcribing = False
        words = [
            Word(word.text, round(word.start - candidate.start, 3), round(word.end - candidate.start, 3))
            for word in transcript.words
        ]
        logger.info(
            "Job %s: transcribed Candidate %s's %.1f s (with its margins) in %.1f s: %d words",
            job.id, candidate.id, end - start, time.monotonic() - began, len(words),
        )
        path.parent.mkdir(exist_ok=True)
        write_atomic(path, _WORDS.dump_json(ClipWords(candidate.start, candidate.end, language, model, words)))
        progress(1.0)
        return words

    def _analysis(self, job: Job, candidate: Candidate, progress: Callable[[float], None]) -> ClipAnalysis | None:
        """The Scenes and faces of the Candidate's range, as saved by an earlier render of the same
        range with the same tuning and face model, or found now and saved; None for a Source that
        isn't reframed. (An analysis saved before the model was recorded doesn't validate, so it is
        done again.)"""
        assert job.source is not None
        if not reframes(job.source.metadata):
            return None
        path = self.store.job_dir(job.id) / analysis_file(candidate.start, candidate.end)
        saved = saved_analysis(
            self.store.job_dir(job.id), candidate.start, candidate.end, self.analyzer.tuning, self.analyzer.model.name
        )
        if saved is not None:
            return saved
        began = time.monotonic()
        source = self.store.job_dir(job.id) / job.source.video
        analysis = self.analyzer.analyze(source, job.source.metadata, candidate.start, candidate.end, progress)
        logger.info(
            "Job %s: analysed Candidate %s in %.1f s: %d scenes, faces in %d of %d sampled frames",
            job.id, candidate.id, time.monotonic() - began, len(analysis.scenes),
            sum(1 for frame in analysis.frames if frame.faces), len(analysis.frames),
        )
        path.parent.mkdir(exist_ok=True)
        write_atomic(path, _ANALYSIS.dump_json(analysis))
        return analysis


def ranked_clips(clips: list[Clip], candidates: list[Candidate]) -> list[Clip]:
    """The Clips in their Candidates' order (by score, then the manual ones); any whose Candidate is gone last."""
    rank = {candidate.id: i for i, candidate in enumerate(candidates)}
    return sorted(clips, key=lambda clip: rank.get(clip.candidate_id, len(rank)))


def _put(clips: list[Clip], new: Clip) -> list[Clip]:
    return [new if clip.candidate_id == new.candidate_id else clip for clip in clips]
