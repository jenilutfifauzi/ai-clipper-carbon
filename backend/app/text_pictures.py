"""Text Layers' pictures (docs/adr/0010-text-layers-are-rasterised-pictures.md): a Text Layer's layout,
drawn once by libass onto a transparent picture, which the render lays over the Clip and the preview
shows as it is.

The layout (planner.py's `TextLayout`) is written as an ASS script of the picture's size: its plate
(a Block, or a Strip per line) as one `\\p1` drawing, then its drop shadow, then each line centred on
its anchor in the layer's style, its stroke as the outline and its tracking as `\\fsp`, as the
hook's lines are. The shadow is each line again, moved and in the shadow's colour, blurred with
`\\blur`: it can't be the lines' own `\\shad`, since libass would blur their stroke with it. libass
draws it all as large as the layout's scale says.

ffmpeg's `ass` filter with `alpha=1` over a transparent canvas doesn't give straight alpha: where
libass blends a partly covered pixel, the colour comes out multiplied by its coverage and the alpha
by it twice over, so a white stroke over transparency gets a dark fringe. So the script is drawn
twice in one ffmpeg run, over black and over white, and the alpha is recovered from the difference
(difference matting): where the two differ by d, the picture is 1 − d/255 opaque, and its colour is
what shows over black divided by that.

The fonts directory libass is given holds just the layout's Face (app/fonts.py's `gather`), so that
no other font is matched; a render fails clearly when its file is gone.

Pictures are kept in the Job's TEXTS_DIR, named by their layout's hash, and written under a
temporary name renamed when complete, so a half-written one is never served. The preview's plan and
a render each make the pictures they need that aren't there yet. When a Job is opened, those none of
its Candidates nor any state in their Revision History shows are removed (`sweep`), never what one
being made is writing.
"""

import math
import os
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Iterable
from pathlib import Path

import cv2
import numpy as np

from app.candidates import Candidate
from app.fonts import font, registry
from app.planner import TextLayout, font_metrics, text_event
from app.renderer import (
    _ass_text, _filter_value, _rounded_box, _shadow_tags, _spacing, _style_colour, _tag_colour, _tracked, last_lines,
)

# In a Job's directory.
TEXTS_DIR = "texts"

# What pictures being made are writing now, which the sweep leaves.
_writing: set[Path] = set()
_writing_lock = threading.Lock()


def make_picture(ffmpeg: Path, layout: TextLayout, folder: Path) -> Path:
    """The picture of `layout` in `folder`: made now if it isn't there yet."""
    target = folder / layout.name
    if target.is_file():
        return target
    folder.mkdir(parents=True, exist_ok=True)
    part = folder / f".{target.stem}.{uuid.uuid4().hex}.part.png"
    with _writing_lock:
        _writing.add(part)
    try:
        if not cv2.imwrite(str(part), cv2.cvtColor(rasterised(ffmpeg, layout), cv2.COLOR_RGBA2BGRA)):
            raise RuntimeError(f"The picture of a Text Layer couldn't be written to {folder}")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)
        with _writing_lock:
            _writing.discard(part)
    return target


def make_pictures(ffmpeg: Path, layouts: Iterable[TextLayout], folder: Path) -> dict[str, Path]:
    """The pictures of `layouts` in `folder`, by their names, each made now if it isn't there yet."""
    return {layout.name: make_picture(ffmpeg, layout, folder) for layout in layouts}


