"""HTTP API routes. Services come from `app.state`, set up by `create_app`."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, TypeAdapter, ValidationError

from app import review
from app.candidates import Candidate, Layout, WordEdit
from app.clips import Clip
from app.config import Settings
from app.editor import PreviewPlan, preview_plan
from app.events import job_events
from app.fonts import FONTS
from app.jobs import Job, JobConflict, JobNotFound, JobOptions, JobStatus, JobStore
from app.planner import HOOK_SIZE, fit_hook, font_metrics
from app.profile import ChannelProfile, ProfileStore
from app.rendering import NothingToRender, ranked_clips
from app.review import MAX_CLIP_SECS, CandidateChange, CandidateNotFound, Episode, InvalidEdit
from app.storage import DiskUsage, disk_usage
from app.styles import BuiltinPreset, CaptionStyle, HookStyle, InvalidStyle, Name, PresetNotFound, PresetStore, StyleOverrides, StylePreset
from app.transcript import Transcript
from app.uploads import OPTIONS_FIELD, UPLOADS_DIR, BadUpload, NotEnoughSpace, check_room, receive
from app.worker import Worker

router = APIRouter(prefix="/api")
media = APIRouter(prefix="/media")

# The statuses in which the owner can change a Job's Candidates: not before the Job has them, nor
# while it is analyzed again and its untouched Candidates are about to be replaced. Review goes on
# while Clips render; each render takes its Candidate as it is when the render starts.
EDITABLE = frozenset({JobStatus.REVIEW, JobStatus.RENDERING})
# What /media serves from a Job's directory: its video (or preview proxy), and its Clips and their
# posters. An uploaded master the browser can play may be a QuickTime file (app/preview.py).
MEDIA_SUFFIXES = frozenset({".mp4", ".m4v", ".mov", ".m4a", ".jpg", ".png"})
# The longest hook text accepted. The UI warns well before this, once the text doesn't fit in the
# hook's two lines (GET /api/hook).
HOOK_MAX_CHARS = 200
# The most Word Edits a Candidate holds: more than a 3-minute clip has Words.
WORD_EDITS_MAX = 500

_OPTIONS = TypeAdapter(JobOptions)


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
ExistingJob = Annotated[Job, Depends(_job)]


class JobRequest(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    options: JobOptions = JobOptions()


class CandidateUpdate(BaseModel):
    """A review edit; a field left out stays as it is. `start` and `end` are snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat | None = None
    end: FiniteFloat | None = None
    hook_text: Annotated[str, StringConstraints(max_length=HOOK_MAX_CHARS)] | None = None
    layout: Layout | None = None
    selected: bool | None = None
    preset_id: str | None = None
    # Replaces the Candidate's overrides as a whole.
    style_overrides: StyleOverrides | None = None
    # Replaces the Candidate's Word Edits as a whole.
    word_edits: Annotated[list[WordEdit], Field(max_length=WORD_EDITS_MAX)] | None = None
    # Seconds into the Clip; the planner keeps them in it.
    hook_start: Annotated[float, Field(ge=0, le=MAX_CLIP_SECS)] | None = None
    hook_secs: Annotated[float, Field(ge=0.5, le=30)] | None = None


class PresetBody(BaseModel):
    """A Style Preset as the owner saves it."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    caption: CaptionStyle = CaptionStyle()
    hook: HookStyle = HookStyle()


class ManualCandidate(BaseModel):
    """A transcript range to make a manual Candidate of, snapped to Words."""

    model_config = ConfigDict(extra="forbid")

    start: FiniteFloat
    end: FiniteFloat


class HookFit(BaseModel):
    """How a hook text is shown on the Clip: its lines, and whether they fit at the hook's size."""

    lines: list[str]
    fits: bool


class FontInfo(BaseModel):
    """A bundled font, and its measures in its units: what the preview needs to set text as libass
    does, which sizes a font by its Windows ascent plus descent (`units`) rather than its em."""

    id: str
    label: str
    family: str
    units: int
    em: int
    ascent: int
    cap_height: int
    descent: int


