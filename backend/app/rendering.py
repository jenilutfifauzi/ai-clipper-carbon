"""The render queue: Candidates asked to be rendered in review become Clips, rendered one at a time.

A request queues a Clip per Candidate in the Job's clips.json and puts the Job in `rendering`. The
worker (or the CLI) then renders the Job's queued Clips one after another, the earliest asked for
first, and puts the Job back in `review` when none is left. The owner can go on reviewing meanwhile.
Each render uses the Candidate as it is when its render starts, and replaces the Candidate's
previous Clip once it is done.

The clip editor can also queue a Candidate to be prepared: its Words transcribed and its range
analysed as a render would, without an encode, so that its preview (app/editor.py) shows the Clip's
own captions and Scenes. Preparations run before the queued Clips.

A video from the Media Library placed as a Segment is captioned from its Media Words
(app/media_words.py), unless its Captions switch is off: the item transcribed whole, once per language
(its own, else the Job's) and Whisper model, on the same Whisper worker, by the first preparation or
render that needs it, or by a Retry or "Transcribe again" queued for the Job (`transcribe_media`),
which runs before its preparations. A failed transcription is remembered until a Retry, and fails the
render of a Clip that shows the item, naming it.

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
from app.audio_effects import MEASURED_DIR
from app.candidates import Candidate, Framing, Layout, Segment, WordEdit
from app.caption_files import CaptionFormat, caption_file
from app.clips import CLIPS_DIR, Clip, ClipStatus, RenderedClip, caption_paths, clip_files
from app.config import BLAZE_FACE_MODEL, AnalysisTuning, CameraTuning, Settings
from app.encoding import ExportSettings
from app.export_presets import EXPORT_PRESETS_FILE, ExportPresetStore
from app.jobs import Job, JobConflict, JobStatus, JobStore, JobWarning
from app.layer_pictures import PICTURES_DIR, make_pictures
from app.logos import LOGOS_DIR, LogoStore
from app.media import MEDIA_DIR, MediaItem, MediaKind, MediaNotFound, MediaStore
from app.media_words import MediaWordsFailed, MediaWordsStatus, MediaWordsStore
from app.planner import Join, MediaInfo, SegmentInput, RenderPlan, edit_shown, plan_render, reframes
from app.renderer import Renderer, RenderStopped, picture_layouts
from app.retimed import RETIMED_DIR, Copies, CopySize, Retime, read_from_copies
from app.review import CandidateNotFound
from app.segment_time import overlay_time, segment_time
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


def media_language(job: Job, item: MediaItem) -> str:
    """The language the item's Media Words are transcribed in for the Job: the item's own, else the Job's."""
    return item.language or job.options.language


def has_media_words(item: MediaItem) -> bool:
    """Whether the item can have Media Words: a video with sound."""
    return item.kind is MediaKind.VIDEO and item.has_audio


def captioned_media(segment: Segment, item: MediaItem | None) -> bool:
    """Whether the media Segment is captioned from its item's Media Words: its item's a video with
    sound (`has_media_words`), played forwards, not held as a Freeze frame, and its Captions switch
    not off."""
    return (
        segment.media is not None and item is not None and has_media_words(item)
        and segment.hold is None and not segment.reverse and segment.captions is not False
    )


def media_segment_words(words: list[Word], segment: Segment) -> list[Word]:
    """The Words of a media Segment from its item's Media Words (in seconds into the item), as a Source
    Segment's are given: those within CAPTION_MARGIN_SECS either side of its range, in seconds into it."""
    return [
        Word(word.text, round(word.start - segment.start, 3), round(word.end - segment.start, 3))
        for word in words
        if word.end > segment.start - CAPTION_MARGIN_SECS and word.start < segment.end + CAPTION_MARGIN_SECS
    ]


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


