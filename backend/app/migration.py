"""Candidates saved in an older shape, read in today's: pure converters of their stored JSON, run when
a Job is read (app/jobs.py). A converted Candidate is written back in the new shape on its next save,
as a Revision like any other.

An Overlay saved before Transforms (docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md)
was centred on (x, y), `size` pixels wide, at `opacity`, and kept inside the frame by the planner. It
gets the Transform that draws the same box: its scale is the box's width over its item's fitted width,
and its centre the box's. The item's size comes from the Media Library; one that is missing, which
can't happen as an item in use can't be deleted, is taken as 16:9.
"""

from collections.abc import Mapping
from typing import Any

from app.pictures import fitted
from app.planner import FRAME, OUTPUT_HEIGHT, OUTPUT_WIDTH

# Media Library items' picture sizes, by id.
Sizes = Mapping[str, tuple[int, int]]
# The size taken for an item that is missing.
FALLBACK_SIZE = (1920, 1080)
# The fields of an Overlay before Transforms, which its Transform replaces.
_OLD_OVERLAY = ("x", "y", "size", "opacity")


def migrated_candidate(data: dict[str, Any], sizes: Sizes) -> dict[str, Any]:
    """A stored Candidate's JSON in today's shape."""
    if not data.get("overlays"):
        return data
    return data | {"overlays": [migrated_overlay(overlay, sizes.get(overlay["media"])) for overlay in data["overlays"]]}


def migrated_clip(data: dict[str, Any], sizes: Sizes) -> dict[str, Any]:
    """A stored Clip's JSON in today's shape: its finished render's Overlays, as rendered."""
    output = data.get("output")
    if not output or not output.get("overlays"):
        return data
    return data | {"output": migrated_candidate(output, sizes)}


def migrated_overlay(data: dict[str, Any], size: tuple[int, int] | None) -> dict[str, Any]:
    """An Overlay's JSON in today's shape, its item `size` pixels (None: missing)."""
    if "transform" in data:
        return data
    item_width, item_height = size or FALLBACK_SIZE
    x, y = data.get("x", 540), data.get("y", 960)
    # The box the planner drew it in.
    width = min(data.get("size", 540), OUTPUT_WIDTH)
    height = max(2, round(width * item_height / item_width))
    if height > OUTPUT_HEIGHT:
        width, height = max(2, round(OUTPUT_HEIGHT * item_width / item_height)), OUTPUT_HEIGHT
    width, height = 2 * round(width / 2), 2 * round(height / 2)
    left = min(max(round(x - width / 2), 0), OUTPUT_WIDTH - width)
    top = min(max(round(y - height / 2), 0), OUTPUT_HEIGHT - height)
    scale = min(max(width / fitted(item_width, item_height, FRAME)[0], 0.05), 8)
    transform = {"x": left + width / 2, "y": top + height / 2, "scale": scale, "opacity": data.get("opacity", 1.0)}
    return {key: value for key, value in data.items() if key not in _OLD_OVERLAY} | {"transform": transform}
