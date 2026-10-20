"""HTTP API routes. Services come from `app.state`, set up by `create_app`."""

import shutil
import tempfile
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    FiniteFloat,
    ModelWrapValidatorHandler,
    PrivateAttr,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)
from starlette.background import BackgroundTask

from app import emoji, review
from app.candidates import (
    HOOK_MAX_CHARS,
    KICKER_MAX_CHARS,
    AdjustmentLayer,
    Candidate,
    CueEdit,
    Framing,
    Grade,
    KeyProperty,
    Layout,
    LayoutOverride,
    MusicClip,
    Overlay,
    Segment,
    Shape,
    Speed,
    TextLayer,
    TextStyle,
    Transition,
    Volume,
    WordEdit,
    grades_of,
)
from app.caption_files import CaptionFormat, caption_file
from app.clips import Clip
from app.config import Settings
from app.derived import PEAKS_FORMAT, PEAKS_VERSION, STRIP_FORMAT, STRIP_VERSION, frames_in, make_peaks, make_strip
from app.editor import PreviewPlan, captions_pending, preview_plan
from app.encoding import Codec, ExportSettings, estimated_bytes
from app.events import candidate_events, job_events
from app.export_files import SavedExport, draw_frame, save_audio, save_frame, saved_export
from app.export_presets import BuiltinExportPreset, ExportPreset, ExportPresetNotFound, ExportPresetStore
from app.fonts import MAX_UPLOAD_BYTES as MAX_FONT_BYTES, BadFont, BundledFace, Face, FaceNotFound, Faces, MissingFace
from app.item_sound import NoItem, NoSound, SoundOf, save_item_sound
from app.jobs import Job, JobConflict, JobNotFound, JobOptions, JobStatus, JobStore
from app.layer_pictures import OLD_PICTURES_DIR, PICTURES_DIR, pictures_used, sweep as sweep_pictures
from app.looks import MAX_UPLOAD_BYTES as MAX_LOOK_BYTES, BadCube, ImportedLooks, Look, LookNotFound, all_looks, builtin_looks, get_look
from app.logos import MAX_UPLOAD_BYTES, BadLogo, Logo, LogoNotFound, LogoStore
from app.media import MEDIA_TYPES, BadMedia, MediaItem, MediaKind, MediaNotFound, MediaStore
from app.media_words import MediaWordsStatus, MediaWordsStore
from app.migration import OLD_TEXT_LAYER
from app.planner import font_metrics
from app.preview import STILLS_DIR, THUMBNAIL_FILE, make_thumbnail, take_still
from app.profile import ChannelProfile, ProfileStore
from app.renderer import AudioFormat, available_codecs
from app.rendering import NothingToRender, has_media_words, media_language, ranked_clips, source_copies
from app.retimed import RETIMED_DIR, Copies, CopySize, Retime, copies_used, sweep
from app.segment_time import overlay_time, segment_time
from app.text_presets import BuiltinTextPreset, TextPreset, TextPresetNotFound, TextPresetStore
from app.review import MAX_CLIP_SECS, CandidateChange, CandidateNotFound, Episode, InvalidEdit, StaleRevision
from app.revisions import Edit, HistoryEntry
from app.storage import DiskUsage, disk_usage
from app.styles import (
    BuiltinPreset,
    CaptionStyle,
    HookStyle,
    InvalidStyle,
    JoinTransition,
    Name,
    PresetNotFound,
    PresetStore,
    StyleOverrides,
    StylePreset,
    WatermarkStyle,
)
from app.transcript import Language, Transcript, Word
from app.uploads import OPTIONS_FIELD, UPLOADS_DIR, BadUpload, NotEnoughSpace, check_room, receive
from app.worker import Worker

router = APIRouter(prefix="/api")
media = APIRouter(prefix="/media")

# The statuses in which the owner can change a Job's Candidates: not before the Job has them, nor
# while it is analyzed again and its untouched Candidates are about to be replaced. Review goes on
# while Clips render; each render takes its Candidate as it is when the render starts.
EDITABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})
# What /media serves from a Job's directory: its video (or preview proxy), and its Clips with their
# posters and caption files. An uploaded master the browser can play may be a QuickTime file (app/preview.py).
MEDIA_SUFFIXES = frozenset({".mp4", ".m4v", ".mov", ".m4a", ".wav", ".jpg", ".png", ".srt", ".vtt"})
# The caption files' types (app/caption_files.py): not every system's MIME table knows them.
SUBTITLE_TYPES = {".srt": "application/x-subrip", ".vtt": "text/vtt"}
# The most Word Edits a Candidate holds: more than a 3-minute clip has Words.
WORD_EDITS_MAX = 500
CUE_EDITS_MAX = 500
# The most Layout Overrides a Candidate holds: more than a clip has Scenes.
LAYOUT_OVERRIDES_MAX = 200
# The most Text Layers, Shapes, Music Clips and Segments a Candidate holds.
TEXT_LAYERS_MAX = 50
SHAPES_MAX = 50
MUSIC_MAX = 50
SEGMENTS_MAX = 100
OVERLAYS_MAX = 50
ADJUSTMENT_LAYERS_MAX = 50
# Where a Job's picture layers' pictures are served, under /api/jobs/<job id>/: named when only Text
# Layers had them, and kept for the editors that ask for them there.
PICTURES_ROUTE = "texts"

_OPTIONS = TypeAdapter(JobOptions)
_CANDIDATE = TypeAdapter(Candidate)
_HISTORY_ENTRY = TypeAdapter(HistoryEntry)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _worker(request: Request) -> Worker:
    return request.app.state.worker


def _profiles(request: Request) -> ProfileStore:
    return request.app.state.profiles


def _presets(request: Request) -> PresetStore:
    return request.app.state.presets


def _text_presets(request: Request) -> TextPresetStore:
    return request.app.state.text_presets


def _export_presets(request: Request) -> ExportPresetStore:
    return request.app.state.export_presets


def _logos(request: Request) -> LogoStore:
    return request.app.state.logos


def _media(request: Request) -> MediaStore:
    return request.app.state.media


def _media_words(request: Request) -> MediaWordsStore:
    return request.app.state.media_words


def _imported_looks(request: Request) -> ImportedLooks:
    return request.app.state.looks


def _faces(request: Request) -> Faces:
    return request.app.state.faces


def _edit(request: Request) -> Edit:
    """Who makes an edit: the editor and tab its request names (X-Edit-Source, X-Edit-Tab)."""
    return Edit.of(request.headers.get("X-Edit-Source"), request.headers.get("X-Edit-Tab"))


def _job(job_id: str, request: Request) -> Job:
    """The Job, or a 404. For streaming routes, which can't answer 404 once they have started."""
    try:
        return _store(request).get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None


AppSettings = Annotated[Settings, Depends(_settings)]
Store = Annotated[JobStore, Depends(_store)]
JobWorker = Annotated[Worker, Depends(_worker)]
Profiles = Annotated[ProfileStore, Depends(_profiles)]
Presets = Annotated[PresetStore, Depends(_presets)]
TextPresets = Annotated[TextPresetStore, Depends(_text_presets)]
ExportPresets = Annotated[ExportPresetStore, Depends(_export_presets)]
Logos = Annotated[LogoStore, Depends(_logos)]
Media = Annotated[MediaStore, Depends(_media)]
MediaWordsDep = Annotated[MediaWordsStore, Depends(_media_words)]
FaceRegistry = Annotated[Faces, Depends(_faces)]
ImportedLookStore = Annotated[ImportedLooks, Depends(_imported_looks)]
EditBy = Annotated[Edit, Depends(_edit)]
ExistingJob = Annotated[Job, Depends(_job)]


