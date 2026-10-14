"""Clips: the rendered outputs of a Job's Candidates, one per Candidate."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.candidates import Layout, LayoutOverride, WordEdit
from app.styles import CaptionStyle, HookStyle, StyleOverrides, WatermarkStyle

CLIPS_DIR = "clips"


class ClipStatus(StrEnum):
    """Where the Clip's latest render request is."""

    QUEUED = "queued"
    RENDERING = "rendering"
    DONE = "done"
    ERROR = "error"


@dataclass(frozen=True)
class RenderedClip:
    """A finished render: the Candidate as it was rendered, and the files made of it."""

    start: float
    end: float
    hook_text: str
    layout: Layout
    # Relative to the Job's directory: the MP4, its poster JPEG and the Render Plan it was made by.
    video: str
    poster: str
    plan: str
    # The MP4's duration (ffprobe) and size.
    duration: float
    size_bytes: int
    # The video encoder that made it, and how long the render took.
    encoder: str
    render_secs: float
    at: datetime
    # The clip editor's edits as rendered, and the styles they resolved to (Preset and overrides);
    # None in a Clip rendered before the editor, which is compared by the fields above only.
    preset_id: str | None = None
    style_overrides: StyleOverrides | None = None
    word_edits: list[WordEdit] | None = None
    hook_start: float | None = None
    hook_secs: float | None = None
    layout_overrides: list[LayoutOverride] | None = None
    caption_style: CaptionStyle | None = None
    hook_style: HookStyle | None = None
    # "" in a Clip rendered before Kickers, which had none.
    hook_kicker: str = ""
    # None in a Clip rendered before Watermarks, which had none.
    watermark_style: WatermarkStyle | None = None


@dataclass(frozen=True)
class Clip:
    candidate_id: str
    status: ClipStatus
    # When it was last asked to be rendered. A request that comes while it renders is rendered after.
    requested_at: datetime
    # The latest finished render. It stays while the Clip is rendered again, and when that fails.
    output: RenderedClip | None = None
    # Why the latest render failed.
    error: str | None = None


def clip_files(candidate_id: str) -> tuple[str, str, str]:
    """A Candidate's Clip files, relative to the Job's directory: the MP4, the poster and the Render Plan."""
    stem = f"{CLIPS_DIR}/{candidate_id}"
    return f"{stem}.mp4", f"{stem}.jpg", f"{stem}.plan.json"
