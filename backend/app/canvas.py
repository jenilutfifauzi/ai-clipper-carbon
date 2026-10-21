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
# A caption area is this tall; the lower third's ends this far above the Safe Area's bottom, and the
# Top position's starts this far below its top: just below where a two-line hook at the top ends.
CAPTION_HEIGHT = 200
LOWER_CAPTIONS_ABOVE = 240
TOP_CAPTIONS_BELOW = 198


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
    def split_height(self) -> int:
        """The height of each of Split's two stacked panels."""
        return self.height // 2

    @property
    def caption_x(self) -> int:
        """Where a caption area starts: as far from the left edge as the Safe Area's right edge is
        from the right, so that lines are centred in the frame."""
        return self.width - (self.safe_area.x + self.safe_area.width)

    @property
    def caption_width(self) -> int:
        return self.width - 2 * self.caption_x

    @property
    def seam_captions(self) -> Box:
        """On the seam between Split's stacked panels, clear of the faces (at 40% of each panel)."""
        return Box(self.caption_x, self.split_height - CAPTION_HEIGHT // 2, self.caption_width, CAPTION_HEIGHT)

    @property
    def lower_captions(self) -> Box:
        """In the lower third: on 9:16 y 1296–1496, below Blur's shot (which ends at 1264) and above
        the bottom of the Safe Area."""
        bottom = self.safe_area.y + self.safe_area.height
        return Box(self.caption_x, bottom - LOWER_CAPTIONS_ABOVE, self.caption_width, CAPTION_HEIGHT)

    @property
    def top_captions(self) -> Box:
        return Box(self.caption_x, self.safe_area.y + TOP_CAPTIONS_BELOW, self.caption_width, CAPTION_HEIGHT)

    def from_reference(self, x: float, y: float) -> tuple[float, float]:
        """A place in the Reference Space, on this Canvas."""
        return x * self.width / REFERENCE[0], y * self.height / REFERENCE[1]


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


def canvas_for(aspect: Aspect | str) -> Canvas:
    """The Canvas of `aspect`; an aspect not among them is a ValueError."""
    return CANVASES[Aspect(aspect)]