class JobRequest(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    options: JobOptions = JobOptions()


def no_old_overlays(overlays: Any) -> Any:
    """Overlays in the shape before Transforms (docs/adr/0007), refused with what replaced it."""
    for overlay in overlays if isinstance(overlays, list) else []:
        if isinstance(overlay, dict) and (old := [key for key in ("x", "y", "size", "opacity") if key in overlay]):
            raise ValueError(
                f"{', '.join(old)} of an Overlay are now in its transform: x and y its centre in output pixels, "
                "scale times its fitted size (1 fits the frame), opacity"
            )
    return overlays


def no_old_text_layers(layers: Any) -> Any:
    """Text Layers in the shape before Text Styles, refused with what replaced it."""
    for layer in layers if isinstance(layers, list) else []:
        if isinstance(layer, dict) and (old := [key for key in OLD_TEXT_LAYER if key in layer]):
            raise ValueError(
                f"{', '.join(old)} of a Text Layer are now in its transform (x and y, its centre) and its style, a Text "
                "Style: font, size, colour, stroke_width and stroke_colour (the outline), plate (the box: shape none or "
                "block, colour, opacity, radius, padding_x, padding_y), line_height and align"
            )
    return layers


def no_old_segments(segments: Any) -> Any:
    """Segments in the shape before Framings (docs/adr/0007), refused with what replaced it."""
    for segment in segments if isinstance(segments, list) else []:
        if isinstance(segment, dict) and "fit" in segment:
            raise ValueError(
                "fit of a Segment is now its framing: a transform (scale 1 fits the frame; Fill is the scale "
                "that covers it), a crop and a background (blur, or a colour)"
            )
    return segments


def no_framing_keys(framing: Any) -> Any:
    """The Candidate's own Framing, refused with Keyframes: only a Scene's Manual Layout Override has them."""
    if isinstance(framing, dict) and "keys" in framing:
        raise ValueError("The Candidate's own framing has no Keyframes: key a Scene's Manual Layout Override instead")
    return framing


class CandidateUpdate(BaseModel):
    """A review edit; a field left out stays as it is. `start` and `end` are snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat | None = None
    end: FiniteFloat | None = None
    hook_text: Annotated[str, StringConstraints(max_length=HOOK_MAX_CHARS)] | None = None
    layout: Layout | None = None
    # The Manual Layout's, which only it has; dropped when the Layout becomes another.
    framing: Annotated[Framing | None, BeforeValidator(no_framing_keys)] = None
    selected: bool | None = None
    preset_id: str | None = None
    # Replaces the Candidate's overrides as a whole.
    style_overrides: StyleOverrides | None = None
    # Replaces the Candidate's Word Edits as a whole.
    word_edits: Annotated[list[WordEdit], Field(max_length=WORD_EDITS_MAX)] | None = None
    # Replaces the Candidate's Cue Edits as a whole.
    cue_edits: Annotated[list[CueEdit], Field(max_length=CUE_EDITS_MAX)] | None = None
    # Seconds into the Clip; the planner keeps them in it.
    hook_start: Annotated[float, Field(ge=0, le=MAX_CLIP_SECS)] | None = None
    hook_secs: Annotated[float, Field(ge=0.5, le=30)] | None = None
    # Replaces the Candidate's Layout Overrides as a whole.
    layout_overrides: Annotated[list[LayoutOverride], Field(max_length=LAYOUT_OVERRIDES_MAX)] | None = None
    # Saved with its whitespace collapsed; "" for none.
    hook_kicker: Annotated[str, StringConstraints(max_length=KICKER_MAX_CHARS)] | None = None
    # Replaces the Candidate's Text Layers as a whole.
    text_layers: Annotated[list[TextLayer], Field(max_length=TEXT_LAYERS_MAX), BeforeValidator(no_old_text_layers)] | None = None
    # Replaces the Candidate's Shapes as a whole.
    shapes: Annotated[list[Shape], Field(max_length=SHAPES_MAX)] | None = None
    # Replaces the Candidate's Music Clips as a whole; each names a song or a video with sound.
    music: Annotated[list[MusicClip], Field(max_length=MUSIC_MAX)] | None = None
    source_volume: Volume | None = None
    # The Candidate's own Grade (docs/adr/0013), over its whole Main Track; replaced as a whole.
    grade: Grade | None = None
    # Replaces the Candidate's Adjustment Layers (docs/adr/0013) as a whole.
    adjustment_layers: Annotated[list[AdjustmentLayer], Field(max_length=ADJUSTMENT_LAYERS_MAX)] | None = None
    # Replaces the Candidate's Main Track as a whole; each Segment is snapped to Words.
    segments: Annotated[list[Segment], Field(max_length=SEGMENTS_MAX), BeforeValidator(no_old_segments)] | None = None
    # Replaces the Candidate's Overlays as a whole; each names a video or an image.
    overlays: Annotated[list[Overlay], Field(max_length=OVERLAYS_MAX), BeforeValidator(no_old_overlays)] | None = None
    # Replaces the Candidate's Transitions as a whole; those without a join are left out.
    transitions: Annotated[list[Transition], Field(max_length=SEGMENTS_MAX)] | None = None
    # The Revision this edit was made from: refused (409, with the Candidate as it is now) unless it
    # is the Candidate's. Left out, the edit is saved over whatever is there.
    revision: Annotated[int, Field(ge=1)] | None = None
    # The Music Clips (by id) sent without `duck`: a new song's then ducks by default (docs/adr/0016).
    # Read from what was sent, so that an explicit null keeps it off.
    _duck_unset: frozenset[str] = PrivateAttr(default=frozenset())

    @model_validator(mode="wrap")
    @classmethod
    def _unset_ducks(cls, given: Any, handler: ModelWrapValidatorHandler["CandidateUpdate"]) -> "CandidateUpdate":
        update = handler(given)
        music = given.get("music") if isinstance(given, dict) else None
        if isinstance(music, list):
            update._duck_unset = frozenset(str(clip.get("id")) for clip in music if isinstance(clip, dict) and "duck" not in clip)
        return update

    @property
    def change(self) -> CandidateChange:
        """The edit, as `review.update` makes it."""
        return CandidateChange(**{name: getattr(self, name) for name in CandidateUpdate.model_fields}, duck_unset=self._duck_unset)


class MediaWordsRequest(BaseModel):
    """A Retry of a video's Media Words, or with `again`, "Transcribe again"."""

    model_config = ConfigDict(extra="forbid")

    again: bool = False


class MediaWordsView(BaseModel):
    """A video's Media Words for a Job: in its language (its own, else the Job's), their status
    (ready, pending, failed or none), the error of a failure, and the Words when ready, in seconds
    into the video."""

    media_id: str
    language: str
    status: MediaWordsStatus
    error: str | None = None
    words: list[Word] | None = None


class RestoreBody(BaseModel):
    """A Restore of a Revision History entry."""

    model_config = ConfigDict(extra="forbid")

    # The Revision the Restore was asked from: refused (409) unless it is the Candidate's.
    revision: Annotated[int, Field(ge=1)] | None = None


class PresetBody(BaseModel):
    """A Style Preset as the owner saves it."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    caption: CaptionStyle = CaptionStyle()
    hook: HookStyle = HookStyle()
    watermark: WatermarkStyle = WatermarkStyle()
    # What each new join of its Candidates gets; None for none.
    join_transition: JoinTransition | None = None


class TextPresetBody(BaseModel):
    """A Text Preset as the owner saves it: a name and a Text Style."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    style: TextStyle


class TextPresetChange(BaseModel):
    """A change to one of the owner's Text Presets; a field left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    style: TextStyle | None = None


class TextPresetChoice(BaseModel):
    """The Text Preset to use for new titles."""

    model_config = ConfigDict(extra="forbid")

    id: str


@dataclass(frozen=True)
class TextPresetInfo(TextPreset):
    """A Text Preset, and whether it is the one used for new titles."""

    default: bool = False

    @classmethod
    def of(cls, preset: TextPreset, default: TextPreset) -> "TextPresetInfo":
        return cls(**vars(preset), default=preset.id == default.id)


@dataclass(frozen=True)
class ExportPresetList:
    """The Export Presets, built-in ones first; the one a render uses when none is asked for; and the
    codecs this Mac's ffmpeg can encode."""

    presets: list[ExportPreset]
    default: str
    available: list[Codec]


class ExportPresetBody(BaseModel):
    """An Export Preset as the owner saves it: a name and Export Settings, each of them on its list."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    settings: ExportSettings


class ExportPresetChoice(BaseModel):
    """The Export Preset a render uses when none is asked for."""

    model_config = ConfigDict(extra="forbid")

    preset_id: str


class ExportEstimate(BaseModel):
    """A batch of Clips `secs` long in all, made as `settings` say; at the Source's frame rate `fps`
    when they keep it."""

    model_config = ConfigDict(extra="forbid")

    settings: ExportSettings
    secs: Annotated[float, Field(ge=0, le=86_400)]
    fps: Annotated[float, Field(gt=0, le=240)]


class ManualCandidate(BaseModel):
    """A transcript range to make a manual Candidate of, snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat
    end: FiniteFloat



class FontInfo(BaseModel):
    """A Face (app/fonts.py), with what its font says of its licence, and its measures in its units:
    what the preview needs to set text as libass does, which sizes a font by its Windows ascent plus
    descent (`units`) rather than its em."""

    id: str
    label: str
    # The name libass matches it by.
    family: str
    # The family the picker groups it in.
    typographic_family: str
    weight: int
    italic: bool
    bundled: bool
    copyright: str
    licence: str
    licence_url: str
    # Its font says it may not be embedded.
    restricted: bool
    # Its file, at a URL that changes with it.
    url: str
    units: int
    em: int
    ascent: int
    cap_height: int
    descent: int

    @classmethod
    def of(cls, face: Face) -> "FontInfo":
        metrics = font_metrics(face.id)
        return cls(
            id=face.id, label=face.label, family=face.family, typographic_family=face.typographic_family,
            weight=face.weight, italic=face.italic, bundled=face.bundled, copyright=face.copyright,
            licence=face.licence, licence_url=face.licence_url, restricted=face.restricted,
            url=f"/api/fonts/{face.id}?v={face.sha256[:16]}", units=metrics.units, em=metrics.em,
            ascent=metrics.ascent, cap_height=metrics.cap_height, descent=metrics.descent,
        )


class FontImported(BaseModel):
    """What a font file added (`faces`), the Faces it holds that were there already, and warnings,
    such as a font that says it may not be embedded."""

    faces: list[FontInfo]
    existing: list[FontInfo]
    warnings: list[str]


class FaceUse(BaseModel):
    """What names a Face: a Candidate, as it is or in its Revision History, a Style Preset or a Text Preset."""

    kind: Literal["candidate", "style_preset", "text_preset"]
    # The Candidate's or the Preset's.
    id: str
    # The Candidate's Job.
    job_id: str | None = None
    # The Clip's title, or the Preset's name.
    title: str
    # The parts that name it: such as "Text Layer t1", "hook style" or "Revision 3" (a state in its
    # Revision History).
    parts: list[str]
    # All of it, as one line.
    where: str


class RenderRequest(BaseModel):
    """The Candidates to render; the selected ones when left out."""

    model_config = ConfigDict(extra="forbid")

    candidate_ids: list[str] | None = None
    # The Export Preset the batch is rendered with; the default when left out.
    export_preset_id: str | None = None


class FrameRequest(BaseModel):
    """The frame to save: at `at` seconds of Timeline time, of the Candidate or of `draft` (as a
    Preview Plan's), at an Export Preset's size (the default's when left out)."""

    model_config = ConfigDict(extra="forbid")

    at: Annotated[FiniteFloat, Field(ge=0)]
    draft: CandidateUpdate | None = None
    export_preset_id: str | None = None


class CompareRequest(BaseModel):
    """The frame Compare render draws: at `at` seconds of Timeline time, of the Candidate or of
    `draft` (as a Preview Plan's)."""

    model_config = ConfigDict(extra="forbid")

    at: Annotated[FiniteFloat, Field(ge=0)]
    draft: CandidateUpdate | None = None


class SaveAudioRequest(BaseModel):
    """The format a Candidate's sound is saved alone in, and the Export Preset whose loudness it
    takes; the default when left out."""

    model_config = ConfigDict(extra="forbid")

    format: AudioFormat = "wav"
    export_preset_id: str | None = None


class RetimedRequest(BaseModel):
    """A range of a video to play from a Retimed copy (docs/adr/0009): backwards when `reverse`, at
    `speed`, its pitch following it with `pitch`."""

    model_config = ConfigDict(extra="forbid")

    start: Annotated[FiniteFloat, Field(ge=0)]
    end: FiniteFloat
    reverse: bool = True
    speed: Speed = 1.0
    pitch: bool = False


class RetimedCopy(BaseModel):
    """How a preview Retimed copy asked for is coming along: its `progress` from 0 to 1; once made,
    its `url` and where in it the range asked for starts (`at`, in seconds); or the `error` that
    stopped it, after which the next ask tries again."""

    progress: float
    url: str | None = None
    at: float | None = None
    error: str | None = None


@dataclass(frozen=True)
class JobDetail(Job):
    transcript: Transcript | None = None
    # Best first; None until the Job has been analyzed.
    candidates: list[Candidate] | None = None
    # In their Candidates' order.
    clips: list[Clip] = field(default_factory=list)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/jobs", status_code=201)
def create_job(body: JobRequest, store: Store, profiles: Profiles, worker: JobWorker) -> Job:
    job = store.create(body.url, body.options, profiles.load())
    worker.submit(job.id)
    return job


@router.post("/jobs/upload", status_code=201)
async def upload_job(
    request: Request, settings: AppSettings, store: Store, profiles: Profiles, worker: JobWorker
) -> Job:
    """Create a Job from an uploaded master file: a multipart/form-data body with an `options` field
    (JobOptions as JSON; optional) and then a `file`. The file is streamed to disk as it comes. 507
    before anything is written when the Content-Length leaves less than Settings.upload_reserve_bytes
    free (the browser asks `check_upload` first), or as soon as free space runs short while it
    comes; 400 for an upload cut short, which leaves nothing behind."""

    def accept(fields: dict[str, str]) -> JobOptions:
        try:
            return _OPTIONS.validate_json(fields.get(OPTIONS_FIELD) or "{}")
        except ValidationError as exc:
            raise RequestValidationError(exc.errors(include_url=False)) from None

    try:
        received, options = await receive(
            request, settings.data_dir / UPLOADS_DIR, settings.upload_reserve_bytes, accept
        )
    except NotEnoughSpace as exc:
        raise HTTPException(507, str(exc)) from None
    except BadUpload as exc:
        raise HTTPException(400, str(exc)) from None
    job = store.create("", options, profiles.load(), upload=(received.path, received.name))
    worker.submit(job.id)
    return job


@router.get("/jobs/upload/check", status_code=204)
def check_upload(size: Annotated[int, Query(ge=0)], settings: AppSettings) -> None:
    """Whether an upload of `size` bytes would be accepted for its disk space: 204, or 507 with the
    upload's message. The browser asks before it sends the file, since it only reads the answer to
    the upload itself once it has sent the whole file."""
    try:
        check_room(settings.data_dir, size, settings.upload_reserve_bytes)
    except NotEnoughSpace as exc:
        raise HTTPException(507, str(exc)) from None


@router.get("/jobs")
def list_jobs(
    store: Store,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    before: AwareDatetime | None = None,
) -> list[Job]:
    """The Jobs, newest first: every one, or a page of `limit`. The next page is the one `before`
    the last Job's `created_at`, a cursor that neither skips nor repeats a Job when others are
    started or deleted meanwhile."""
    jobs = store.all()
    if before is not None:
        jobs = [job for job in jobs if job.created_at < before]
    return jobs[:limit]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, store: Store, library: Media, background: BackgroundTasks) -> JobDetail:
    """The Job, as the editors open it; then, once it is sent, its unused Retimed copies and picture
    layers' pictures are swept (`sweep_unused`)."""
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    candidates = store.load_candidates(job_id)
    background.add_task(sweep_unused, store, library, job_id)
    return JobDetail(
        **vars(job),
        transcript=store.load_transcript(job_id),
        candidates=candidates,
        clips=ranked_clips(store.load_clips(job_id), candidates or []),
    )


