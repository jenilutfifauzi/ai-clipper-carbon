"""Clips: the rendered outputs of a Job's Candidates, one per Candidate."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from app.caption_files import CaptionFormat
from app.candidates import Framing, Layout, LayoutOverride, MusicClip, Overlay, Segment, Shape, TextLayer, Transition, WordEdit
from app.encoding import ExportSettings
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
    # The Advanced Edit's, as rendered; none in a Clip rendered before them.
    text_layers: list[TextLayer] = field(default_factory=list)
    shapes: list[Shape] = field(default_factory=list)
    music: list[MusicClip] = field(default_factory=list)
    source_volume: float = 1.0
    segments: list[Segment] = field(default_factory=list)
    overlays: list[Overlay] = field(default_factory=list)
    transitions: list[Transition] = field(default_factory=list)
    # Its Manual Layout's Framing, as rendered; None for another Layout.
    framing: Framing | None = None
    # The Candidate's Revision it was rendered from: stale once the Candidate's differs (ADR 0003).
    # None in a Clip rendered before Revisions, which is compared by the fields above.
    revision: int | None = None
    # Its caption files (app/caption_files.py), relative to the Job's directory, beside the MP4; None
    # for a Job with captions off, and in a Clip rendered before caption files.
    srt: str | None = None
    vtt: str | None = None
    # The Export Preset it was asked for (which may have been deleted since) and a copy of the Export
    # Settings it was made with, only for display: they never make it stale (docs/adr/0021). None in
    # a Clip rendered before Export Presets, which was 1080p H.264 by its `encoder`.
    export_preset_id: str | None = None
    export: ExportSettings | None = None
    # Whether CBR was asked for and the encoder did VBR.
    bitrate_fallback: bool = False


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
    # When the worker started rendering it; None unless it is rendering.
    started_at: datetime | None = None
    # The Export Preset its latest request asked for, rendered with as it is when the render starts
    # (the default once it is deleted); None in a Clip asked for before Export Presets, which is
    # rendered with the default.
    export_preset_id: str | None = None


def clip_files(candidate_id: str) -> tuple[str, str, str]:
    """A Candidate's Clip files, relative to the Job's directory: the MP4, the poster and the Render Plan."""
    stem = f"{CLIPS_DIR}/{candidate_id}"
    return f"{stem}.mp4", f"{stem}.jpg", f"{stem}.plan.json"


def caption_paths(candidate_id: str) -> dict[CaptionFormat, str]:
    """A Candidate's Clip's caption files, relative to the Job's directory, beside its MP4."""
    return {format: f"{CLIPS_DIR}/{candidate_id}.{format}" for format in CaptionFormat}