class RenderRequest(BaseModel):
    """The Candidates to render; the selected ones when left out."""

    model_config = ConfigDict(extra="forbid")

    candidate_ids: list[str] | None = None


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
def list_jobs(store: Store) -> list[Job]:
    return store.all()


@router.get("/jobs/{job_id}")
def get_job(job_id: str, store: Store) -> JobDetail:
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    candidates = store.load_candidates(job_id)
    return JobDetail(
        **vars(job),
        transcript=store.load_transcript(job_id),
        candidates=candidates,
        clips=ranked_clips(store.load_clips(job_id), candidates or []),
    )


@router.get("/jobs/{job_id}/events", response_class=EventSourceResponse)
async def stream_job_events(job: ExistingJob, store: Store) -> AsyncIterator[ServerSentEvent]:
    """The Job's progress (status, stage, percent, message, error, warnings, retry_at) as `job`
    events: one now, then one per change. The stream ends with an `end` event once the Job is in
    review or error, or is deleted; after a retry, open it again."""
    async for event in job_events(store, job.id):
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
    job_id: str, candidate_id: str, body: CandidateUpdate, store: Store, settings: AppSettings, presets: Presets
) -> Candidate:
    """Change a Candidate's bounds (snapped to Words), hook text, layout, Style Preset, Style
    Overrides or selected flag, and save it at once. 422 for a range that isn't a usable clip or
    overrides that don't make a valid style; 404 for an unknown Preset; 409 unless the Job is in review."""
    if body.preset_id is not None:
        _preset(presets, body.preset_id)
    change = CandidateChange(**{name: getattr(body, name) for name in CandidateUpdate.model_fields})

    def update(candidates: list[Candidate], episode: Episode) -> tuple[list[Candidate], Candidate]:
        candidates, candidate = review.update(candidates, candidate_id, change, episode)
        try:
            presets.styles(candidate.preset_id, candidate.style_overrides)
        except InvalidStyle as exc:
            raise InvalidEdit(f"Invalid style overrides: {exc}") from None
        return candidates, candidate

    return _review(store, settings, job_id, update)


@router.post("/jobs/{job_id}/candidates/{candidate_id}/preview-plan")
def candidate_preview_plan(
    job_id: str, candidate_id: str, store: Store, settings: AppSettings, presets: Presets, body: CandidateUpdate | None = None
) -> PreviewPlan:
    """The Candidate's Preview Plan (app/editor.py): its Render Plan, or that of `body`, a draft of
    edits applied as an update would apply them but not saved. 422 for a draft that isn't a valid
    edit; 409 for a Job without Candidates."""
    try:
        job = store.get(job_id)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    transcript, candidates = store.load_transcript(job_id), store.load_candidates(job_id)
    if job.source is None or transcript is None or candidates is None:
        raise HTTPException(409, f"Job {job_id} has no Candidates yet")
    if body is not None and body.preset_id is not None:
        _preset(presets, body.preset_id)
    episode = Episode(transcript, job.source.metadata.duration, job.options.max_secs, settings.selection)
    change = CandidateChange(**{name: getattr(body, name) for name in CandidateUpdate.model_fields}) if body else CandidateChange()
    try:
        _, candidate = review.update(candidates, candidate_id, change, episode)
        return preview_plan(job, store.job_dir(job_id), transcript, candidate, settings, presets)
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None
    except InvalidStyle as exc:
        raise HTTPException(422, f"Invalid style overrides: {exc}") from None