@router.get("/jobs/{job_id}/thumbnail")
def job_thumbnail(job: ExistingJob, store: Store, settings: AppSettings) -> FileResponse:
    """A still of the Job's Source, for the Jobs list: taken the first time it's asked for, then
    kept in the Job's directory. 404 until the Source is there."""
    if job.source is None:
        raise HTTPException(404, f"Job {job.id} has no Source yet")
    job_dir = store.job_dir(job.id)
    still = job_dir / THUMBNAIL_FILE
    if not still.is_file():
        try:
            make_thumbnail(settings.ffmpeg_bin, job_dir / job.source.video, job.source.metadata.duration)
        except RuntimeError as exc:
            raise HTTPException(404, str(exc)) from None
    return FileResponse(still, headers={"Cache-Control": "max-age=86400"})


@router.get("/jobs/{job_id}/candidates/{candidate_id}/thumbnail")
def candidate_thumbnail(candidate_id: str, job: ExistingJob, store: Store, settings: AppSettings) -> FileResponse:
    """A still of the Source where a Candidate starts, for the Candidates list: from as far into it
    as its Clip's poster, taken the first time it's asked for, then kept in the Job's directory
    under its time. After a trim it's another still, so the browser asks with the Candidate's range."""
    candidate = next((c for c in store.load_candidates(job.id) or [] if c.id == candidate_id), None)
    if candidate is None:
        raise HTTPException(404, f"No Candidate {candidate_id} in Job {job.id}")
    if job.source is None:
        raise HTTPException(404, f"Job {job.id} has no Source")
    job_dir = store.job_dir(job.id)
    first = segment_time(candidate.source_segments()[0])
    at = first.source_at(min(settings.render.poster_secs, first.length / 2))
    still = job_dir / STILLS_DIR / f"{round(at * 1000)}.jpg"
    if not still.is_file():
        try:
            take_still(settings.ffmpeg_bin, job_dir / job.source.video, at, still, 320)
        except RuntimeError as exc:
            raise HTTPException(404, str(exc)) from None
    return FileResponse(still, headers={"Cache-Control": "max-age=86400"})


@router.get(f"/jobs/{{job_id}}/filmstrip/{STRIP_VERSION}/{{start}}.jpg")
def job_filmstrip(start: int, job: ExistingJob, store: Store, settings: AppSettings, worker: JobWorker) -> FileResponse:
    """A Filmstrip chunk of the Job's Source from `start` seconds (a multiple of 30): its frames at
    each whole second, side by side, with their count in X-Frames. Made the first time it's asked
    for, from the preview proxy when the Job has one, on every core unless the Worker is running a
    Job, then kept in the Job's directory. 404 for a `start` off the grid or past the end, or a Job
    without its Source yet."""
    source = job.source
    frames = frames_in(start, source.metadata.duration) if source else 0
    if source is None or not frames:
        raise HTTPException(404, f"No Filmstrip of Job {job.id} from {start} s")
    job_dir = store.job_dir(job.id)
    chunk = job_dir / "strips" / STRIP_FORMAT / f"{start}.jpg"
    try:
        make_strip(
            settings.ffmpeg_bin, job_dir / (source.preview or source.video), start, source.metadata.duration, chunk,
            threads=lambda: 1 if worker.busy else 0,
        )
    except RuntimeError as exc:
        raise HTTPException(404, str(exc)) from None
    return FileResponse(chunk, media_type="image/jpeg", headers={**_DERIVED, "X-Frames": str(frames)})


@router.get(f"/jobs/{{job_id}}/peaks/{PEAKS_VERSION}/{{start}}.peaks")
def job_peaks(start: int, job: ExistingJob, store: Store, settings: AppSettings) -> FileResponse:
    """A Peaks chunk of the Job's Source from `start` seconds (a multiple of 30): the min and max of
    each millisecond of its sound, in the layout app/derived.py gives. Made the first time it's asked
    for, from the preview proxy when the Job has one, then kept in the Job's directory. 404 for a
    `start` off the grid or past the end, a Source without sound, or a Job without its Source yet."""
    source = job.source
    if source is None or not frames_in(start, source.metadata.duration):
        raise HTTPException(404, f"No Peaks of Job {job.id} from {start} s")
    job_dir = store.job_dir(job.id)
    chunk = job_dir / "peaks" / PEAKS_FORMAT / f"{start}.peaks"
    try:
        make_peaks(settings.ffmpeg_bin, job_dir / (source.preview or source.video), start, chunk)
    except RuntimeError as exc:
        # A Source without sound, or gone from the disk.
        raise HTTPException(404, str(exc)) from None
    return FileResponse(chunk, media_type="application/octet-stream", headers=_DERIVED)


@router.get(f"/jobs/{{job_id}}/{PICTURES_ROUTE}/{{name}}")
def job_layer_picture(name: str, job: ExistingJob, store: Store) -> FileResponse:
    """A picture layer's picture (app/layer_pictures.py), by the name its event in a Preview Plan gives:
    made with that plan, and named by a hash of what it shows, so never stale. 404 for one not made,
    or swept since."""
    picture = store.job_dir(job.id) / PICTURES_DIR / name
    if not name.endswith(".png") or name.startswith(".") or "/" in name or not picture.is_file():
        raise HTTPException(404, f"No picture {name} in Job {job.id}")
    return FileResponse(picture, media_type="image/png", headers=_DERIVED)


