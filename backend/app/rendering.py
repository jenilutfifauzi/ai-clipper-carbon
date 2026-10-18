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
from enum import StrEnum
from typing import Protocol
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.analysis import Analyzer, ClipAnalysis, analysis_file
from app.candidates import Candidate, Framing, Layout, Segment
from app.clips import CLIPS_DIR, Clip, ClipStatus, RenderedClip, clip_files
from app.config import BLAZE_FACE_MODEL, AnalysisTuning, CameraTuning, Settings
from app.jobs import Job, JobStatus, JobStore, JobWarning
from app.layer_pictures import PICTURES_DIR, make_pictures
from app.logos import LOGOS_DIR, LogoStore
from app.media import MEDIA_DIR, MediaItem, MediaKind, MediaStore
from app.planner import WORD_EDIT_REACH_SECS, Join, MediaInfo, SegmentInput, RenderPlan, plan_render, reframes
from app.renderer import Renderer, RenderStopped
from app.retimed import RETIMED_DIR, Copies, CopySize, Retime, read_from_copies
from app.review import CandidateNotFound
from app.segment_time import segment_time
from app.storage import write_atomic
from app.styles import PRESETS_FILE, PresetStore
from app.transcript import Transcript
from app.transcriber import Transcriber, TranscriptionStalled, TranscriptionStopped, Watchdog
from app.transcript import Word
from app.video_source import Source, SourceMetadata, probe

logger = logging.getLogger(__name__)

# The statuses in which Candidates can be asked to be rendered.
RENDERABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})
# A Clip's captions are transcribed from this long before its start to this long after its end.
CAPTION_MARGIN_SECS = 2.0
# A Freeze frame of the Source that no other Segment of its Clip plays through is framed from the
# analysis of this long either side of its frame (`analysed_range`). Rare: the head a Freeze frame is
# split from ends at its frame, unsnapped (app/review.py), so only a Clip made otherwise (an agent's)
# needs it.
HELD_REACH_SECS = 1.0
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


class Analysis(StrEnum):
    """What a Segment of a Candidate needs found of its range of the Source (`needed_analysis`)."""

    # Nothing: a video's Segment, or a portrait Source passed through.
    NONE = "none"
    # Its Scenes only, which are all Manual: where its Layout Overrides apply.
    SCENES = "scenes"
    # Its Scenes and faces, for the Scenes framed by them.
    FACES = "faces"


def source_copies(job_dir: Path, source: Source) -> Copies:
    """The Retimed copies (app/retimed.py) of the Job's Source, in `job_dir`'s RETIMED_DIR: the preview
    size from its proxy (or the video itself, when the browser plays it), the full size from its video."""
    videos = {CopySize.PREVIEW: job_dir / (source.preview or source.video), CopySize.FULL: job_dir / source.video}
    return Copies(job_dir / RETIMED_DIR, videos, (source.metadata.width, source.metadata.height, source.metadata.fps))


def analysed_range(candidate: Candidate, segment: Segment, duration: float) -> tuple[float, float]:
    """The range of the Source, `duration` long, whose analysis frames the Candidate's Source
    `segment`: its own; for a Freeze frame, which holds one frame, the range of the first Segment of
    the Candidate that plays through its frame (the head or tail it was split from, analysed for its
    own sake, whose end touching it is kept at its frame), else HELD_REACH_SECS either side of it: a
    fallback for a Freeze frame put elsewhere than between the halves of its Segment."""
    if segment.hold is None:
        return segment.start, segment.end
    at = segment.start
    playing = (s for s in candidate.main_track() if s.media is None and s.hold is None and s.start <= at <= s.end)
    if (through := next(playing, None)) is not None:
        return through.start, through.end
    return max(0.0, at - HELD_REACH_SECS), min(duration, at + HELD_REACH_SECS)


def needed_analysis(candidate: Candidate, segment: Segment, source: SourceMetadata) -> Analysis:
    """What the Candidate's `segment` of `source` needs found to be planned: the faces unless every
    Scene of it is Manual (the Candidate's Layout, and every Layout Override in its range), which needs
    none (docs/adr/0007); a portrait Source, passed through, needs its Scenes only where one is Manual.
    A Freeze frame's range is its `analysed_range`."""
    if segment.media is not None:
        return Analysis.NONE
    start, end = analysed_range(candidate, segment, source.duration)
    layouts = {candidate.layout, *(o.layout for o in candidate.layout_overrides if start <= o.at <= end)}
    if not reframes(source):
        return Analysis.SCENES if Layout.MANUAL in layouts else Analysis.NONE
    return Analysis.SCENES if layouts == {Layout.MANUAL} else Analysis.FACES


