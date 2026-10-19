"""Export files (GLOSSARY): a frame (PNG) saved from a Candidate on request, kept in its Job's
EXPORTS_DIR, which goes with the Job. Not a Clip: never stale, never in the render queue, made
synchronously outside it, so the Job's status doesn't change.

A frame is drawn as the render draws it (app/renderer.py, `Renderer.frame`): the Candidate's plan
(its Preview Plan's, from cached analysis only) at the Export Preset's frame rate, drawn at its size,
from the same inputs (`drawing_inputs`), Retimed copies made when needed.
"""

import math
from pathlib import Path

from app.config import Settings
from app.encoding import ExportSettings
from app.jobs import Job
from app.logos import LogoStore
from app.media import MediaStore
from app.planner import RenderPlan
from app.renderer import Renderer, shown_frame
from app.rendering import drawing_inputs

EXPORTS_DIR = "exports"


def frame_name(candidate_id: str, at: float, fps: float, duration: float) -> str:
    """The file name of the Candidate's frame shown at `at` seconds into its Clip, `duration` long at
    `fps`: `<candidate>-<mm.ss.ff>.png`, ff its frame within the second."""
    number = shown_frame(at, fps, duration)
    secs = math.floor(number / fps + 1e-6)
    frames = number - math.ceil(secs * fps - 1e-6)
    return f"{candidate_id}-{secs // 60:02d}.{secs % 60:02d}.{frames:02d}.png"


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
) -> str:
    """Write the frame of `plan` (the Candidate's, at `export`'s frame rate) shown at `at` seconds
    into it, drawn at `export`'s size, to the Job's EXPORTS_DIR (`frame_name`, overwriting it), and
    return its path in `job_dir`."""
    assert job.source is not None
    file = f"{EXPORTS_DIR}/{frame_name(candidate_id, at, plan.fps, plan.duration)}"
    (job_dir / EXPORTS_DIR).mkdir(exist_ok=True)
    drawn, logo, files, pictures = drawing_inputs(plan, export, job_dir, job.source, settings, media, logos)
    Renderer(settings.ffmpeg_bin, settings.render).frame(
        job_dir / job.source.video, drawn, at, job_dir / file, logo, files, pictures, export,
    )
    return file