@router.post("/jobs/{job_id}/retimed")
def job_retimed(job: ExistingJob, body: RetimedRequest, store: Store, settings: AppSettings, worker: JobWorker) -> RetimedCopy:
    """The preview-size Retimed copy of the Source's range from `start` to `end` seconds, as the
    editor asks for it while it previews a reversed Segment of the Source, then polls, as a video's
    (`media_retimed`); served from the Job's directory (`/media/<job>/retimed/<name>`). 404 for a Job
    without its Source yet; 422 for a range outside it, or one played forwards at 1×."""
    source = job.source
    if source is None:
        raise HTTPException(404, f"Job {job.id} has no Source")
    copies = source_copies(store.job_dir(job.id), source)
    return _ask_retimed(copies, source.metadata.duration, "the Source", body, f"/media/{job.id}/{RETIMED_DIR}", settings, worker)


@router.get("/jobs/{job_id}/events", response_class=EventSourceResponse)
async def stream_job_events(job: ExistingJob, store: Store) -> AsyncIterator[ServerSentEvent]:
    """The Job's progress (status, stage, percent, message, error, warnings, retry_at) as `job`
    events: one now, then one per change. The stream ends with an `end` event once the Job is in
    review or error, or is deleted; after a retry, open it again."""
    async for event in job_events(store, job.id):
        yield event


@router.get("/jobs/{job_id}/candidates/events", response_class=EventSourceResponse)
async def stream_candidate_events(
    job: ExistingJob, store: Store, faces: FaceRegistry, text_presets: TextPresets
) -> AsyncIterator[ServerSentEvent]:
    """The Job's Candidates as they are saved (ADR 0003): `ready` with them as they are now, then a
    `candidate` event per new Revision (with who saved it and the parts it changed), `removed` for
    one that is gone, and `deleted` once the Job is. A `fonts` event says the Faces have changed."""
    async for event in candidate_events(store, job.id, faces=faces, text_presets=text_presets):
        yield event


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


@router.patch("/jobs/{job_id}/candidates/{candidate_id}")
def update_candidate(
    job_id: str,
    candidate_id: str,
    body: CandidateUpdate,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    edit: EditBy,
) -> Candidate:
    """Change a Candidate's bounds (snapped to Words), hook text, layout, Style Preset, Style
    Overrides or selected flag, and save it at once. 422 for a range that isn't a usable clip or
    overrides that don't make a valid style; 404 for an unknown Preset; 409 unless the Job is in review."""
    if body.preset_id is not None:
        _preset(presets, body.preset_id)
    if body.style_overrides is not None:
        _check_logo(logos, body.style_overrides.watermark.get("logo"))
    _check_media_of(library, body)
    _check_looks_of(body)
    change = body.change

    def update(candidates: list[Candidate], episode: Episode) -> tuple[list[Candidate], Candidate]:
        candidates, candidate = review.update(candidates, candidate_id, change, episode, presets.join_transition)
        try:
            presets.styles(candidate.preset_id, candidate.style_overrides)
        except InvalidStyle as exc:
            raise InvalidEdit(f"Invalid style overrides: {exc}") from None
        return candidates, candidate

    return _review(store, settings, job_id, update, edit)


@router.get("/jobs/{job_id}/candidates/{candidate_id}/revisions")
def list_revisions(candidate_id: str, job: ExistingJob, store: Store) -> dict:
    """The Candidate's Revision History, newest first, without each entry's Candidate: its Revision,
    when it was saved, by which editor (source, and tab for a browser's), and the parts it changed."""
    history = _history(store, job, candidate_id)
    return {"revisions": [_HISTORY_ENTRY.dump_python(entry, mode="json", exclude={"candidate"}) for entry in reversed(history)]}


@router.get("/jobs/{job_id}/candidates/{candidate_id}/revisions/{revision}")
def get_revision(candidate_id: str, revision: int, job: ExistingJob, store: Store) -> HistoryEntry:
    """One entry of the Candidate's Revision History, with the Candidate as it was then."""
    return _entry(store, job, candidate_id, revision)


# What a Restore brings back besides the Main Track (which holds the range): everything an edit
# changes but being chosen for rendering.
RESTORED = tuple(CandidateUpdate.model_fields.keys() - {"start", "end", "segments", "selected", "revision"})


@router.post("/jobs/{job_id}/candidates/{candidate_id}/revisions/{revision}/restore")
def restore_revision(
    job_id: str,
    candidate_id: str,
    revision: int,
    job: ExistingJob,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    edit: EditBy,
    body: RestoreBody | None = None,
) -> Candidate:
    """Save the Candidate as it was in an entry of its Revision History, as its next Revision (source
    Restore), keeping whether it is chosen for rendering. It goes through an edit's checks: with
    `revision`, 409 when the Candidate has moved past it."""
    was = _entry(store, job, candidate_id, revision).candidate
    update = CandidateUpdate(
        segments=was.main_track(),
        **{name: getattr(was, name) for name in RESTORED},
        revision=body.revision if body else None,
    )
    return update_candidate(job_id, candidate_id, update, store, settings, presets, logos, library, Edit("restore", edit.tab))


@router.post("/jobs/{job_id}/candidates/{candidate_id}/preview-plan")
def candidate_preview_plan(
    job_id: str,
    candidate_id: str,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    media_words: MediaWordsDep,
    body: CandidateUpdate | None = None,
) -> PreviewPlan:
    """The Candidate's Preview Plan (app/editor.py): its Render Plan, or that of `body`, a draft of
    edits applied as an update would apply them but not saved. 422 for a draft that isn't a valid
    edit; 409 for a Job without Candidates."""
    return _draft_plan(job_id, candidate_id, store, settings, presets, logos, library, media_words, body)


@router.post("/jobs/{job_id}/candidates/{candidate_id}/frame")
def save_candidate_frame(
    job_id: str,
    candidate_id: str,
    body: FrameRequest,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    export_presets: ExportPresets,
    logos: Logos,
    library: Media,
    media_words: MediaWordsDep,
) -> SavedExport:
    """Save the frame at `at` (Timeline time) of the Candidate, or of `draft` (as the Preview Plan
    plans it: from cached analysis only), drawn as its render would draw it at the Export Preset's
    frame rate and size (the default's when left out), as a PNG in the Job's exports/
    (`<candidate>-<mm.ss.ff>.png`, overwritten). Synchronous, outside the render queue: the Job's
    status doesn't change. 422 for an unknown Preset or a draft that isn't a valid edit."""
    export = _export_preset(export_presets, body.export_preset_id).settings
    planned = _draft_plan(job_id, candidate_id, store, settings, presets, logos, library, media_words, body.draft, export.fps)
    job, job_dir = store.get(job_id), store.job_dir(job_id)
    try:
        path = save_frame(job, job_dir, candidate_id, planned.plan, body.at, export, settings, library, logos)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from None
    return saved_export(job_id, job_dir, path)


@router.post("/jobs/{job_id}/candidates/{candidate_id}/compare-frame", response_class=Response)
def compare_frame(
    job_id: str,
    candidate_id: str,
    body: CompareRequest,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    export_presets: ExportPresets,
    logos: Logos,
    library: Media,
    media_words: MediaWordsDep,
) -> Response:
    """Compare render (GLOSSARY): the frame at `at` (Timeline time) of the Candidate, or of `draft` (as
    the Preview Plan plans it), drawn by the render path as save_frame draws it, at 1080x1920 and the
    frame rate its Clip renders at (its Clip's Export Preset as it is now, the default's when it has
    none or it was deleted: docs/adr/0021), as `image/png`. Never kept: drawn outside the Job, which
    doesn't change. Synchronous, outside the render queue. 422 for a draft that isn't a valid edit."""
    asked = next((clip.export_preset_id for clip in store.load_clips(job_id) if clip.candidate_id == candidate_id), None)
    export = replace(ExportSettings(), fps=export_presets.get_or_default(asked).settings.fps)
    planned = _draft_plan(job_id, candidate_id, store, settings, presets, logos, library, media_words, body.draft, export.fps)
    job, job_dir = store.get(job_id), store.job_dir(job_id)
    with tempfile.TemporaryDirectory(prefix="compare-") as folder:
        path = Path(folder) / "frame.png"
        try:
            draw_frame(job, job_dir, planned.plan, body.at, path, export, settings, library, logos)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc)) from None
        png = path.read_bytes()
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


def _draft_plan(
    job_id: str,
    candidate_id: str,
    store: JobStore,
    settings: Settings,
    presets: PresetStore,
    logos: LogoStore,
    library: MediaStore,
    media_words: MediaWordsStore,
    body: CandidateUpdate | None,
    fps: float | None = None,
) -> PreviewPlan:
    """The Preview Plan of the Candidate, or of `body`, a draft of edits not saved, at `fps` (the
    Source's when None)."""
    job, transcript, candidate = _drafted(job_id, candidate_id, body, store, settings, presets, library)
    try:
        return preview_plan(job, store.job_dir(job_id), transcript, candidate, settings, presets, logos, library, media_words, fps)
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None
    except InvalidStyle as exc:
        raise HTTPException(422, f"Invalid style overrides: {exc}") from None


@router.post("/jobs/{job_id}/candidates/{candidate_id}/sound/{kind}/{item_id}", response_class=FileResponse)
def save_sound(
    job_id: str,
    candidate_id: str,
    kind: SoundOf,
    item_id: str,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    body: CandidateUpdate | None = None,
) -> FileResponse:
    """Save sound as WAV: the sound of the Candidate's Segment, Music Clip or Overlay `item_id`, or
    of that item of `body` (a draft of edits, as the Preview Plan takes it), alone as it is heard in
    the Clip, Muted or not (app/item_sound.py): `audio/wav`, 48 kHz stereo 16-bit PCM, to download
    under a name made of the Candidate's and the item's. 404 for an item the draft hasn't; 422 for
    a Freeze frame, an image or an item without sound, and for a draft that isn't a valid edit."""
    job, _, candidate = _drafted(job_id, candidate_id, body, store, settings, presets, library)
    folder = Path(tempfile.mkdtemp(prefix=".sound-", dir=store.job_dir(job_id)))
    try:
        name = save_item_sound(job, store.job_dir(job_id), candidate, kind, item_id, folder / "sound.wav", settings, presets, logos, library)
    except NoItem as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(404, f"Candidate {candidate_id} has {exc}") from None
    except NoSound as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(422, str(exc)) from None
    except InvalidStyle as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(422, f"Invalid style overrides: {exc}") from None
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return FileResponse(
        folder / "sound.wav", media_type="audio/wav", filename=name, background=BackgroundTask(shutil.rmtree, folder, ignore_errors=True),
    )