def words_at_hand(
    job_dir: Path, transcript: Transcript | None, start: float, end: float, duration: float, language: str, model: str
) -> list[Word]:
    """The Words of the Source from `start` to `end` (of `duration`) and CAPTION_MARGIN_SECS either
    side, in seconds into that range, without transcribing: the Clip's own when saved for it
    (`saved_words`), or else the Transcript's (`transcript_words`; none without one)."""
    saved = saved_words(job_dir, start, end, language, model)
    if saved is not None:
        return saved
    return transcript_words(transcript, start, end, duration) if transcript is not None else []


def music_words(candidate: Candidate, words_of: Callable[[float, float], list[Word]]) -> dict[str, list[Word]]:
    """The Words of each of the Candidate's Music Clips of the Source that is heard forwards, by its
    id: those of its read (`words_of` a range of the Source), in seconds from its offset. They are
    speech, which ducks the music (docs/adr/0016)."""
    return {
        clip.id: words_of(clip.offset, overlay_time(clip.offset, clip.secs, clip.speed).end)
        for clip in candidate.music
        if clip.media is None and not clip.muted and not clip.reverse
    }


def candidate_plan(
    candidate: Candidate,
    source: SourceMetadata,
    words: list[list[Word]] | None,
    analyses: list[ClipAnalysis | None],
    presets: PresetStore,
    camera: CameraTuning,
    logos: LogoStore | None = None,
    media: "MediaFinder | None" = None,
    fps: float | None = None,
    captioned: bool = True,
    music: dict[str, list[Word]] | None = None,
) -> RenderPlan:
    """The Render Plan of the Candidate as it is, at `fps` (the export's frame rate; None, as the
    preview always plans: the Source's): each of its Segments (`candidate.main_track()`) captioned
    with its `words` (None: no captions) and framed by its `analyses` (None: unanalysed, or a Source
    passed through), both in seconds into the Segment (a Freeze frame's analysis into its
    `analysed_range`); its Watermark's Logo from `logos`, and the
    songs of its music and the videos of its Segments from `media` (a video that isn't there is left
    out, and so is a Transition into or out of it). A video's Segment is captioned with its item's
    Media Words in `words` (`media_segment_words`; [] for none). Its Layout Overrides, on the Source's
    timeline, apply in every Source Segment that shows their time
    (docs/adr/0002-segments-and-timeline-time.md); its Word Edits and Cue Edits in every Segment that
    shows their time of their timeline, the Source's or an item's (`edit_shown`, docs/adr/0020). Not `captioned`, its
    `words` are heard but not captioned: they and its Music Clips of the Source's (`music`,
    `music_words`) are speech, which ducks its music (docs/adr/0016).
    It is planned on the Candidate's Canvas (docs/adr/0022).
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
        cue_edits=candidate.cue_edits,
        fps=fps,
        captioned=captioned,
        music_words=music,
        grade=candidate.grade,
        adjustment_layers=candidate.adjustment_layers,
        canvas=candidate.canvas,
    )
    if not candidate.segments:
        [analysis] = analyses
        return plan_render(
            candidate.start, candidate.end, source,
            scenes=analysis.scenes if analysis else None, faces=analysis.frames if analysis else None,
            words=None if words is None else words[0],
            word_edits=[replace(edit, at=edit.at - candidate.start) for edit in candidate.word_edits if edit.media is None],
            layout_overrides=[replace(o, at=o.at - candidate.start) for o in candidate.layout_overrides],
            **common,
        )
    # Each Transition goes into the Segment after the one it follows.
    joins = {transition.after: Join(transition.kind, transition.secs, transition.sound, transition.strength, transition.colour) for transition in candidate.transitions}
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
                words=None if words is None else words[i], word_edits=shown_edits(candidate.word_edits, segment),
                join=join, keys=segment.keys, id=segment.id,
                speed=played.speed, reverse=played.reverse, hold=played.hold, pitch=segment.pitch,
                fade_in=segment.fade_in, fade_out=segment.fade_out, muted=segment.muted, grade=segment.grade, audio_effects=segment.audio_effects,
                video_effects=segment.video_effects,
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
            word_edits=shown_edits(candidate.word_edits, segment),
            join=join,
            id=segment.id,
            speed=played.speed, reverse=played.reverse, hold=played.hold, pitch=segment.pitch,
            fade_in=segment.fade_in, fade_out=segment.fade_out, muted=segment.muted, grade=segment.grade, audio_effects=segment.audio_effects,
            video_effects=segment.video_effects,
            analysed=(start, end),
        ))
    return plan_render(candidate.start, candidate.end, source, main_track=inputs, **common)


def shown_edits(edits: list[WordEdit], segment: Segment) -> list[WordEdit]:
    """The Word Edits that can apply in `segment`, in seconds into its range: those of its own timeline
    (the Source's, or its item's) within WORD_EDIT_REACH_SECS of its range (`edit_shown`)."""
    return [
        replace(edit, at=round(edit.at - segment.start, 3))
        for edit in edits
        if edit_shown(edit, segment.media, segment.start, segment.end)
    ]


def played_files(
    plan: RenderPlan,
    job_dir: Path,
    source: Source,
    media: MediaStore,
    ffmpeg: Path,
    progress: Callable[[int], Callable[[float], None]] = lambda count: lambda done: None,
) -> tuple[RenderPlan, dict[str, Path]]:
    """The plan as the renderer reads it and the files of the Media Library items it plays, by id: a
    reversed Segment or Overlay reads its full-size Retimed copy (`read_from_copies`), made now if it
    isn't there, with the progress `progress` gives for one of the plan's `count` copies."""
    used = (
        {event.media for event in plan.audio if event.media}
        | {segment.media for segment in plan.segments if segment.media}
        | {overlay.media for overlay in plan.overlays}
    )
    files = {media_id: media.file(media_id) for media_id in used}
    count = sum(1 for segment in plan.segments if segment.reverse and segment.hold is None) + sum(
        1 for event in plan.overlays + plan.audio if event.reverse
    )
    return read_from_copies(plan, files, lambda media_id, played: (
        media.retimed(media_id) if media_id is not None else source_copies(job_dir, source)
    ).make(ffmpeg, CopySize.FULL, Retime(played.start, played.end), progress(count)))


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


def drawing_inputs(
    plan: RenderPlan,
    export: ExportSettings,
    job_dir: Path,
    source: Source,
    settings: Settings,
    media: MediaStore,
    logos: LogoStore,
    progress: Callable[[int], Callable[[float], None]] = lambda copies: lambda done: None,
) -> tuple[RenderPlan, Path | None, dict[str, Path], dict[str, Path]]:
    """What the renderer draws `plan` (of the Job in `job_dir`, of `source`) as `export` says from:
    the plan reading its reversed Segments and Overlays from their full-size Retimed copies, made
    now if they aren't there (`progress(copies)` gives each copy's progress); its Logo's file; the
    file of each Media Library item it plays, by id; and its picture layers' pictures at the export's
    size, made now if they aren't there (docs/adr/0010), by name. A render and a saved frame both
    draw from these."""
    logo = logos.file(plan.watermark.logo) if plan.watermark and plan.watermark.logo else None
    plan, files = played_files(plan, job_dir, source, media, settings.ffmpeg_bin, progress)
    pictures = make_pictures(settings.ffmpeg_bin, picture_layouts(plan, export), job_dir / PICTURES_DIR)
    return plan, logo, files, pictures


class Renders:
    def __init__(
        self, store: JobStore, settings: Settings, transcriber: Transcriber, media_words: MediaWordsStore | None = None
    ) -> None:
        self.store = store
        self.settings = settings
        self.presets = PresetStore(settings.data_dir / PRESETS_FILE)
        self.export_presets = ExportPresetStore(settings.data_dir / EXPORT_PRESETS_FILE)
        self.logos = LogoStore(settings.data_dir / LOGOS_DIR, settings.ffmpeg_bin)
        self.media = MediaStore(settings.data_dir / MEDIA_DIR, settings.ffmpeg_bin, settings.ffprobe_bin)
        # Shared with the API, which reports what is queued.
        self.media_words = media_words or MediaWordsStore(settings.data_dir / MEDIA_DIR, settings.whisper_model)
        self.renderer = Renderer(settings.ffmpeg_bin, settings.render)
        self.analyzer = Analyzer(settings.ffmpeg_bin, BLAZE_FACE_MODEL, settings.analysis)
        self.transcriber = transcriber
        self.watchdog = Watchdog(transcriber, settings.transcription)
        self._stopping = threading.Event()
        self._transcribing = False

    def request(self, job_id: str, candidate_ids: list[str] | None = None, export_preset_id: str | None = None) -> bool:
        """Queue the Candidates' Clips: those of `candidate_ids`, or of the selected Candidates, with
        the Export Preset `export_preset_id` (the default when None). A Clip already queued keeps its
        place, with the latest Preset; one being rendered is rendered again after. Returns whether the
        Job has just started rendering, so that it needs running. Raises JobConflict unless the Job is
        in review or rendering, CandidateNotFound, ExportPresetNotFound and NothingToRender."""
        preset = self.export_presets.default() if export_preset_id is None else self.export_presets.get(export_preset_id)

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
                    by_id[id] = Clip(id, ClipStatus.QUEUED, now, export_preset_id=preset.id)
                elif old.status is ClipStatus.RENDERING:
                    by_id[id] = replace(old, requested_at=now, export_preset_id=preset.id)
                elif old.status is ClipStatus.QUEUED:
                    by_id[id] = replace(old, export_preset_id=preset.id)
                else:
                    by_id[id] = replace(old, status=ClipStatus.QUEUED, requested_at=now, error=None, export_preset_id=preset.id)
            starting = job.status is JobStatus.REVIEW
            changes = {"status": JobStatus.RENDERING, "stage": JobStatus.RENDERING} if starting else {}
            return list(by_id.values()), changes, starting

        return self.store.change_clips(job_id, queue, expect=RENDERABLE)

    def prepare(self, job_id: str, candidate_id: str) -> bool:
        """Queue the Candidate to be prepared for the editor: its Words transcribed (unless the Job's
        captions are off), the Media Words of its media Segments' items among them, and its range
        analysed, as its render would, without an encode. Nothing is queued when all are saved
        already. Returns whether the Job has just started rendering, so
        that it needs running. Raises JobConflict unless the Job is in review or rendering, and
        CandidateNotFound."""

        def queue(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, bool]:
            candidate = next((c for c in self.store.load_candidates(job_id) or [] if c.id == candidate_id), None)
            if candidate is None:
                raise CandidateNotFound(candidate_id)
            if candidate_id in job.preparing or self.prepared(job, candidate):
                return clips, {}, False
            for item in self.missing_media_words(job, candidate):
                self.media_words.queue(item.id, media_language(job, item))
            changes: dict = {"preparing": [*job.preparing, candidate_id]}
            starting = job.status is JobStatus.REVIEW
            if starting:
                changes |= {"status": JobStatus.RENDERING, "stage": JobStatus.RENDERING}
            return clips, changes, starting

        return self.store.change_clips(job_id, queue, expect=RENDERABLE)

    def prepared(self, job: Job, candidate: Candidate) -> bool:
        """Whether the Candidate's Words (when its Job is captioned), its media Segments' Media Words
        among them, and the analysis it needs (`needed_analysis`) are saved for its range as it is."""
        assert job.source is not None
        job_dir = self.store.job_dir(job.id)
        segments = candidate.source_segments()
        words = not job.options.captions or all(
            saved_words(job_dir, segment.start, segment.end, job.options.language, self.settings.whisper_model) is not None
            for segment in segments
            if segment.hold is None and not segment.reverse
        ) and not self.missing_media_words(job, candidate)
        tuning, model = self.analyzer.tuning, self.analyzer.model.name
        needed = [(segment, needed_analysis(candidate, segment, job.source.metadata)) for segment in segments]
        duration = job.source.metadata.duration
        analysed = all(
            saved_analysis(job_dir, *analysed_range(candidate, segment, duration), tuning, model, wanted is Analysis.FACES) is not None
            for segment, wanted in needed
            if wanted is not Analysis.NONE
        )
        return words and analysed

    def transcribe_media(self, job_id: str, media_id: str, again: bool = False) -> bool:
        """Queue the item's Media Words in its language for the Job to be transcribed in the Job's
        turn, before its preparations: a Retry, which forgets a failure; with `again`, Transcribe
        again, which replaces those saved. Nothing is queued when they are saved (without `again`).
        Returns whether the Job has just started rendering, so that it needs running. Raises
        JobConflict unless the Job is in review or rendering, or when its captions are off, and
        MediaNotFound unless the item is a video with sound."""

        def queue(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, bool]:
            if not job.options.captions:
                raise JobConflict(f"Job {job_id}'s captions are off")
            item = self.media.get(media_id)
            if not has_media_words(item):
                raise MediaNotFound(media_id)
            language = media_language(job, item)
            self.media_words.retry(item.id, language, again)
            if self.media_words.status(item.id, language) is not MediaWordsStatus.PENDING:
                return clips, {}, False
            changes: dict = {"transcribing": list(dict.fromkeys([*job.transcribing, media_id]))}
            starting = job.status is JobStatus.REVIEW
            if starting:
                changes |= {"status": JobStatus.RENDERING, "stage": JobStatus.RENDERING}
            return clips, changes, starting

        return self.store.change_clips(job_id, queue, expect=RENDERABLE)

    def missing_media_words(self, job: Job, candidate: Candidate) -> list[MediaItem]:
        """The items of the Candidate's captioned media Segments (`captioned_media`) whose Media Words
        aren't saved in their language for the Job (or are to be transcribed again); none when its
        captions are off. One whose transcription failed isn't missing: it waits for a Retry."""
        if not job.options.captions:
            return []
        missing: dict[str, MediaItem] = {}
        for segment in candidate.main_track():
            item = self.media.find(segment.media) if segment.media else None
            if item is not None and captioned_media(segment, item):
                status = self.media_words.status(item.id, media_language(job, item))
                if status not in (MediaWordsStatus.READY, MediaWordsStatus.FAILED):
                    missing[item.id] = item
        return list(missing.values())

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
                    if isinstance(candidate, MediaItem):
                        self._transcribe_media(job, candidate)
                        continue
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
                replace(clip, status=ClipStatus.QUEUED, started_at=None) if clip.status is ClipStatus.RENDERING else clip
                for clip in clips
            ], {}, None

        self.store.change_clips(job_id, requeue, expect={JobStatus.RENDERING})

    def stop(self) -> None:
        self._stopping.set()
        if self._transcribing:
            self.transcriber.stop()
        self.analyzer.stop()
        self.renderer.stop()

    def _next(self, job_id: str, count: int) -> tuple[Job, Clip | None, Candidate | MediaItem] | None:
        """The next thing to do: the first item queued to have its Media Words transcribed (with no
        Clip; it stays queued until it is done); else the first Candidate queued to be prepared, as
        it is now (likewise); else the earliest queued Clip, started, with its Candidate as it is now;
        or, with none left, put the Job back in review. A Clip whose Candidate is gone fails; a
        preparation whose Candidate is gone, or a transcription whose item is, is dropped."""

        def start(job: Job, clips: list[Clip]) -> tuple[list[Clip], dict, tuple[Job, Clip | None, Candidate | MediaItem] | None]:
            items = [item for media_id in job.transcribing if (item := self.media.find(media_id)) is not None]
            if items:
                # Queued again in this process, for the editor, after a restart.
                self.media_words.queue(items[0].id, media_language(job, items[0]))
                message = f"Transcribing the video {items[0].name} for its captions"
                changes = {"transcribing": [item.id for item in items], "progress": 0.0, "message": message}
                return clips, changes, (job, None, items[0])
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
                started = replace(clip, status=ClipStatus.RENDERING, error=None, started_at=datetime.now(UTC))
                name = candidate.title or f"clip {candidate.id}"
                message = f"Rendering clip {count + 1} of {count + len(queued)}: {name}"
                return _put(clips, started), {"progress": 0.0, "message": message}, (job, started, candidate)
            changes = {"status": JobStatus.REVIEW, "stage": None, "progress": None, "message": None, "preparing": [], "transcribing": []}
            return clips, changes, None

        return self.store.change_clips(job_id, start, expect={JobStatus.RENDERING})

    def _transcribe_media(self, job: Job, item: MediaItem) -> None:
        """Transcribe the item's Media Words in its language for the Job (a failure is remembered by
        the store), and take it off the Job's queue."""
        try:
            if job.options.captions:
                self._media_words(job, item)
        except MediaWordsFailed:
            logger.warning("Job %s: transcribing the video %s (%s) failed", job.id, item.id, item.name)

        def done(now: Job, clips: list[Clip]) -> tuple[list[Clip], dict, None]:
            return clips, {"transcribing": [id for id in now.transcribing if id != item.id]}, None

        self.store.change_clips(job.id, done)

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
                # A video whose transcription fails shows failed in the editor; its Segment goes uncaptioned here.
                self._all_words(job, candidate, lambda done: progress(done / 2), failed=lambda item, exc: [])
            self._all_analyses(job, candidate, lambda done: progress(0.5 + done / 2))
        except RenderStopped:
            raise
        except Exception as exc:
            logger.exception("Job %s: preparing Candidate %s for the editor failed", job.id, candidate.id)
            # What it didn't get to is no longer on its way.
            for item in self.missing_media_words(job, candidate):
                self.media_words.unqueue(item.id, media_language(job, item))
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
            # Without captions, the Words at hand are still heard: they duck the music (docs/adr/0016).
            transcript, duration = self.store.load_transcript(job.id), job.source.metadata.duration
            language, model = job.options.language, self.settings.whisper_model

            def at_hand(start: float, end: float) -> list[Word]:
                return words_at_hand(job_dir, transcript, start, end, duration, language, model)

            words = self._all_words(job, candidate, step(1 / 3)) if job.options.captions else [
                [] if segment.media is not None or segment.hold is not None or segment.reverse else at_hand(segment.start, segment.end)
                for segment in candidate.main_track()
            ]
            analyses = self._all_analyses(job, candidate, step(1 / 3))
            # The Export Preset asked for as it is now (the default once it is deleted), planned at
            # its frame rate (docs/adr/0021).
            preset = self.export_presets.get_or_default(clip.export_preset_id)
            export = preset.settings
            plan = candidate_plan(
                candidate, job.source.metadata, words, analyses, self.presets, self.settings.camera, self.logos, self.media,
                export.fps, captioned=job.options.captions, music=music_words(candidate, at_hand),
            )
            write_atomic(job_dir / plan_file, _PLAN.dump_json(plan, indent=2))
            plan, logo, files, pictures = drawing_inputs(
                plan, export, job_dir, job.source, self.settings, self.media, self.logos, lambda copies: step((1 - shown / 100) / 2 / copies),
            )
            encoder, bitrate_fallback = self.renderer.render(
                job_dir / job.source.video, plan, job_dir / video, job_dir / poster, step(1 - shown / 100), logo, files, pictures, export,
                job_dir / MEASURED_DIR,
            )
            duration = probe(self.settings.ffprobe_bin, job_dir / video).duration
            # Its caption files, beside the MP4: the plan's Cues as subtitles (docs/adr/0020).
            subtitles = caption_paths(candidate.id) if job.options.captions else {}
            for format, file in subtitles.items():
                write_atomic(job_dir / file, caption_file(plan.captions, format).encode())
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
                srt=subtitles.get(CaptionFormat.SRT),
                vtt=subtitles.get(CaptionFormat.VTT),
                export_preset_id=preset.id,
                export=export,
                bitrate_fallback=bitrate_fallback,
                aspect=candidate.aspect,
            )
            logger.info(
                "Job %s: rendered Candidate %s (%.1f s) in %.1f s with %s, %.1f MB",
                job.id, candidate.id, duration, secs, encoder, size / 1e6,
            )
            outcome = replace(clip, status=ClipStatus.DONE, output=output, error=None)

        def finish(_: Job, clips: list[Clip]) -> tuple[list[Clip], dict, Clip]:
            now = next(c for c in clips if c.candidate_id == clip.candidate_id)
            again = now.requested_at > clip.requested_at
            ended = replace(
                outcome, status=ClipStatus.QUEUED if again else outcome.status, requested_at=now.requested_at, started_at=None,
                export_preset_id=now.export_preset_id,
            )
            return _put(clips, ended), {}, ended

        return self.store.change_clips(job.id, finish)

    def _all_words(
        self, job: Job, candidate: Candidate, progress: Callable[[float], None],
        failed: Callable[[MediaItem, MediaWordsFailed], list[Word]] | None = None,
    ) -> list[list[Word]]:
        """Each of the Candidate's Segments' Words (`_words`, or a video's from its item's Media Words,
        `_media_words`; none for a Freeze frame, a reversed one, or a video's with its Captions switch
        off), the progress shared out by their lengths. A video whose transcription fails (now or
        before a Retry) gives what `failed` makes of it, or, without `failed`, a RuntimeError naming it."""
        total, done, found = sum(segment_time(p).length for p in candidate.main_track()), 0.0, []
        for segment in candidate.main_track():
            share = segment_time(segment).length / total if total else 0.0
            if segment.media is not None:
                item = self.media.find(segment.media)
                heard: list[Word] = []
                if item is not None and captioned_media(segment, item):
                    try:
                        heard = media_segment_words(self._media_words(job, item), segment)
                    except MediaWordsFailed as exc:
                        if failed is None:
                            raise RuntimeError(
                                f"The video {item.name} couldn't be transcribed for its captions ({exc}): retry it in the "
                                "editor, or turn its Segment's captions off"
                            ) from exc
                        heard = failed(item, exc)
                found.append(heard)
                done += share
                progress(done)
                continue
            if segment.hold is not None or segment.reverse:
                found.append([])
                continue
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
        transcript = self._transcribe(source, language, start, end, "the Clip")
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

    def _media_words(self, job: Job, item: MediaItem) -> list[Word]:
        """The item's Media Words in its language for the Job, in seconds into it: as saved, or its
        whole sound transcribed now on the Whisper worker (with a whole item's budget) and saved.
        MediaWordsFailed when that fails, now or before a Retry."""
        language = media_language(job, item)

        def hear() -> list[Word]:
            began = time.monotonic()
            transcript = self._transcribe(
                self.media.file(item.id), language, 0.0, item.duration or 0.0, f"the video {item.name}", whole=True
            )
            words = [Word(word.text, round(word.start, 3), round(word.end, 3)) for word in transcript.words]
            logger.info(
                "Job %s: transcribed the video %s (%s, %.1f s) in %.1f s: %d words",
                job.id, item.id, item.name, item.duration or 0.0, time.monotonic() - began, len(words),
            )
            return words

        return self.media_words.transcribe(item.id, language, hear, interrupted=(RenderStopped,))

    def _transcribe(self, media: Path, language: str, start: float, end: float, what: str, whole: bool = False) -> Transcript:
        """`media` from `start` to `end` seconds transcribed on the Whisper worker, under the watchdog;
        with the budget of a Media Library item transcribed `whole` (TranscriptionTuning) when it is one."""
        self._transcribing = True
        tuning = self.settings.transcription
        budget = tuning.media_budget_secs + tuning.media_budget_factor * (end - start) if whole else None
        try:
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping")
            return self.watchdog.transcribe(media, language, start, end, budget)
        except TranscriptionStopped as exc:
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping") from exc
            raise
        except TranscriptionStalled as exc:
            raise RuntimeError(f"Transcribing {what} for its captions stalled twice; try again ({exc})") from exc
        finally:
            self._transcribing = False

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