def rasterised(ffmpeg: Path, layout: TextLayout) -> np.ndarray:
    """`layout` drawn by libass, as straight-alpha RGBA pixels of its raster size."""
    width, height = layout.raster
    with tempfile.TemporaryDirectory(prefix="text-picture-") as work:
        fonts = registry().gather({layout.style.font}, Path(work, "fonts"))
        script = Path(work, "layout.ass")
        script.write_text(layout_script(layout), encoding="utf-8")
        drawn = f"ass=filename={_filter_value(str(script))}:fontsdir={_filter_value(str(fonts))}"
        canvas = f"s={width}x{height}:r=1,format=rgb24"
        graph = f"color=c=black:{canvas},{drawn}[black];color=c=white:{canvas},{drawn}[white];[black][white]hstack"
        command = [
            str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-filter_complex", graph,
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ]
        result = subprocess.run(command, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't draw a Text Layer: {last_lines(result.stderr.decode(errors='replace'))}")
    both = np.frombuffer(result.stdout, np.uint8).reshape(height, 2 * width, 3).astype(np.int32)
    return matted(both[:, :width], both[:, width:])


def matted(over_black: np.ndarray, over_white: np.ndarray) -> np.ndarray:
    """The straight-alpha RGBA picture that shows as `over_black` over black and as `over_white`
    over white (each RGB, as ints)."""
    alpha = np.clip(255 - (over_white - over_black).max(axis=2), 0, 255)
    colour = np.clip(np.rint(over_black * 255 / np.maximum(alpha, 1)[..., None]), 0, 255)
    colour[alpha == 0] = 0
    return np.dstack([colour, alpha]).astype(np.uint8)


def layout_script(layout: TextLayout) -> str:
    """`layout` as an ASS script of its size at scale 1: its plate, its lines' shadow over it, then its
    lines over that. libass scales it to the canvas, the stroke, tracking and blur with it."""
    style = layout.style
    metrics = font_metrics(style.font)
    text, edge = _style_colour(style.colour), _style_colour(style.stroke_colour)
    events = []
    if layout.plates:
        plate = style.plate
        alpha = f"&H{round(255 * (1 - plate.opacity)):02X}&"
        # One drawing, so that Strips that overlap are drawn once.
        drawing = " ".join(_moved(_rounded_box(box.width, box.height, layout.radius), box.x, box.y) for box in layout.plates)
        events.append(f"{{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c{_tag_colour(plate.colour)}\\alpha{alpha}}}{drawing}{{\\p0}}")
    size = f"\\fs{layout.size:g}" if layout.size != style.size else ""
    placed = []
    for line, (x, baseline) in zip(layout.lines, layout.anchors):
        if line:
            # Centred (5) on the middle of its height: its ascent above the baseline and its descent
            # below, which together are the font size.
            centre_y = baseline - metrics.ascent / metrics.units * layout.size + layout.size / 2
            placed.append((_tracked(x, style.tracking), centre_y, f"{size}{_spacing(style.tracking)}", _ass_text(line)))
    if layout.shadow is not None:
        dx, dy = layout.shadow
        tags = _shadow_tags(style.shadow, style.stroke_width)
        events += [f"{{\\an5\\pos({x + dx:.3f},{y + dy:.1f}){look}{tags}}}{line}" for x, y, look, line in placed]
    events += [f"{{\\an5\\pos({x:.3f},{y:.1f}){look}}}{line}" for x, y, look, line in placed]
    return "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {layout.width}",
        f"PlayResY: {layout.height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: None",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Text,{font(style.font).family},{style.size},{text},{text},{edge},{edge},0,0,0,0,100,100,0,0,1,"
        f"{style.stroke_width},0,5,0,0,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *(f"Dialogue: {layer},0:00:00.00,0:00:10.00,Text,,0,0,0,,{event}" for layer, event in enumerate(events)),
    ]) + "\n"


def _moved(drawing: str, x: float, y: float) -> str:
    """An ASS drawing's points moved `x` right and `y` down."""
    words, moved, axis = drawing.split(), [], 0
    for word in words:
        if word.isalpha():
            moved.append(word)
            continue
        moved.append(f"{float(word) + (x, y)[axis]:g}")
        axis = 1 - axis
    return " ".join(moved)


def pictures_used(candidates: Iterable[Candidate]) -> set[str]:
    """The names of the pictures `candidates`' Text Layers are drawn from."""
    return {
        event.image
        for candidate in candidates
        for layer in candidate.text_layers
        if (event := text_event(layer, math.inf)) is not None
    }


def sweep(folder: Path, used: Iterable[str]) -> list[Path]:
    """Remove the pictures in `folder` not named in `used`, and the parts of pictures cut short, but
    nothing a picture being made is writing now. The paths removed."""
    used = set(used)
    removed = []
    with _writing_lock:
        for path in sorted(folder.iterdir()) if folder.is_dir() else ():
            if path in _writing or path.name in used or not path.name.endswith(".png"):
                continue
            path.unlink(missing_ok=True)
            removed.append(path)
    return removed