def _drafted(
    job_id: str, candidate_id: str, body: CandidateUpdate | None, store: JobStore, settings: Settings, presets: PresetStore, library: MediaStore
) -> tuple[Job, Transcript, Candidate]:
    """The Job, its Transcript and the Candidate as `body`, a draft of its edits, would make it, applied
    as an update would apply them but not saved. 404 for an unknown Job or Candidate; 409 for a Job
    without Candidates; 422 for a draft that isn't a valid edit."""
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    transcript, candidates = store.load_transcript(job_id), store.load_candidates(job_id)
    if job.source is None or transcript is None or candidates is None:
        raise HTTPException(409, f"Job {job_id} has no Candidates yet")
    if body is not None and body.preset_id is not None:
        _preset(presets, body.preset_id)
    if body is not None:
        _check_media_of(library, body)
        _check_looks_of(body)
    episode = Episode(transcript, job.source.metadata.duration, job.options.max_secs, settings.selection)
    change = body.change if body else CandidateChange()
    try:
        # Nothing is saved, so the draft's Revision is no reason to refuse it.
        _, candidate = review.update(candidates, candidate_id, replace(change, revision=None), episode, presets.join_transition)
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None
    return job, transcript, candidate


@router.post("/jobs/{job_id}/candidates/{candidate_id}/audio")
def save_candidate_audio(
    job_id: str,
    candidate_id: str,
    body: SaveAudioRequest,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    export_presets: ExportPresets,
    library: Media,
) -> SavedExport:
    """Save the Candidate's sound alone (app/export_files.py), as its saved Revision's Clip would mix
    it, at `export_preset_id`'s loudness (the default Preset's when left out): a 48 kHz 16-bit WAV or
    an AAC M4A, written to the Job's exports/ as <candidate>.wav or .m4a, overwriting it. At once,
    outside the render queue: the Job's status doesn't change. 422 for an unknown Export Preset; 409
    for a Job without Candidates."""
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    candidates = store.load_candidates(job_id)
    if job.source is None or candidates is None:
        raise HTTPException(409, f"Job {job_id} has no Candidates yet")
    candidate = next((c for c in candidates if c.id == candidate_id), None)
    if candidate is None:
        raise HTTPException(404, f"Job {job_id} has no Candidate {candidate_id}")
    export = _export_preset(export_presets, body.export_preset_id).settings
    job_dir = store.job_dir(job_id)
    path = save_audio(job, job_dir, store.load_transcript(job_id), candidate, body.format, export, settings, presets, library)
    return saved_export(job_id, job_dir, path)


@router.get("/jobs/{job_id}/candidates/{candidate_id}/captions/{format}")
def candidate_captions(
    job_id: str,
    candidate_id: str,
    format: CaptionFormat,
    store: Store,
    settings: AppSettings,
    presets: Presets,
    logos: Logos,
    library: Media,
    media_words: MediaWordsDep,
) -> Response:
    """The Candidate's captions as an SRT or VTT file (app/caption_files.py): the Cues of its Preview
    Plan as saved, without a render. (A rendered Clip's are beside its MP4: its `srt` and `vtt`.)
    409 for a Job with captions off or without Candidates, and while a captioned Segment's Words are
    still being transcribed."""
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    transcript, candidates = store.load_transcript(job_id), store.load_candidates(job_id)
    if job.source is None or transcript is None or candidates is None:
        raise HTTPException(409, f"Job {job_id} has no Candidates yet")
    if not job.options.captions:
        raise HTTPException(409, f"Job {job_id} has captions off: it has no caption files")
    candidate = next((c for c in candidates if c.id == candidate_id), None)
    if candidate is None:
        raise HTTPException(404, f"Job {job_id} has no Candidate {candidate_id}")
    preview = preview_plan(job, store.job_dir(job_id), transcript, candidate, settings, presets, logos, library, media_words)
    if captions_pending(preview):
        raise HTTPException(409, "Its captions are still being transcribed: ask again once they are ready")
    return Response(caption_file(preview.plan.captions, format), media_type=SUBTITLE_TYPES[f".{format}"])


@router.post("/jobs/{job_id}/candidates/{candidate_id}/prepare", status_code=202)
def prepare_candidate(job_id: str, candidate_id: str, store: Store, worker: JobWorker) -> Job:
    """Queue the Candidate to be prepared for the editor: its caption Words transcribed (its media
    Segments' Media Words among them) and its range analysed, in the render queue, so that its Preview Plan shows the Clip's own captions and Scenes.
    The Job is `rendering` meanwhile. Nothing is queued when both are saved already. 409 unless the
    Job is in review or rendering."""
    try:
        worker.prepare(job_id, candidate_id)
        return store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be prepared once it is in review") from None


