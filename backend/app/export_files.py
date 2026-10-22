"""Export files (GLOSSARY): a frame (PNG) or a Candidate's sound alone (WAV or M4A) saved on request,
kept in its Job's EXPORTS_DIR, which goes with the Job. Not a Clip: never stale, never in the render
queue, made synchronously by a Renderer of their own outside it, so the Job's status doesn't change.
Each is overwritten when saved again under its name.

A frame is drawn as the render draws it (app/renderer.py, `Renderer.frame`): the Candidate's plan
(its Preview Plan's, from cached analysis only) at the Export Preset's frame rate, drawn at its size,
from the same inputs (`drawing_inputs`), Retimed copies made when needed.

The sound is the saved Revision's mix as its Clip's would be (the Clip's sound or its Segments', Music
Clips, Overlay sound, volumes, Keyframes, fades, Mutes, ducking and Speed), normalized to an Export
Preset's loudness. Nothing is transcribed or analysed (the plan's Scenes stay unanalysed): the
speech that ducks its music is the Words already at hand, as a render without captions hears it. A
reversed Segment or Overlay's Retimed copy is made when it isn't there, as a render would.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path

from app.analysis import ClipAnalysis
from app.audio_effects import MEASURED_DIR
from app.candidates import Candidate
from app.config import Settings
from app.encoding import ExportSettings
from app.jobs import Job
from app.logos import LogoStore
from app.matte import MatteRunner
from app.media import MediaStore
from app.planner import RenderPlan
from app.renderer import AudioFormat, Renderer, shown_frame
from app.rendering import candidate_plan, drawing_inputs, music_words, played_files, words_at_hand
from app.styles import PresetStore
from app.transcript import Transcript, Word

EXPORTS_DIR = "exports"


@dataclass(frozen=True)
class SavedExport:
    """A saved Export file: its path on this Mac, its name, and its URL, served from the Job's
    directory with its time, since a file saved again keeps its name."""

    path: str
    name: str
    url: str


def saved_export(job_id: str, job_dir: Path, path: Path) -> SavedExport:
    """The Export file at `path`, in the Job's directory `job_dir`, as a SavedExport."""
    url = f"/media/{job_id}/{path.relative_to(job_dir).as_posix()}?v={path.stat().st_mtime_ns}"
    return SavedExport(str(path.resolve()), path.name, url)


def frame_name(candidate_id: str, at: float, fps: float, duration: float) -> str:
    """The file name of the Candidate's frame shown at `at` seconds into its Clip, `duration` long at
    `fps`: `<candidate>-<mm.ss.ff>.png`, ff its frame within the second."""
    number = shown_frame(at, fps, duration)
    secs = math.floor(number / fps + 1e-6)
    frames = number - math.ceil(secs * fps - 1e-6)
    return f"{candidate_id}-{secs // 60:02d}.{secs % 60:02d}.{frames:02d}.png"


def audio_name(candidate_id: str, format: AudioFormat) -> str:
    """The file name of the Candidate's saved sound: one per format."""
    return f"{candidate_id}.{format}"


def save_frame(
    job: Job,
    job_dir: Path,
    candidate_id: str,
    plan: RenderPlan,
    at: float,
    export: ExportSettings,
    settings: Settings,
    media: MediaStore,
    logos: LogoStore,
    mattes: MatteRunner | None = None,
) -> Path:
    """Write the frame of `plan` (the Candidate's, at `export`'s frame rate) shown at `at` seconds
    into it, drawn at `export`'s size, as its `frame_name`, and return its path. Its cut-out Segments'
    Matte pieces are made by `mattes` when they aren't there."""
    return _written(
        job_dir, frame_name(candidate_id, at, plan.fps, plan.duration), settings,
        lambda _, path: draw_frame(job, job_dir, plan, at, path, export, settings, media, logos, mattes),
    )


def draw_frame(
    job: Job,
    job_dir: Path,
    plan: RenderPlan,
    at: float,
    path: Path,
    export: ExportSettings,
    settings: Settings,
    media: MediaStore,
    logos: LogoStore,
    mattes: MatteRunner | None = None,
) -> None:
    """Draw the frame of `plan` shown at `at` seconds into it, at `export`'s size, as a PNG at `path`,
    as the render draws it (with a Renderer of its own): save_frame's drawing, which Compare render
    (GLOSSARY) uses too, writing it outside the Job."""
    assert job.source is not None
    source = job.source
    drawn, logo, files, pictures = drawing_inputs(plan, export, job_dir, source, settings, media, logos, mattes=mattes)
    Renderer(settings.ffmpeg_bin, settings.render).frame(job_dir / source.video, drawn, at, path, logo, files, pictures, export)


def save_audio(
    job: Job,
    job_dir: Path,
    transcript: Transcript | None,
    candidate: Candidate,
    format: AudioFormat,
    export: ExportSettings,
    settings: Settings,
    presets: PresetStore,
    media: MediaStore,
) -> Path:
    """Write the Candidate's sound alone at `export`'s loudness as its `audio_name`, and return its path.
    Its speech, which ducks its music, is the Words at hand (`words_at_hand`, from `transcript`), as
    a render without captions hears it."""
    assert job.source is not None
    source = job.source
    unanalysed: list[ClipAnalysis | None] = [None for _ in candidate.main_track()]
    duration, language, model = source.metadata.duration, job.options.language, settings.whisper_model

    def at_hand(start: float, end: float) -> list[Word]:
        return words_at_hand(job_dir, transcript, start, end, duration, language, model)

    words = [
        [] if segment.media is not None or segment.hold is not None or segment.reverse else at_hand(segment.start, segment.end)
        for segment in candidate.main_track()
    ]
    plan = candidate_plan(
        candidate, source.metadata, words, unanalysed, presets, settings.camera, media=media,
        captioned=False, music=music_words(candidate, at_hand),
    )
    # Its picture isn't drawn: an Overlay's sound is among the plan's audio, so its picture needs no copy.
    plan, files = played_files(replace(plan, overlays=[]), job_dir, source, media, settings.ffmpeg_bin)
    return _written(
        job_dir, audio_name(candidate.id, format), settings,
        lambda renderer, path: renderer.render_audio(job_dir / source.video, plan, path, format, export.loudness, files, job_dir / MEASURED_DIR),
    )


def _written(job_dir: Path, name: str, settings: Settings, write: Callable[[Renderer, Path], None]) -> Path:
    """The path of the Export file `name` in the Job's EXPORTS_DIR, once `write` has written it there
    with a Renderer of its own."""
    path = job_dir / EXPORTS_DIR / name
    path.parent.mkdir(exist_ok=True)
    write(Renderer(settings.ffmpeg_bin, settings.render), path)
    return path
