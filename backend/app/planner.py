"""The Render Planner: how a Clip is cut from its Source and framed in the 1080×1920 output, as a
Render Plan that the Renderer executes. Pure, so it is tested on synthetic input (Seam B).

For now every Clip is one scene with one panel: a static 9:16 crop from the centre of a landscape
Source, or a portrait Source passed through whole. The plan's shape is the one later tickets fill in:
ticket 13 gives a Track panel a moving crop path from face detections, ticket 14 a layout per detected
Scene (Split's two panels, Blur's wide shot over a blurred background) and the layout override,
ticket 15 the caption events and ticket 16 the hook event.
"""

from dataclasses import dataclass, field
from enum import StrEnum

from app.video_source import SourceMetadata

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920


class SceneLayout(StrEnum):
    """How a scene is framed: the Layouts of review, and a portrait Source shown as it is."""

    TRACK = "track"
    SPLIT = "split"
    BLUR = "blur"
    PASSTHROUGH = "passthrough"


@dataclass(frozen=True)
class Box:
    """A rectangle in pixels, from its top-left corner."""

    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class CropPoint:
    """From `at` seconds into the Clip on, the panel's crop has its top-left corner at (x, y) in the Source."""

    at: float
    x: int
    y: int


@dataclass(frozen=True)
class Panel:
    """Part of the output frame, showing a crop of the Source scaled to fill it."""

    # Where the panel sits in the output frame.
    area: Box
    # The crop's size in Source pixels, with about the aspect of `area`.
    crop_width: int
    crop_height: int
    # Where the crop is: its change points in time order, the first at the scene's start. The crop
    # stays put between them.
    path: list[CropPoint]


@dataclass(frozen=True)
class ScenePlan:
    # Seconds into the Clip.
    start: float
    end: float
    layout: SceneLayout
    panels: list[Panel]


@dataclass(frozen=True)
class CaptionWord:
    """A caption Word, highlighted from `start` to `end` (seconds into the Clip)."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class CaptionEvent:
    """A caption line on screen from `start` to `end` (seconds into the Clip), inside `area`. Ticket 15."""

    text: str
    start: float
    end: float
    words: list[CaptionWord]
    area: Box


@dataclass(frozen=True)
class HookEvent:
    """The hook's lines on screen from `start` to `end` (seconds into the Clip), inside `area`. Ticket 16."""

    lines: list[str]
    start: float
    end: float
    area: Box


@dataclass(frozen=True)
class RenderPlan:
    # The Clip's range on the Source's timeline.
    start: float
    end: float
    source_width: int
    source_height: int
    fps: float
    # Back to back, covering the Clip from 0 to its duration.
    scenes: list[ScenePlan]
    captions: list[CaptionEvent] = field(default_factory=list)
    hook: HookEvent | None = None
    width: int = OUTPUT_WIDTH
    height: int = OUTPUT_HEIGHT

    @property
    def duration(self) -> float:
        return self.end - self.start


def plan_render(start: float, end: float, source: SourceMetadata) -> RenderPlan:
    """The Render Plan for the Clip from `start` to `end` seconds of `source`."""
    if not 0 <= start < end:
        raise ValueError(f"A Clip runs forwards from 0 s or later, not {start:g}–{end:g} s")
    duration = round(end - start, 3)
    if source.height > source.width:
        layout, panel = SceneLayout.PASSTHROUGH, _passthrough(source.width, source.height)
    else:
        layout, panel = SceneLayout.TRACK, _centre_crop(source.width, source.height)
    return RenderPlan(
        start=start,
        end=end,
        source_width=source.width,
        source_height=source.height,
        fps=source.fps,
        scenes=[ScenePlan(0.0, duration, layout, [panel])],
    )


def _centre_crop(width: int, height: int) -> Panel:
    """The full-height 9:16 crop from the middle of a landscape (or square) frame."""
    crop_height = _even_floor(height)
    crop_width = min(_even(crop_height * OUTPUT_WIDTH / OUTPUT_HEIGHT), _even_floor(width))
    x = _centred(width, crop_width)
    y = _centred(height, crop_height)
    return Panel(Box(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT), crop_width, crop_height, [CropPoint(0.0, x, y)])


def _passthrough(width: int, height: int) -> Panel:
    """A portrait frame whole, as large as fits in the output and centred in it: a 9:16 one fills it."""
    crop_width, crop_height = _even_floor(width), _even_floor(height)
    scale = min(OUTPUT_WIDTH / crop_width, OUTPUT_HEIGHT / crop_height)
    area_width = min(_even(crop_width * scale), OUTPUT_WIDTH)
    area_height = min(_even(crop_height * scale), OUTPUT_HEIGHT)
    area = Box(_centred(OUTPUT_WIDTH, area_width), _centred(OUTPUT_HEIGHT, area_height), area_width, area_height)
    return Panel(area, crop_width, crop_height, [CropPoint(0.0, 0, 0)])


# Sizes and offsets are kept even: 4:2:0 video can't be cut at odd pixels.
def _even(value: float) -> int:
    return 2 * round(value / 2)


def _even_floor(value: float) -> int:
    return 2 * int(value // 2)


def _centred(outer: int, inner: int) -> int:
    """The even offset that centres `inner` pixels in `outer` most nearly, keeping it inside."""
    return min(_even((outer - inner) / 2), _even_floor(outer - inner))