def _media_words_view(store: JobStore, library: MediaStore, media_words: MediaWordsStore, job_id: str, media_id: str) -> MediaWordsView:
    try:
        job = store.get(job_id)
        item = library.get(media_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except MediaNotFound:
        raise HTTPException(404, f"No media {media_id}") from None
    if not has_media_words(item):
        raise HTTPException(422, f"{item.name} isn't a video with sound: it has no Media Words")
    language = media_language(job, item)
    status = media_words.status(media_id, language)
    words = media_words.saved(media_id, language) if status is MediaWordsStatus.READY else None
    return MediaWordsView(media_id=media_id, language=language, status=status, error=media_words.error(media_id, language), words=words)


@router.get("/jobs/{job_id}/media/{media_id}/words")
def media_words_of(job_id: str, media_id: str, store: Store, library: Media, media_words: MediaWordsDep) -> MediaWordsView:
    """A video's Media Words for the Job (`MediaWordsView`). 422 for an item that isn't a video with sound."""
    return _media_words_view(store, library, media_words, job_id, media_id)


@router.post("/jobs/{job_id}/media/{media_id}/words", status_code=202)
def transcribe_media_words(
    job_id: str, media_id: str, store: Store, library: Media, media_words: MediaWordsDep, worker: JobWorker,
    body: MediaWordsRequest | None = None,
) -> MediaWordsView:
    """Retry a video's Media Words for the Job: a remembered failure is forgotten and the video
    transcribed again in its language, in the render queue (the Job is `rendering` meanwhile).
    Nothing is queued when they are ready, unless `again` ("Transcribe again"), which replaces them.
    409 unless the Job is in review or rendering with its captions on."""
    view = _media_words_view(store, library, media_words, job_id, media_id)
    try:
        worker.transcribe_media(job_id, media_id, body.again if body else False)
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: its videos' Media Words can't be transcribed") from None
    return _media_words_view(store, library, media_words, job_id, view.media_id)


@router.post("/jobs/{job_id}/candidates", status_code=201)
def add_candidate(job_id: str, body: ManualCandidate, store: Store, settings: AppSettings, edit: EditBy) -> Candidate:
    """Add a manual Candidate for a transcript range, snapped to Words, after the AI's Candidates."""
    return _review(
        store, settings, job_id, lambda candidates, episode: review.add_manual(candidates, body.start, body.end, episode), edit
    )


def _history(store: JobStore, job: Job, candidate_id: str) -> list[HistoryEntry]:
    if not any(candidate.id == candidate_id for candidate in store.load_candidates(job.id) or []):
        raise HTTPException(404, f"Job {job.id} has no Candidate {candidate_id}")
    return store.revision_history(job.id, candidate_id)


def _entry(store: JobStore, job: Job, candidate_id: str, revision: int) -> HistoryEntry:
    entry = next((entry for entry in _history(store, job, candidate_id) if entry.revision == revision), None)
    if entry is None:
        raise HTTPException(404, f"Candidate {candidate_id} has no Revision {revision} in its Revision History")
    return entry


def _review(
    store: JobStore,
    settings: Settings,
    job_id: str,
    change: Callable[[list[Candidate], Episode], tuple[list[Candidate], Candidate]],
    edit: Edit,
) -> Candidate:
    def changed(job: Job, candidates: list[Candidate]) -> tuple[list[Candidate], Candidate]:
        transcript = store.load_transcript(job.id)
        assert job.source is not None and transcript is not None  # a Job in review has both
        episode = Episode(transcript, job.source.metadata.duration, job.options.max_secs, settings.selection)
        return change(candidates, episode)

    try:
        return store.change_candidates(job_id, changed, expect=EDITABLE, edit=edit)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be changed while it is in review") from None
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None
    except StaleRevision as exc:
        message = f"{exc}: it changed since this edit was made; merge the edit into it and save again"
        raise HTTPException(409, {"message": message, "candidate": _CANDIDATE.dump_python(exc.candidate, mode="json")}) from None


@router.post("/jobs/{job_id}/render")
def render(job_id: str, store: Store, worker: JobWorker, export_presets: ExportPresets, body: RenderRequest | None = None) -> list[Clip]:
    """Queue Clips of the selected Candidates (or of `candidate_ids`); the Job is `rendering` until
    they are done. A Candidate rendered before is rendered again, replacing its Clip. Returns the
    Job's Clips. Each Clip renders with `export_preset_id` (the default when left out) as it is when
    its render starts; a Clip asked for again while queued takes the latest. 422 when no Candidate is
    selected, or for an unknown Export Preset; 409 unless the Job is in review or rendering."""
    preset = _export_preset(export_presets, body.export_preset_id if body else None)
    try:
        worker.render(job_id, body.candidate_ids if body else None, preset.id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be rendered once it is in review") from None
    except NothingToRender as exc:
        raise HTTPException(422, str(exc)) from None
    return list_clips(job_id, store)


@router.get("/jobs/{job_id}/clips")
def list_clips(job_id: str, store: Store) -> list[Clip]:
    """The Job's Clips in their Candidates' order: the AI's by score, then the manual ones."""
    try:
        store.get(job_id)
        return ranked_clips(store.load_clips(job_id), store.load_candidates(job_id) or [])
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None


@router.get("/fonts")
def list_fonts(faces: FaceRegistry) -> list[FontInfo]:
    """The Faces text can be set in: the bundled ones, then the imported ones in the order they were
    imported. One whose file is gone from disk isn't listed."""
    return [FontInfo.of(face) for face in faces.all() if face.file.is_file()]


@router.post("/fonts", status_code=201)
def import_font(file: UploadFile, faces: FaceRegistry) -> FontImported:
    """Import an uploaded font (a multipart/form-data `file`: TTF, OTF or TTC) for every Job: a
    collection gives a Face per member, a variable font one per named instance. Faces already there
    aren't added again. A font that says it may not be embedded is imported with a warning. 422 for
    a file that isn't a font. (Not async: the font is split in a worker thread.)"""
    try:
        imported = faces.add(file.file.read(MAX_FONT_BYTES + 1), file.filename or "Font")
    except BadFont as exc:
        raise HTTPException(422, str(exc)) from None
    return FontImported(
        faces=[FontInfo.of(face) for face in imported.faces],
        existing=[FontInfo.of(face) for face in imported.existing],
        warnings=imported.warnings,
    )


@router.get("/fonts/{font_id}")
def font_file(font_id: str, faces: FaceRegistry, v: str | None = None) -> FileResponse:
    """A Face's file, for the preview to set text in. At its listed URL, whose `v` changes with the
    file, it is kept for good."""
    try:
        face = faces.get(font_id)
        path = faces.file(font_id)
    except (FaceNotFound, MissingFace):
        raise HTTPException(404, f"No font {font_id}") from None
    fresh = v is not None and face.sha256.startswith(v)
    headers = {"Cache-Control": _DERIVED["Cache-Control"] if fresh else "no-cache", "ETag": f'"{face.sha256}"'}
    return FileResponse(path, media_type="font/otf" if path.suffix == ".otf" else "font/ttf", headers=headers)


@router.get("/emoji/{codepoints}")
def emoji_image(codepoints: str) -> FileResponse:
    """The image Text Layers draw an emoji sequence from (app/emoji.py), by its codepoints in hex
    joined by dashes (1f468-200d-1f469), for the Face picker's samples: its own, or its first
    codepoint's."""
    try:
        name = emoji.image_of("".join(chr(int(code, 16)) for code in codepoints.split("-")))
    except ValueError:
        name = None
    if name is None:
        raise HTTPException(404, f"No emoji image for {codepoints}")
    return FileResponse(emoji.image_path(name), media_type="image/png", headers=_KEEP)


@router.delete("/fonts/{font_id}", status_code=204)
def delete_font(font_id: str, faces: FaceRegistry, store: Store, presets: Presets, text_presets: TextPresets) -> None:
    """Delete an imported Face and its file. 409 for a bundled one, and while a Candidate (as it is,
    or in its Revision History), a Style Preset or a Text Preset names it, listing where."""
    if faces.find(font_id) is None:
        raise HTTPException(404, f"No font {font_id}")
    if uses := face_uses(store, presets, text_presets, font_id):
        message = f"Font {font_id} is used by {'; '.join(use.where for use in uses)}: change them first"
        raise HTTPException(409, {"message": message, "uses": [use.model_dump() for use in uses]})
    try:
        faces.delete(font_id)
    except BundledFace:
        raise HTTPException(409, f"Font {font_id} comes with the app and can't be deleted") from None
    except FaceNotFound:
        raise HTTPException(404, f"No font {font_id}") from None


def face_uses(store: JobStore, presets: PresetStore, text_presets: TextPresetStore, face_id: str) -> list[FaceUse]:
    """The Candidates of every Job (with their Revision Histories), and the owner's Style Presets and
    Text Presets that name the Face."""
    uses = []
    for job in store.all():
        for candidate in store.load_candidates(job.id) or []:
            parts = list(candidate.faces().get(face_id, []))
            for entry in store.revision_history(job.id, candidate.id):
                if entry.revision != candidate.revision and face_id in entry.candidate.faces():
                    parts.append(f"Revision {entry.revision}")
            if parts:
                title = candidate.title or f"Clip {candidate.id}"
                uses.append(FaceUse(
                    kind="candidate", id=candidate.id, job_id=job.id, title=title, parts=parts,
                    where=f"{title} (Job {job.id}, Candidate {candidate.id}: {', '.join(parts)})",
                ))
    for preset in presets.all():
        parts = [section for section in ("caption", "hook", "watermark") if getattr(preset, section).font == face_id]
        if parts and not preset.builtin:
            uses.append(FaceUse(
                kind="style_preset", id=preset.id, title=preset.name, parts=parts,
                where=f"Style Preset {preset.name} ({', '.join(parts)})",
            ))
    for text_preset in text_presets.all():
        if text_preset.style.font == face_id and not text_preset.builtin:
            uses.append(FaceUse(
                kind="text_preset", id=text_preset.id, title=text_preset.name, parts=["Text Style"],
                where=f"Text Preset {text_preset.name}",
            ))
    return uses


@router.get("/looks")
def list_looks() -> list[Look]:
    """Every Look a Grade can have (app/looks.py): the built-in ones by their order, then the Imported
    ones as they were imported. Each with its id, name, category, Adjust values, whether it has a 3D
    table (an Imported Look) and the tables and matrix fitted to it, which the preview draws."""
    return all_looks()


@router.post("/looks", status_code=201)
def import_look(file: UploadFile, imported: ImportedLookStore) -> Look:
    """Import an uploaded `.cube` file (a multipart/form-data `file`) as a new Imported Look, kept for
    every Job: a 3D table of 2 to 65 a side. 422 naming the line for one that isn't."""
    try:
        return imported.add(file.file.read(MAX_LOOK_BYTES + 1), file.filename or "Look")
    except BadCube as exc:
        raise HTTPException(422, str(exc)) from None


@router.delete("/looks/{look_id}", status_code=204)
def delete_look(look_id: str, imported: ImportedLookStore, store: Store) -> None:
    """Delete an Imported Look and its table. 409 for a built-in one, and while a Candidate's Grade
    names it, listing them."""
    if any(look.id == look_id for look in builtin_looks()):
        raise HTTPException(409, f"Look {look_id} comes with the app and can't be deleted")
    try:
        look = imported.get(look_id)
    except LookNotFound:
        raise HTTPException(404, f"No Look {look_id}") from None
    if uses := look_uses(store, look_id):
        where = "; ".join(f"{use.title} (Job {use.job_id}, Candidate {use.candidate_id})" for use in uses)
        message = f"Look {look.name} is used by {where}: change their grades first"
        raise HTTPException(409, {"message": message, "uses": [use.model_dump() for use in uses]})
    try:
        imported.delete(look_id)
    except LookNotFound:
        raise HTTPException(404, f"No Look {look_id}") from None


def look_uses(store: JobStore, look_id: str) -> list["MediaUse"]:
    """The Candidates, of every Job, whose Grades name the Look."""
    return [
        MediaUse(job_id=job.id, candidate_id=candidate.id, title=candidate.title or f"Clip {candidate.id}")
        for job in store.all()
        for candidate in store.load_candidates(job.id) or []
        if look_id in candidate.looks()
    ]


@router.get("/text-presets")
def list_text_presets(text_presets: TextPresets) -> list[TextPresetInfo]:
    """The built-in Text Presets by their order, then the owner's, the one used for new titles marked."""
    default = text_presets.default()
    return [TextPresetInfo.of(preset, default) for preset in text_presets.all()]


@router.post("/text-presets", status_code=201)
def create_text_preset(body: TextPresetBody, text_presets: TextPresets) -> TextPresetInfo:
    """Save a Text Style as a new Text Preset of the owner's."""
    return TextPresetInfo.of(text_presets.create(body.name, body.style), text_presets.default())


@router.put("/text-presets/default")
def use_text_preset_for_new_titles(body: TextPresetChoice, text_presets: TextPresets) -> TextPresetInfo:
    """Use a Text Preset, built-in or the owner's, for new titles: by the Text tab's Add text, and for
    a Text Layer the agent adds without a style. 404 for an unknown one."""
    try:
        preset = text_presets.use_for_new_titles(body.id)
    except TextPresetNotFound:
        raise HTTPException(404, f"No Text Preset {body.id}") from None
    return TextPresetInfo.of(preset, preset)


@router.patch("/text-presets/{preset_id}")
def change_text_preset(preset_id: str, body: TextPresetChange, text_presets: TextPresets) -> TextPresetInfo:
    """Rename one of the owner's Text Presets, or give it another style. Text Layers made from it keep
    their look. 409 for a built-in Preset."""
    try:
        preset = text_presets.change(preset_id, body.name, body.style)
    except TextPresetNotFound:
        raise HTTPException(404, f"No Text Preset {preset_id}") from None
    except BuiltinTextPreset:
        raise HTTPException(409, f"Text Preset {preset_id} is built in: save a copy instead") from None
    return TextPresetInfo.of(preset, text_presets.default())


@router.delete("/text-presets/{preset_id}", status_code=204)
def delete_text_preset(preset_id: str, text_presets: TextPresets) -> None:
    """Delete one of the owner's Text Presets. Text Layers made from it keep their look; used for new
    titles, built-in Text is used again. 409 for a built-in Preset."""
    try:
        text_presets.delete(preset_id)
    except TextPresetNotFound:
        raise HTTPException(404, f"No Text Preset {preset_id}") from None
    except BuiltinTextPreset:
        raise HTTPException(409, f"Text Preset {preset_id} is built in and can't be deleted") from None


@router.get("/export-presets")
def list_export_presets(export_presets: ExportPresets, settings: AppSettings) -> ExportPresetList:
    """The built-in Export Presets by their order, then the owner's, with the default's id and the
    codecs that can be encoded here (a Preset of another codec fails to render)."""
    available = available_codecs(settings.ffmpeg_bin, settings.render)
    return ExportPresetList(export_presets.all(), export_presets.default().id, [codec for codec in Codec if codec in available])


@router.post("/export-presets", status_code=201)
def create_export_preset(body: ExportPresetBody, export_presets: ExportPresets) -> ExportPreset:
    """Save Export Settings as a new Export Preset of the owner's (a built-in one duplicated, say)."""
    return export_presets.create(body.name, body.settings)


@router.post("/export-presets/estimate")
def estimate_export(body: ExportEstimate) -> dict[str, int]:
    """The bytes Clips `secs` long in all come to as `settings` say: what the encoders aim for, video
    and sound (app/encoding.py). The sheet's MB per minute and the Render menu's total both ask here."""
    return {"bytes": estimated_bytes(body.settings, body.settings.fps or body.fps, body.secs)}


@router.put("/export-presets/default")
def use_export_preset_as_default(body: ExportPresetChoice, export_presets: ExportPresets) -> ExportPreset:
    """Make an Export Preset, built-in or the owner's, the one a render uses when none is asked for.
    404 for an unknown one."""
    try:
        return export_presets.use_as_default(body.preset_id)
    except ExportPresetNotFound:
        raise HTTPException(404, f"No Export Preset {body.preset_id}") from None


@router.put("/export-presets/{preset_id}")
def change_export_preset(preset_id: str, body: ExportPresetBody, export_presets: ExportPresets) -> ExportPreset:
    """Give one of the owner's Export Presets another name and settings. Its Clips keep theirs and
    never go stale; rendered again, they use these. 409 for a built-in Preset."""
    try:
        return export_presets.change(preset_id, body.name, body.settings)
    except ExportPresetNotFound:
        raise HTTPException(404, f"No Export Preset {preset_id}") from None
    except BuiltinExportPreset:
        raise HTTPException(409, f"Export Preset {preset_id} is built in: duplicate it instead") from None


@router.delete("/export-presets/{preset_id}", status_code=204)
def delete_export_preset(preset_id: str, export_presets: ExportPresets) -> None:
    """Delete one of the owner's Export Presets; its Clips render again with the default, and when it
    was the default, "Shorts / TikTok / Reels" is again. 409 for a built-in Preset."""
    try:
        export_presets.delete(preset_id)
    except ExportPresetNotFound:
        raise HTTPException(404, f"No Export Preset {preset_id}") from None
    except BuiltinExportPreset:
        raise HTTPException(409, f"Export Preset {preset_id} is built in and can't be deleted") from None


@router.get("/presets")
def list_presets(presets: Presets) -> list[StylePreset]:
    """The built-in Style Presets, then the owner's."""
    return presets.all()


@router.post("/presets", status_code=201)
def create_preset(body: PresetBody, presets: Presets, logos: Logos) -> StylePreset:
    """Save a new Preset. 422 for a Watermark whose Logo isn't one of the Logos."""
    _check_logo(logos, body.watermark.logo)
    return presets.create(body.name, body.caption, body.hook, body.watermark, body.join_transition)


@router.put("/presets/{preset_id}")
def update_preset(preset_id: str, body: PresetBody, presets: Presets, logos: Logos) -> StylePreset:
    """Replace one of the owner's Presets. Candidates using it render in it from now on. 409 for a
    built-in Preset; 422 for a Watermark whose Logo isn't one of the Logos."""
    _check_logo(logos, body.watermark.logo)
    try:
        return presets.update(preset_id, body.name, body.caption, body.hook, body.watermark, body.join_transition)
    except PresetNotFound:
        raise HTTPException(404, f"No Preset {preset_id}") from None
    except BuiltinPreset:
        raise HTTPException(409, f"Preset {preset_id} is built in: save a copy instead") from None


@router.delete("/presets/{preset_id}", status_code=204)
def delete_preset(preset_id: str, presets: Presets) -> None:
    """Delete one of the owner's Presets. Candidates using it render in Default. 409 for a built-in Preset."""
    try:
        presets.delete(preset_id)
    except PresetNotFound:
        raise HTTPException(404, f"No Preset {preset_id}") from None
    except BuiltinPreset:
        raise HTTPException(409, f"Preset {preset_id} is built in and can't be deleted") from None


def _check_logo(logos: LogoStore, logo_id: object) -> None:
    """422 for a Watermark given a Logo that isn't one of the Logos. (One deleted since it was chosen
    shows nothing, and doesn't stop other edits.)"""
    if isinstance(logo_id, str) and logos.find(logo_id) is None:
        raise HTTPException(422, f"Invalid style overrides: watermark.logo: no Logo {logo_id}")


@router.get("/logos")
def list_logos(logos: Logos) -> list[Logo]:
    """The Logos a Watermark can show, in the order they were uploaded."""
    return logos.all()


@router.post("/logos", status_code=201)
async def upload_logo(file: UploadFile, logos: Logos) -> Logo:
    """Keep an uploaded image (a multipart/form-data `file`: PNG, JPEG or WebP, 5 MB at most) as a
    Logo. 422 for anything else."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        return logos.add(data, file.filename or "Logo")
    except BadLogo as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/logos/{logo_id}")
def logo_file(logo_id: str, logos: Logos) -> FileResponse:
    """A Logo's PNG, for the preview to draw."""
    try:
        return FileResponse(logos.file(logo_id), media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})
    except LogoNotFound:
        raise HTTPException(404, f"No Logo {logo_id}") from None


@router.delete("/logos/{logo_id}", status_code=204)
def delete_logo(logo_id: str, logos: Logos) -> None:
    """Delete a Logo. Presets and Candidates that show it show no Watermark from now on."""
    try:
        logos.delete(logo_id)
    except LogoNotFound:
        raise HTTPException(404, f"No Logo {logo_id}") from None


class MediaChange(BaseModel):
    """A change to a Media Library item."""

    model_config = ConfigDict(extra="forbid")

    # The language its Media Words are transcribed in, in every Job; null: each Job's.
    language: Language | None


class MediaUse(BaseModel):
    """A Candidate that uses a Media Library item."""

    job_id: str
    candidate_id: str
    title: str


@router.get("/media")
def list_media(library: Media) -> list[MediaItem]:
    """The Media Library, in the order it was uploaded."""
    return library.all()


@router.post("/media", status_code=201)
def upload_media(file: UploadFile, library: Media) -> MediaItem:
    """Keep an uploaded video (3 minutes and 500 MB at most), song (50 MB) or image (10 MB), a
    multipart/form-data `file`, in the Media Library, normalized. 422 for anything else. (Not async:
    the upload is copied and converted in a worker thread.)"""
    try:
        return library.add(file.file, file.filename or "Media")
    except BadMedia as exc:
        raise HTTPException(422, str(exc)) from None


@router.patch("/media/{media_id}")
def change_media(media_id: str, body: MediaChange, library: Media) -> MediaItem:
    """Set a video's language (null: each Job's). Its Media Words in that language are transcribed by
    the next preparation or render of a Candidate showing it; those of other languages are kept."""
    try:
        if library.get(media_id).kind is not MediaKind.VIDEO:
            raise HTTPException(422, "Only a video has a language")
        return library.set_language(media_id, body.language)
    except MediaNotFound:
        raise HTTPException(404, f"No media {media_id}") from None


@router.get("/media/{media_id}")
def media_item_file(media_id: str, library: Media) -> FileResponse:
    """An item's normalized file (MP4, M4A or PNG), with range support for the players."""
    try:
        item = library.get(media_id)
        return FileResponse(library.file(media_id), media_type=MEDIA_TYPES[item.kind], headers=_KEEP)
    except MediaNotFound:
        raise HTTPException(404, f"No media {media_id}") from None


@router.get("/media/{media_id}/proxy")
def media_proxy(media_id: str, library: Media) -> FileResponse:
    """A video's small copy, for the editor's preview."""
    try:
        return FileResponse(library.proxy(media_id), media_type="video/mp4", headers=_KEEP)
    except MediaNotFound:
        raise HTTPException(404, f"No video {media_id}") from None


@router.get("/media/{media_id}/thumbnail")
def media_thumbnail(media_id: str, library: Media) -> FileResponse:
    """A still of a video (JPEG), or an image itself."""
    try:
        path = library.thumbnail(media_id)
        return FileResponse(path, media_type="image/jpeg" if path.suffix == ".jpg" else "image/png", headers=_KEEP)
    except MediaNotFound:
        raise HTTPException(404, f"No video or image {media_id}") from None


@router.get(f"/media/{{media_id}}/filmstrip/{STRIP_VERSION}/{{start}}.jpg")
def media_filmstrip(media_id: str, start: int, library: Media) -> FileResponse:
    """A video's Filmstrip chunk from `start` seconds (a multiple of 30): its frames at each whole
    second, side by side, with their count in X-Frames. Made now for a video uploaded before
    Filmstrips. 404 for a `start` off the grid or past the end, or an item that isn't a video."""
    try:
        chunk, frames = library.filmstrip(media_id, start)
    except MediaNotFound:
        raise HTTPException(404, f"No Filmstrip of {media_id} from {start} s") from None
    return FileResponse(chunk, media_type="image/jpeg", headers={**_DERIVED, "X-Frames": str(frames)})


@router.get(f"/media/{{media_id}}/peaks/{PEAKS_VERSION}/{{start}}.peaks")
def media_peaks(media_id: str, start: int, library: Media) -> FileResponse:
    """A video's or a song's Peaks chunk from `start` seconds (a multiple of 30): the min and max of
    each millisecond of its sound, in the layout app/derived.py gives. Made now for an item uploaded
    before Peaks. 404 for a `start` off the grid or past the end, an image, or a video without sound."""
    try:
        chunk = library.peaks(media_id, start)
    except MediaNotFound:
        raise HTTPException(404, f"No Peaks of {media_id} from {start} s") from None
    return FileResponse(chunk, media_type="application/octet-stream", headers=_DERIVED)


@router.post("/media/{media_id}/retimed")
def media_retimed(media_id: str, body: RetimedRequest, library: Media, settings: AppSettings, worker: JobWorker) -> RetimedCopy:
    """The preview-size Retimed copy of a video's or a song's range from `start` to `end` seconds, as
    the editor asks for it while it previews a reversed item, or one at a Speed a browser won't play,
    then polls (app/retimed.py): any copy that serves it, or the one being made, or one queued now and
    made outside the Worker, on every core unless the Worker is running a Job. 404 for an image; 422
    for a range outside it, or one played forwards at 1×."""
    try:
        item = library.get(media_id)
        copies = library.retimed(media_id)
    except MediaNotFound:
        raise HTTPException(404, f"No video or song {media_id}") from None
    what = "the song" if item.kind is MediaKind.AUDIO else "the video"
    return _ask_retimed(copies, item.duration or 0.0, what, body, f"/api/media/{media_id}/retimed", settings, worker)


@router.get("/media/{media_id}/retimed/{name}")
def media_retimed_file(media_id: str, name: str, library: Media) -> FileResponse:
    """A video's or a song's Retimed copy, by the name its `url` gives."""
    try:
        copies = library.retimed(media_id)
    except MediaNotFound:
        raise HTTPException(404, f"No video or song {media_id}") from None
    file = copies.folder / name
    if Retime.named(name) is None or not file.is_file():
        raise HTTPException(404, f"No copy {name} of {media_id}")
    return FileResponse(file, media_type="video/mp4", headers=_DERIVED)


def _ask_retimed(
    copies: Copies, duration: float, what: str, body: RetimedRequest, folder: str, settings: Settings, worker: Worker
) -> RetimedCopy:
    """How the preview-size copy of `body`'s range of `what` (the Source, or a video), `duration`
    seconds long, is coming along (`Copies.ask`, on one thread while the Worker runs a Job), its file
    served in `folder` (a URL). 422 for a range outside it, or one played forwards at 1×."""
    if not body.start < body.end <= duration + 0.05:
        raise HTTPException(422, f"No range {body.start:g}–{body.end:g} s in {what} ({duration:g} s)")
    if not body.reverse and body.speed == 1:
        raise HTTPException(422, f"A copy forwards at 1× is {what} itself")
    retime = Retime(body.start, min(body.end, duration), body.reverse, body.speed, body.pitch)
    making = copies.ask(settings.ffmpeg_bin, CopySize.PREVIEW, retime, threads=lambda: 1 if worker.busy else 0)
    if making.copy is None:
        return RetimedCopy(progress=making.progress, error=making.error)
    return RetimedCopy(progress=1, url=f"{folder}/{making.copy.path.name}", at=making.copy.at(retime.start, retime.end))


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: str, library: Media, store: Store) -> None:
    """Delete an item and its files. 409 while a Candidate uses it, naming them."""
    try:
        library.get(media_id)
    except MediaNotFound:
        raise HTTPException(404, f"No media {media_id}") from None
    if uses := media_uses(store, media_id):
        raise HTTPException(409, {"message": "Used by clips: remove it from them first", "uses": [use.model_dump() for use in uses]})
    library.delete(media_id)


