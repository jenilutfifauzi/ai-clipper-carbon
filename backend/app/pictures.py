"""The geometry of a picture placed by its Transform: its fitted size, the scale that covers the
frame, its drawn size and the box it fills once turned
(docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md). Pure, so that the planner (Overlays, and later media Segments and Manual Scenes) and the migration
of old Candidates share one rule. Sizes are in pixels; `frame` is the output's (width, height).
"""

import math

from app.candidates import Transform


def fitted(width: float, height: float, frame: tuple[int, int]) -> tuple[float, float]:
    """The largest size of a `width` x `height` picture that fits in `frame` keeping its aspect: its
    size at scale 1."""
    fit = min(frame[0] / width, frame[1] / height)
    return width * fit, height * fit


def cover_scale(width: float, height: float, frame: tuple[int, int]) -> float:
    """The scale at which a `width` x `height` picture covers `frame`: 1 for one of the frame's shape."""
    return max(frame[0] / width, frame[1] / height) / min(frame[0] / width, frame[1] / height)


def drawn_size(width: float, height: float, transform: Transform, frame: tuple[int, int]) -> tuple[int, int]:
    """How large a `width` x `height` picture is drawn at `transform`: its fitted size times its scale
    and stretch, in even pixels (4:2:0 video can't be cut at odd ones), 2 at least."""
    across, down = fitted(width, height, frame)
    return (
        _even(across * transform.scale * transform.stretch_x),
        _even(down * transform.scale * transform.stretch_y),
    )


def turned_size(width: float, height: float, rotation: float) -> tuple[float, float]:
    """The size of the box that holds a `width` x `height` picture turned `rotation` degrees."""
    angle = math.radians(rotation)
    cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
    return width * cos + height * sin, width * sin + height * cos


def _even(value: float) -> int:
    return max(2, 2 * round(value / 2))
