"""Candidates saved in an older shape, read in today's: pure converters of their stored JSON, run when
a Job is read (app/jobs.py). A converted Candidate is written back in the new shape on its next save,
as a Revision like any other.

An Overlay saved before Transforms (docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md)
was centred on (x, y), `size` pixels wide, at `opacity`, and kept inside the frame by the planner. It
gets the Transform that draws the same box: its scale is the box's width over its item's fitted width,
and its centre the box's. The item's size comes from the Media Library; one that is missing, which
can't happen as an item in use can't be deleted, is taken as 16:9.

A Segment saved before Framings had a `fit`. A video's filled one (a centred crop filling the frame)
gets the scale that covers the frame, and a fitted one (whole, over a blurred copy of itself) scale
1, both over a blurred Background: each draws what it did. A Segment of the Source just loses it.

A Text Layer saved before Text Styles had its look in flat fields beside its centre (x, y). Its centre
moves into its Transform and its look into its Text Style: its outline becomes the stroke, its box a
Block plate padded and rounded as the planner did, in pixels at its size, and its leading the line
height. The planner set one too wide for the frame less TEXT_MARGIN either side smaller, as words are
no longer set (docs/adr/0010): such a layer keeps the size it was set at, and a wrap width that just
holds its widest line, so that it breaks nowhere new. It draws what it did.
"""

import math
from collections.abc import Mapping
from typing import Any

from app.candidates import MAX_SCALE, MIN_SCALE
from app.pictures import cover_scale, fitted
from app.planner import FRAME, OUTPUT_HEIGHT, OUTPUT_WIDTH, TEXT_MARGIN, font_metrics, without_emoji

# Media Library items' picture sizes, by id.
Sizes = Mapping[str, tuple[int, int]]
# The size taken for an item that is missing.
FALLBACK_SIZE = (1920, 1080)
# The fields of an Overlay before Transforms, which its Transform replaces.
_OLD_OVERLAY = ("x", "y", "size", "opacity")
# The look of a Text Layer before Text Styles, in sizes: its lines' baselines this many apart, its box
# padded this many either side and above its capitals and below its descenders, its corners this
# many round.
TEXT_LEADING = 1.1
TEXT_PAD_X = 0.35
TEXT_PAD_Y = 0.22
TEXT_RADIUS = 0.25
# The font it was set in when it had none saved: the default Face's.
_OLD_TEXT_FONT = "montserrat-extrabold"
# The least size a Text Style has (app/candidates.py).
_MIN_TEXT_SIZE = 16
# Its size when it had none saved, and its look's fields by the Text Style's (and its plate's) names.
_OLD_TEXT_SIZE = 80
_OLD_TEXT_STYLE = {
    "font": "font", "size": "size", "colour": "colour", "outline": "stroke_width", "outline_colour": "stroke_colour", "align": "align",
}
_OLD_TEXT_PLATE = {"box_colour": "colour", "box_opacity": "opacity"}
# The fields of a Text Layer before Text Styles, which its Transform and Text Style replace.
OLD_TEXT_LAYER = ("x", "y", "box", *_OLD_TEXT_STYLE, *_OLD_TEXT_PLATE)


def migrated_candidate(data: dict[str, Any], sizes: Sizes) -> dict[str, Any]:
    """A stored Candidate's JSON in today's shape."""
    if data.get("text_layers"):
        data = data | {"text_layers": [migrated_text_layer(layer) for layer in data["text_layers"]]}
    if data.get("overlays"):
        data = data | {"overlays": [migrated_overlay(overlay, sizes.get(overlay["media"])) for overlay in data["overlays"]]}
    if data.get("segments"):
        data = data | {"segments": [migrated_segment(segment, sizes) for segment in data["segments"]]}
    return data


def migrated_clip(data: dict[str, Any], sizes: Sizes) -> dict[str, Any]:
    """A stored Clip's JSON in today's shape: its finished render's Text Layers, Overlays and
    Segments, as rendered."""
    output = data.get("output")
    if not output or not (output.get("text_layers") or output.get("overlays") or output.get("segments")):
        return data
    return data | {"output": migrated_candidate(output, sizes)}


def migrated_segment(data: dict[str, Any], sizes: Sizes) -> dict[str, Any]:
    """A Segment's JSON in today's shape, its video's size (if any) looked up in `sizes`."""
    if "fit" not in data:
        return data
    segment = {key: value for key, value in data.items() if key != "fit"}
    if segment.get("media") is None:
        return segment
    scale = 1.0
    if data["fit"] == "fill":
        width, height = sizes.get(segment["media"]) or FALLBACK_SIZE
        scale = min(cover_scale(width, height, FRAME), MAX_SCALE)
    return segment | {"framing": {"transform": {"scale": scale}, "background": {"kind": "blur"}}}


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
    scale = min(max(width / fitted(item_width, item_height, FRAME)[0], MIN_SCALE), MAX_SCALE)
    transform = {"x": left + width / 2, "y": top + height / 2, "scale": scale, "opacity": data.get("opacity", 1.0)}
    return {key: value for key, value in data.items() if key not in _OLD_OVERLAY} | {"transform": transform}


def migrated_text_layer(data: dict[str, Any]) -> dict[str, Any]:
    """A Text Layer's JSON in today's shape."""
    if not any(key in data for key in OLD_TEXT_LAYER):
        return data
    size = data.get("size", _OLD_TEXT_SIZE)
    shrunk = _shrunk_text(data, size)
    if shrunk:
        size = shrunk[0]
    plate = {new: data[old] for old, new in _OLD_TEXT_PLATE.items() if old in data} | {
        "shape": "block" if data.get("box") else "none",
        "radius": round(TEXT_RADIUS * size, 2),
        "padding_x": round(TEXT_PAD_X * size, 2),
        "padding_y": round(TEXT_PAD_Y * size, 2),
    }
    style = {new: data[old] for old, new in _OLD_TEXT_STYLE.items() if old in data} | {"plate": plate, "line_height": TEXT_LEADING}
    if shrunk:
        # Its widest line and its plate's padding (as saved) either side, to the hundredth above.
        padded = shrunk[1] + (2 * plate["padding_x"] if data.get("box") else 0)
        style |= {"size": size, "wrap_width": math.ceil(padded * 100 - 1e-6) / 100}
    layer = {key: value for key, value in data.items() if key not in OLD_TEXT_LAYER}
    return layer | {"transform": {axis: data[axis] for axis in ("x", "y") if axis in data}, "style": style}


def _shrunk_text(data: dict[str, Any], size: float) -> tuple[float, float] | None:
    """The size an old Text Layer at `size` was set at when the planner set it smaller, its widest
    line (padded by its box) being wider than the frame less TEXT_MARGIN either side: to the tenth
    below what fits. With how wide its widest line is at that size, unpadded. None when it fitted, or
    is blank."""
    lines = [without_emoji(line) for line in data.get("text", "").split("\n")]
    if not any(lines):
        return None
    metrics = font_metrics(data.get("font", _OLD_TEXT_FONT))
    padded = 2 * TEXT_PAD_X if data.get("box") else 0.0
    widest = max(metrics.width(line, 1) for line in lines)
    room = OUTPUT_WIDTH - 2 * TEXT_MARGIN
    if (widest + padded) * size <= room:
        return None
    # Never under the least size a Text Style has (as it was, it would be wider than the frame).
    shrunk = max(math.floor(room / (widest + padded) * 10) / 10, _MIN_TEXT_SIZE)
    return shrunk, widest * shrunk