def sweep_unused(store: JobStore, library: MediaStore, job_id: str) -> None:
    """Remove the Retimed copies (app/retimed.py) of the Job's Source, and of the videos and songs no
    other Job's Candidates use (`media_uses`), that none of its Candidates nor any state in their Revision
    History plays from; and the Job's picture layers' pictures (app/layer_pictures.py) none of them
    shows, and the folder they were kept in before (OLD_PICTURES_DIR), whole."""
    states = []
    for candidate in store.load_candidates(job_id) or []:
        states += [candidate, *(entry.candidate for entry in store.revision_history(job_id, candidate.id))]
    timed = {item.id: item.duration or 0.0 for item in library.all() if item.kind is not MediaKind.IMAGE}
    used = copies_used(states, timed)
    sweep(store.job_dir(job_id) / RETIMED_DIR, used.get(None, []))
    for media_id in sorted(set().union(*(state.media_ids() for state in states)) & timed.keys()):
        if all(use.job_id == job_id for use in media_uses(store, media_id)):
            sweep(library.retimed(media_id).folder, used.get(media_id, []))
    sweep_pictures(store.job_dir(job_id) / PICTURES_DIR, pictures_used(states))
    shutil.rmtree(store.job_dir(job_id) / OLD_PICTURES_DIR, ignore_errors=True)


