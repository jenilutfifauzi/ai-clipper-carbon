"""The Canvas (docs/adr/0022): a Candidate's frame in output pixels, set by its Canvas Aspect, its
short side always 1080 (so that sizes keep their meaning on every aspect). The planner, the preview
and the MCP tools work in its pixels; the renderer draws it at the export's size.

Each Canvas has its Safe Area, the part clear of the platforms' buttons and text that captions, the
hook and the Watermark stay inside, and the places captions are put in it. Style Presets keep their
places in the Reference Space, the 1080×1920 frame, mapped onto a Canvas in proportion
(`from_reference`), so that one Preset serves every aspect."""

from dataclasses import dataclass
from enum import StrEnum


class Aspect(StrEnum):
    """A Candidate's Canvas Aspect: width to height."""

    PORTRAIT = "9:16"
    FEED = "4:5"
    SQUARE = "1:1"
    LANDSCAPE = "16:9"


@dataclass(frozen=True)
class Box:
    """A rectangle in pixels, from its top-left corner."""

    x: int
    y: int
    width: int
    height: int


# Every Canvas's short side, in output pixels.
SHORT_SIDE = 1080
# The frame Style Presets keep their places in (and the 9:16 Canvas).
REFERENCE = (1080, 1920)
# On 9:16, the platforms' buttons and text cover the top 12%, the bottom 20% and the right 12% of the
# frame: captions and the hook stay inside the rest, y 232–1536 and x 0–950.
PORTRAIT_SAFE_AREA = Box(0, 232, 950, 1304)
# On the other aspects (feeds and players), this share of each edge is kept clear.
SAFE_MARGIN = 0.05
# Captions and the hook are at most as wide as on 9:16, centred in the frame as there (x 130–950),
# however wide the Safe Area: their font sizes are in pixels, so a wider area would only make longer lines.
CAPTION_WIDEST = 2 * (PORTRAIT_SAFE_AREA.x + PORTRAIT_SAFE_AREA.width) - REFERENCE[0]
# A caption area is this tall; the lower third's ends this far above the Safe Area's bottom, and the
# Top position's starts this far below its top: just below where a two-line hook at the top ends.
CAPTION_HEIGHT = 200
LOWER_CAPTIONS_ABOVE = 240
TOP_CAPTIONS_BELOW = 198
# Under Blur's band, a caption area starts at least this far below it: on 9:16 with a 16:9 Source,
# the band ends at 1264 and the lower third's starts at 1296.
CAPTIONS_BELOW_BAND = 32


@dataclass(frozen=True)
class Canvas:
    aspect: Aspect
    width: int
    height: int
    safe_area: Box

    @property
    def size(self) -> tuple[int, int]:
        return self.width, self.height

    @property
    def centre(self) -> tuple[int, int]:
        return self.width // 2, self.height // 2

    @property
    def stacked(self) -> bool:
        """Whether Split's two panels are stacked (on a Canvas taller than it is wide), or else side
        by side."""
        return self.height > self.width

    @property
    def split_panels(self) -> tuple[Box, Box]:
        """Split's two panels, the left face's first: stacked, each of the full width and half the
        height (1080×960 on 9:16, 1080×675 on 4:5), or side by side, each of half the width and the
        full height (540×1080 on 1:1, 960×1080 on 16:9)."""
        if self.stacked:
            half = self.height // 2
            return Box(0, 0, self.width, half), Box(0, half, self.width, half)
        half = self.width // 2
        return Box(0, 0, half, self.height), Box(half, 0, half, self.height)

    @property
    def caption_x(self) -> int:
        """Where a caption area starts: as far from the left edge as its right edge is from the right,
        so that lines are centred in the frame."""
        return (self.width - self.caption_width) // 2

    @property
    def caption_width(self) -> int:
        """As wide as the Safe Area leaves either side of the frame's middle, CAPTION_WIDEST at most."""
        return min(2 * (self.safe_area.x + self.safe_area.width) - self.width, CAPTION_WIDEST)

    @property
    def seam_captions(self) -> Box:
        """On the seam between Split's stacked panels, clear of the faces (at 40% of each panel)."""
        seam = self.split_panels[0].height
        return Box(self.caption_x, seam - CAPTION_HEIGHT // 2, self.caption_width, CAPTION_HEIGHT)

    @property
    def lower_captions(self) -> Box:
        """In the lower third: on 9:16 y 1296–1496, below Blur's shot (which ends at 1264) and above
        the bottom of the Safe Area."""
        bottom = self.safe_area.y + self.safe_area.height
        return Box(self.caption_x, bottom - LOWER_CAPTIONS_ABOVE, self.caption_width, CAPTION_HEIGHT)

    def captions_below(self, band: Box) -> Box | None:
        """Under Blur's `band` (the Source fitted over its blur): in the lower third, or lower to keep
        CAPTIONS_BELOW_BAND under the band where it reaches into it, when the room between the band and
        the Safe Area's bottom fits a caption area; None when it doesn't."""
        lower = self.lower_captions
        y = max(band.y + band.height + CAPTIONS_BELOW_BAND, lower.y)
        if y + CAPTION_HEIGHT > self.safe_area.y + self.safe_area.height:
            return None
        return Box(lower.x, y, lower.width, CAPTION_HEIGHT)

    @property
    def top_captions(self) -> Box:
        return Box(self.caption_x, self.safe_area.y + TOP_CAPTIONS_BELOW, self.caption_width, CAPTION_HEIGHT)

    def from_reference(self, x: float, y: float) -> tuple[int, int]:
        """A place in the Reference Space, on this Canvas to the pixel."""
        return self.x_from_reference(x), self.y_from_reference(y)

    def x_from_reference(self, x: float) -> int:
        """A Style's x in the Reference Space, on this Canvas to the pixel (itself on 9:16)."""
        return round(x * self.width / REFERENCE[0])

    def y_from_reference(self, y: float) -> int:
        """A Style's y in the Reference Space, on this Canvas to the pixel (itself on 9:16)."""
        return round(y * self.height / REFERENCE[1])


def _canvas(aspect: Aspect) -> Canvas:
    across, down = (int(part) for part in aspect.value.split(":"))
    short = min(across, down)
    width, height = (round(SHORT_SIDE * side / short / 2) * 2 for side in (across, down))
    if aspect is Aspect.PORTRAIT:
        return Canvas(aspect, width, height, PORTRAIT_SAFE_AREA)
    x, y = round(width * SAFE_MARGIN), round(height * SAFE_MARGIN)
    return Canvas(aspect, width, height, Box(x, y, width - 2 * x, height - 2 * y))


CANVASES = {aspect: _canvas(aspect) for aspect in Aspect}
# The default Canvas, of every Candidate saved before Canvas Aspects.
PORTRAIT = CANVASES[Aspect.PORTRAIT]
# The longest side of any Canvas: how far a Candidate-owned position may be from the frame's top-left
# corner before it is checked against its Candidate's own Canvas, which only the Candidate knows.
LONGEST = max(max(canvas.size) for canvas in CANVASES.values())


def unscaled(size: tuple[int, int]) -> tuple[int, int]:
    """The Canvas of a frame `size` (a plan drawn at an export's size), at its own size: its shape
    with a short side of SHORT_SIDE."""
    width, height = size
    short = min(width, height)
    return round(width * SHORT_SIDE / short), round(height * SHORT_SIDE / short)


def canvas_for(aspect: Aspect | str) -> Canvas:
    """The Canvas of `aspect`; an aspect not among them is a ValueError."""
    return CANVASES[Aspect(aspect)]