def saved_analysis(
    job_dir: Path, start: float, end: float, tuning: AnalysisTuning, model: str, faces: bool = True
) -> ClipAnalysis | None:
    """The analysis saved for the Clip from `start` to `end` of the Source with this `tuning` and face
    `model` (its file name), with its faces when they are wanted; None when there is none. (An
    analysis saved before the model was recorded doesn't validate.)"""
    path = job_dir / analysis_file(start, end)
    if not path.is_file():
        return None
    try:
        saved = _ANALYSIS.validate_json(path.read_bytes())
    except ValidationError:
        return None
    if (saved.start, saved.end, saved.tuning, saved.model) != (start, end, tuning, model) or (faces and not saved.faces):
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
    words: list[list[Word]] | None,
    analyses: list[ClipAnalysis | None],
    presets: PresetStore,
    camera: CameraTuning,
    logos: LogoStore | None = None,
    media: "MediaFinder | None" = None,
) -> RenderPlan:
    """The Render Plan of the Candidate as it is: each of its Segments (`candidate.main_track()`) captioned
    with its `words` (None: no captions) and framed by its `analyses` (None: unanalysed, or a Source
    passed through), both in seconds into the Segment (a Freeze frame's analysis into its
    `analysed_range`); its Watermark's Logo from `logos`, and the
    songs of its music and the videos of its Segments from `media` (a video that isn't there is left
    out, and so is a Transition into or out of it). A video's Segment has no captions. Its Word Edits
    and Layout Overrides, on the Source's timeline, apply in every Segment that shows their time
    (docs/adr/0002-segments-and-timeline-time.md).
    Renders and the editor's preview both plan by this, so that the preview shows what the render will."""
    caption_style, hook_style, watermark_style = presets.styles(candidate.preset_id, candidate.style_overrides)
    logo = logos.find(watermark_style.logo) if logos else None
    common = dict(
        layout=candidate.layout, framing=candidate.framing, hook=candidate.hook_text, camera=camera,
        caption_style=caption_style, hook_style=hook_style,
        hook_start=candidate.hook_start, hook_secs=candidate.hook_secs,
        hook_kicker=candidate.hook_kicker,
        watermark_style=watermark_style,
        logo_size=(logo.width, logo.height) if logo else None,
        text_layers=candidate.text_layers,
        shapes=candidate.shapes,
        music=candidate.music,
        source_volume=candidate.source_volume,
        overlays=candidate.overlays,
        media_info=_info(media, candidate.media_ids()),
    )
    if not candidate.segments:
        [analysis] = analyses
        return plan_render(
            candidate.start, candidate.end, source,
            scenes=analysis.scenes if analysis else None, faces=analysis.frames if analysis else None,
            words=None if words is None else words[0],
            word_edits=[replace(edit, at=edit.at - candidate.start) for edit in candidate.word_edits],
            layout_overrides=[replace(o, at=o.at - candidate.start) for o in candidate.layout_overrides],
            **common,
        )
    # Each Transition goes into the Segment after the one it follows.
    joins = {transition.after: Join(transition.kind, transition.secs) for transition in candidate.transitions}
    # The Segment just planned before this one: None after one left out, so that no Transition
    # meant for a join with it lands on another.
    inputs, before = [], None
    for i, (segment, analysis) in enumerate(zip(candidate.main_track(), analyses)):
        join = joins.get(before) if before is not None else None
        before = segment.id
        played = segment_time(segment)
        if segment.media is not None:
            item = media.find(segment.media) if media else None
            if item is None or item.width is None or item.height is None:
                before = None
                continue
            inputs.append(SegmentInput(
                segment.start, segment.end, media=segment.media, width=item.width, height=item.height,
                framing=segment.framing or Framing(), volume=segment.volume, silent=not item.has_audio,
                words=None if words is None else [], join=join, keys=segment.keys, id=segment.id,
                speed=played.speed, reverse=played.reverse, hold=played.hold, pitch=segment.pitch,
            ))
            continue
        # Its Scenes, faces and Layout Overrides are of its analysed range (a Freeze frame's is wider).
        start, end = analysed_range(candidate, segment, source.duration)
        inputs.append(SegmentInput(
            segment.start, segment.end,
            scenes=analysis.scenes if analysis else None,
            faces=analysis.frames if analysis else None,
            layout_overrides=[replace(o, at=round(o.at - start, 3)) for o in candidate.layout_overrides if start <= o.at <= end],
            words=None if words is None else words[i],
            volume=segment.volume,
            keys=segment.keys,
            word_edits=[
                replace(edit, at=round(edit.at - segment.start, 3))
                for edit in candidate.word_edits
                if segment.start - WORD_EDIT_REACH_SECS <= edit.at <= segment.end + WORD_EDIT_REACH_SECS
            ],
            join=join,
            id=segment.id,
            speed=played.speed, reverse=played.reverse, hold=played.hold, pitch=segment.pitch,
            analysed=(start, end),
        ))
    return plan_render(candidate.start, candidate.end, source, main_track=inputs, **common)