def media_uses(store: JobStore, media_id: str) -> list[MediaUse]:
    """The Candidates, of every Job, that use the item."""
    uses = []
    for job in store.all():
        for candidate in store.load_candidates(job.id) or []:
            if media_id in candidate.media_ids():
                uses.append(MediaUse(job_id=job.id, candidate_id=candidate.id, title=candidate.title or f"Clip {candidate.id}"))
    return uses


def _check_media_of(library: MediaStore, body: CandidateUpdate) -> None:
    """422 for an edit naming Media Library items that aren't there, or can't be used so: music must
    be a song or a video with sound, within its length at its Speed, a Segment a video, within its
    length, and an Overlay within its video's at its Speed, an image's having no Speed nor Reverse.
    (Music of the Source is kept within it by `review.update`.)"""
    for clip in body.music or []:
        if clip.media is None:
            continue
        item = library.find(clip.media)
        if item is None or not item.has_audio:
            raise HTTPException(422, f"Music Clip {clip.id}: no song or video with sound {clip.media} in the Media Library")
        if item.duration is not None and overlay_time(clip.offset, clip.secs, clip.speed, clip.reverse).end > item.duration + 0.05:
            at_speed = f" at {clip.speed:g}x" if clip.speed != 1 else ""
            song = "song" if item.kind is MediaKind.AUDIO else "video"
            raise HTTPException(422, f"Music Clip {clip.id} runs past the end of its {song} ({item.duration:g} s){at_speed}")
    for segment in body.segments or []:
        if segment.media is None:
            continue
        item = library.find(segment.media)
        if item is None or item.kind is not MediaKind.VIDEO:
            raise HTTPException(422, f"Segment {segment.id}: no video {segment.media} in the Media Library")
        if item.duration is not None and segment.end > item.duration + 0.05:
            raise HTTPException(422, f"Segment {segment.id} runs past the end of its video ({item.duration:g} s)")
    for overlay in body.overlays or []:
        item = library.find(overlay.media)
        if item is None or item.kind is MediaKind.AUDIO:
            raise HTTPException(422, f"Overlay {overlay.id}: no video or image {overlay.media} in the Media Library")
        if item.duration is not None and overlay_time(overlay.offset, overlay.secs, overlay.speed, overlay.reverse).end > item.duration + 0.05:
            at_speed = f" at {overlay.speed:g}x" if overlay.speed != 1 else ""
            raise HTTPException(422, f"Overlay {overlay.id} runs past the end of its video ({item.duration:g} s){at_speed}")
        if KeyProperty.VOLUME in overlay.keys and item.kind is not MediaKind.VIDEO:
            raise HTTPException(422, f"Overlay {overlay.id} has no volume Keyframes: an image has no sound")
        if (overlay.speed != 1 or overlay.pitch or overlay.reverse) and item.kind is not MediaKind.VIDEO:
            raise HTTPException(422, f"Overlay {overlay.id} is an image: it has no Speed, pitch or Reverse")


def _check_looks_of(body: CandidateUpdate) -> None:
    """422 for an edit giving a Grade a Look that isn't one of the Looks."""
    for what, grade in grades_of(body.grade, body.segments or [], body.overlays or [], body.adjustment_layers or []):
        if grade.look is None:
            continue
        try:
            get_look(grade.look)
        except LookNotFound:
            raise HTTPException(422, f"{what}: no Look {grade.look}") from None


# Media Library files never change under their id.
_KEEP = {"Cache-Control": "public, max-age=604800"}
# Nor do Filmstrips and Peaks, whose format is in their URL (docs/adr/0005-timeline-media-is-derived-per-chunk.md),
# nor Retimed copies, named by their range (docs/adr/0009).
_DERIVED = {"Cache-Control": "public, max-age=31536000, immutable"}


def _export_preset(export_presets: ExportPresetStore, preset_id: str | None) -> ExportPreset:
    """The Export Preset `preset_id`, or the default when None; 422 for an unknown one."""
    try:
        return export_presets.default() if preset_id is None else export_presets.get(preset_id)
    except ExportPresetNotFound:
        raise HTTPException(422, f"No Export Preset {preset_id}") from None


def _preset(presets: PresetStore, preset_id: str) -> StylePreset:
    try:
        return presets.get(preset_id)
    except PresetNotFound:
        raise HTTPException(404, f"No Preset {preset_id}") from None


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


@media.get("/{job_id}/{path:path}")
def media_file(job_id: str, path: str, store: Store) -> FileResponse:
    """A video, image or caption file from a Job's directory, with HTTP range support (206 Partial
    Content), so the browser's player can seek in a long Source. Only files inside that directory
    are served."""
    try:
        job_dir = store.job_dir(job_id).resolve()
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    file = (job_dir / path).resolve()
    if not (file.is_relative_to(job_dir) and file.suffix.lower() in MEDIA_SUFFIXES and file.is_file()):
        raise HTTPException(404, f"No media {path!r} in Job {job_id}")
    return FileResponse(file, media_type=SUBTITLE_TYPES.get(file.suffix.lower()))
