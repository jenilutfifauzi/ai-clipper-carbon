"""Save audio: a Candidate's sound alone, as WAV or M4A, an Export file kept in its Job's EXPORTS_DIR.

It is the saved Revision's mix as its Clip's would be (the Clip's sound or its Segments', Music Clips,
Overlay sound, volumes, Keyframes, fades and Speed), normalized to an Export Preset's loudness, and is
rendered at once, outside the render queue: the Job's status doesn't change, and nothing is
transcribed or analysed, since neither changes the sound (the plan's Scenes stay unanalysed). A
reversed Segment or Overlay's Retimed copy is made when it isn't there, as a render would.
"""

from dataclasses import replace
from pathlib import Path

from app.analysis import ClipAnalysis
from app.candidates import Candidate
from app.config import Settings
from app.encoding import ExportSettings
from app.jobs import Job
from app.media import MediaStore
from app.renderer import AudioFormat, Renderer
from app.rendering import candidate_plan, played_files
from app.styles import PresetStore

# Where a Job's Export files are kept (docs: GLOSSARY "Export file"); removed with the Job.
EXPORTS_DIR = "exports"


def audio_file(candidate_id: str, kind: AudioFormat) -> str:
    """The Candidate's saved sound, in its Job's directory: one per format, overwritten."""
    return f"{EXPORTS_DIR}/{candidate_id}.{kind}"


def save_audio(
    job: Job,
    job_dir: Path,
    candidate: Candidate,
    kind: AudioFormat,
    export: ExportSettings,
    settings: Settings,
    presets: PresetStore,
    media: MediaStore,
) -> Path:
    """Write the Candidate's sound alone at `export`'s loudness to its `audio_file`, and return its path."""
    assert job.source is not None
    unanalysed: list[ClipAnalysis | None] = [None for _ in candidate.main_track()]
    plan = candidate_plan(candidate, job.source.metadata, None, unanalysed, presets, settings.camera, media=media)
    # Its picture isn't drawn: an Overlay's sound is among the plan's audio, so its picture needs no copy.
    plan, files = played_files(replace(plan, overlays=[]), job_dir, job.source, media, settings.ffmpeg_bin)
    path = job_dir / audio_file(candidate.id, kind)
    path.parent.mkdir(exist_ok=True)
    Renderer(settings.ffmpeg_bin, settings.render).render_audio(job_dir / job.source.video, plan, path, kind, export.loudness, files)
    return path