class MediaFinder(Protocol):
    """Where the Media Library's items are looked up: the MediaStore."""

    def find(self, media_id: str) -> MediaItem | None: ...


def _info(media: MediaFinder | None, ids: set[str]) -> dict[str, MediaInfo]:
    """What the planner needs of the Media Library items that are there, by id."""
    items = [media.find(media_id) for media_id in sorted(ids)] if media else []
    return {
        item.id: MediaInfo(item.width or 0, item.height or 0, None if item.kind is MediaKind.IMAGE else item.duration, item.has_audio)
        for item in items
        if item is not None
    }


class NothingToRender(ValueError):
    pass


class Renders:
    def __init__(self, store: JobStore, settings: Settings, transcriber: Transcriber) -> None:
        self.store = store
        self.settings = settings
        self.presets = PresetStore(settings.data_dir / PRESETS_FILE)
        self.logos = LogoStore(settings.data_dir / LOGOS_DIR, settings.ffmpeg_bin)
        self.media = MediaStore(settings.data_dir / MEDIA_DIR, settings.ffmpeg_bin, settings.ffprobe_bin)
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
        """Whether the Candidate's Words (when its Job is captioned) and the analysis it needs
        (`needed_analysis`) are saved for its range as it is."""
        assert job.source is not None
        job_dir = self.store.job_dir(job.id)
        segments = candidate.source_segments()
        words = not job.options.captions or all(
            saved_words(job_dir, segment.start, segment.end, job.options.language, self.settings.whisper_model) is not None
            for segment in segments
            if segment.hold is None and not segment.reverse
        )
        tuning, model = self.analyzer.tuning, self.analyzer.model.name
        needed = [(segment, needed_analysis(candidate, segment, job.source.metadata)) for segment in segments]
        duration = job.source.metadata.duration
        analysed = all(
            saved_analysis(job_dir, *analysed_range(candidate, segment, duration), tuning, model, wanted is Analysis.FACES) is not None
            for segment, wanted in needed
            if wanted is not Analysis.NONE
        )
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
                self._all_words(job, candidate, lambda done: progress(done / 2))
            self._all_analyses(job, candidate, lambda done: progress(0.5 + done / 2))
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
            words = self._all_words(job, candidate, step(1 / 3)) if job.options.captions else None
            analyses = self._all_analyses(job, candidate, step(1 / 3))
            plan = candidate_plan(
                candidate, job.source.metadata, words, analyses, self.presets, self.settings.camera, self.logos, self.media
            )
            write_atomic(job_dir / plan_file, _PLAN.dump_json(plan, indent=2))
            logo = self.logos.file(plan.watermark.logo) if plan.watermark and plan.watermark.logo else None
            used = (
                {event.media for event in plan.audio}
                | {segment.media for segment in plan.segments if segment.media}
                | {overlay.media for overlay in plan.overlays}
            )
            files = {media_id: self.media.file(media_id) for media_id in used}
            # A reversed Segment or Overlay reads its full-size Retimed copy, made now if it isn't there.
            reversed_count = sum(1 for segment in plan.segments if segment.reverse and segment.hold is None) + sum(
                1 for event in plan.overlays + plan.audio if event.reverse
            )
            plan, files = read_from_copies(plan, files, lambda media_id, played: (
                self.media.retimed(media_id) if media_id is not None else source_copies(job_dir, job.source)
            ).make(
                self.settings.ffmpeg_bin, CopySize.FULL, Retime(played.start, played.end), step((1 - shown / 100) / 2 / reversed_count),
            ))
            # Its picture layers' pictures, made now if they aren't there (docs/adr/0010).
            pictures = make_pictures(self.settings.ffmpeg_bin, (event.layout for event in plan.picture_layers), job_dir / PICTURES_DIR)
            encoder = self.renderer.render(
                job_dir / job.source.video, plan, job_dir / video, job_dir / poster, step(1 - shown / 100), logo, files, pictures
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
                framing=candidate.framing,
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
                hook_kicker=candidate.hook_kicker,
                watermark_style=plan.watermark_style,
                text_layers=candidate.text_layers,
                shapes=candidate.shapes,
                music=candidate.music,
                source_volume=candidate.source_volume,
                segments=candidate.segments,
                overlays=candidate.overlays,
                transitions=candidate.transitions,
                revision=candidate.revision,
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

    def _all_words(self, job: Job, candidate: Candidate, progress: Callable[[float], None]) -> list[list[Word]]:
        """Each of the Candidate's Segments' Words (`_words`; none for a video's, a Freeze frame's or
        a reversed one's), the progress shared out by their lengths."""
        total, done, found = sum(segment_time(p).length for p in candidate.source_segments()), 0.0, []
        for segment in candidate.main_track():
            if segment.media is not None or segment.hold is not None or segment.reverse:
                found.append([])
                continue
            share = segment_time(segment).length / total
            found.append(self._words(job, candidate, segment.start, segment.end, lambda d, done=done, share=share: progress(done + share * d)))
            done += share
        return found

    def _all_analyses(self, job: Job, candidate: Candidate, progress: Callable[[float], None]) -> list[ClipAnalysis | None]:
        """Each of the Candidate's Segments' Scenes and faces, or Scenes only, as it needs
        (`needed_analysis`, `_analysis` of its `analysed_range`; none for a video's), the progress
        shared out by their lengths."""
        assert job.source is not None
        total, done, found = sum(segment_time(p).length for p in candidate.source_segments()), 0.0, []
        for segment in candidate.main_track():
            if segment.media is not None:
                found.append(None)
                continue
            share = segment_time(segment).length / total
            wanted = needed_analysis(candidate, segment, job.source.metadata)
            if wanted is Analysis.NONE:
                found.append(None)
            else:
                start, end = analysed_range(candidate, segment, job.source.metadata.duration)
                found.append(self._analysis(
                    job, candidate, start, end, lambda d, done=done, share=share: progress(done + share * d),
                    faces=wanted is Analysis.FACES,
                ))
            done += share
        return found

    def _words(self, job: Job, candidate: Candidate, start: float, end: float, progress: Callable[[float], None]) -> list[Word]:
        """The Words of the Candidate's range (or Segment) from `start` to `end` on the Source and
        CAPTION_MARGIN_SECS either side, in seconds into it: as saved by an earlier render of the
        same range in the same language with the same Whisper model, or transcribed now and saved."""
        assert job.source is not None
        language, model = job.options.language, self.settings.whisper_model
        path = self.store.job_dir(job.id) / words_file(start, end)
        saved = saved_words(self.store.job_dir(job.id), start, end, language, model)
        if saved is not None:
            return saved
        clip_start, clip_end = start, end
        start = max(0.0, clip_start - CAPTION_MARGIN_SECS)
        end = min(job.source.metadata.duration, clip_end + CAPTION_MARGIN_SECS)
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
            Word(word.text, round(word.start - clip_start, 3), round(word.end - clip_start, 3))
            for word in transcript.words
        ]
        logger.info(
            "Job %s: transcribed Candidate %s's %.1f s (with its margins) in %.1f s: %d words",
            job.id, candidate.id, end - start, time.monotonic() - began, len(words),
        )
        path.parent.mkdir(exist_ok=True)
        write_atomic(path, _WORDS.dump_json(ClipWords(clip_start, clip_end, language, model, words)))
        progress(1.0)
        return words

    def _analysis(
        self, job: Job, candidate: Candidate, start: float, end: float, progress: Callable[[float], None], faces: bool
    ) -> ClipAnalysis:
        """The Scenes and (with `faces`) faces of the Candidate's range (or Segment) from `start` to
        `end` on the Source, as saved by an earlier render of the same range with the same tuning and
        face model, or found now and saved. (An analysis saved before the model was recorded doesn't
        validate, so it is done again; one without faces is done again when they are wanted.)"""
        assert job.source is not None
        path = self.store.job_dir(job.id) / analysis_file(start, end)
        saved = saved_analysis(self.store.job_dir(job.id), start, end, self.analyzer.tuning, self.analyzer.model.name, faces)
        if saved is not None:
            return saved
        began = time.monotonic()
        source = self.store.job_dir(job.id) / job.source.video
        analysis = self.analyzer.analyze(source, job.source.metadata, start, end, progress, faces)
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