@router.post("/jobs/{job_id}/candidates/{candidate_id}/prepare", status_code=202)
def prepare_candidate(job_id: str, candidate_id: str, store: Store, worker: JobWorker) -> Job:
    """Queue the Candidate to be prepared for the editor: its caption Words transcribed and its range
    analysed, in the render queue, so that its Preview Plan shows the Clip's own captions and Scenes.
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


@router.get("/hook")
def hook_fit(text: Annotated[str, Query(max_length=HOOK_MAX_CHARS)] = "") -> HookFit:
    """How the hook `text` will be set (app/planner.py's fit_hook), for Review to warn about one too
    long for two lines, which the render sets smaller."""
    lines, size = fit_hook(text)
    return HookFit(lines=lines, fits=size == HOOK_SIZE)


@router.post("/jobs/{job_id}/candidates", status_code=201)
def add_candidate(job_id: str, body: ManualCandidate, store: Store, settings: AppSettings) -> Candidate:
    """Add a manual Candidate for a transcript range, snapped to Words, after the AI's Candidates."""
    return _review(
        store, settings, job_id, lambda candidates, episode: review.add_manual(candidates, body.start, body.end, episode)
    )


def _review(
    store: JobStore,
    settings: Settings,
    job_id: str,
    change: Callable[[list[Candidate], Episode], tuple[list[Candidate], Candidate]],
) -> Candidate:
    def edit(job: Job, candidates: list[Candidate]) -> tuple[list[Candidate], Candidate]:
        transcript = store.load_transcript(job.id)
        assert job.source is not None and transcript is not None  # a Job in review has both
        episode = Episode(transcript, job.source.metadata.duration, job.options.max_secs, settings.selection)
        return change(candidates, episode)

    try:
        return store.change_candidates(job_id, edit, expect=EDITABLE)
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    except CandidateNotFound as exc:
        raise HTTPException(404, f"Job {job_id} has no Candidate {exc}") from None
    except JobConflict as exc:
        raise HTTPException(409, f"{exc}: Candidates can be changed while it is in review") from None
    except InvalidEdit as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/jobs/{job_id}/render")
def render(job_id: str, store: Store, worker: JobWorker, body: RenderRequest | None = None) -> list[Clip]:
    """Queue Clips of the selected Candidates (or of `candidate_ids`); the Job is `rendering` until
    they are done. A Candidate rendered before is rendered again, replacing its Clip. Returns the
    Job's Clips. 422 when no Candidate is selected; 409 unless the Job is in review or rendering."""
    try:
        worker.render(job_id, body.candidate_ids if body else None)
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
def list_fonts() -> list[FontInfo]:
    """The fonts captions and the hook can be set in."""
    fonts = []
    for font in FONTS.values():
        metrics = font_metrics(font.id)
        fonts.append(FontInfo(
            id=font.id, label=font.label, family=font.family, units=metrics.units, em=metrics.em,
            ascent=metrics.ascent, cap_height=metrics.cap_height, descent=metrics.descent,
        ))
    return fonts


@router.get("/fonts/{font_id}")
def font_file(font_id: str) -> FileResponse:
    """A bundled font's file, for the preview to set text in."""
    if font_id not in FONTS:
        raise HTTPException(404, f"No font {font_id}")
    return FileResponse(FONTS[font_id].file, media_type="font/ttf", headers={"Cache-Control": "public, max-age=604800"})


@router.get("/presets")
def list_presets(presets: Presets) -> list[StylePreset]:
    """The built-in Style Presets, then the owner's."""
    return presets.all()


@router.post("/presets", status_code=201)
def create_preset(body: PresetBody, presets: Presets) -> StylePreset:
    return presets.create(body.name, body.caption, body.hook)


@router.put("/presets/{preset_id}")
def update_preset(preset_id: str, body: PresetBody, presets: Presets) -> StylePreset:
    """Replace one of the owner's Presets. Candidates using it render in it from now on. 409 for a
    built-in Preset."""
    try:
        return presets.update(preset_id, body.name, body.caption, body.hook)
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
    """A video or image from a Job's directory, with HTTP range support (206 Partial Content), so
    the browser's player can seek in a long Source. Only files inside that directory are served."""
    try:
        job_dir = store.job_dir(job_id).resolve()
    except JobNotFound:
        raise HTTPException(404, f"No Job {job_id}") from None
    file = (job_dir / path).resolve()
    if not (file.is_relative_to(job_dir) and file.suffix.lower() in MEDIA_SUFFIXES and file.is_file()):
        raise HTTPException(404, f"No media {path!r} in Job {job_id}")
    return FileResponse(file)
