"""Picture layers' pictures: a picture layer, a Text Layer
(docs/adr/0010-text-layers-are-rasterised-pictures.md) or a Shape
(docs/adr/0011-shapes-are-pictures-like-text-layers.md), is drawn from its layout (planner.py's
`PictureLayout`) once by libass onto a transparent picture, which the render lays over the Clip and
the preview shows as it is. Each kind of layout is written as an ASS script of the picture's size by
its own `layout_script` (in the same scaffold, `_script`), and may have more pasted over what libass
drew (`pasted`); the rest is the same for every kind.

A Text Layer's layout (planner.py's `TextLayout`) is written as an ASS script of the picture's size: its plate
(a Block, or a Strip per line) as one `\\p1` drawing, then its drop shadow, then each run of each
line centred where the planner placed it, on its line's baseline, in the layer's style, its stroke
as the outline and its tracking as `\\fsp`, as the hook's lines are. A run in the fallback Face
(CJK) names it with `\\fn`. The shadow is each run again, moved and in the shadow's colour, blurred
with `\\blur`: it can't be the runs' own `\\shad`, since libass would blur their stroke with it.
libass draws it all as large as the layout's scale says. An emoji run isn't in the script: its
image (app/emoji.py) is pasted onto the picture afterwards, in its square (planner.py's
`emoji_square`), over the plate and the shadow, in its own colours, with none of the text's
colour, stroke or shadow.

A Shape's layout (planner.py's `ShapeLayout`, docs/adr/0011) is written as `\\p1` drawings of its
figure, in the middle of the picture: its drop shadow, then its fill, then its stroke. The stroke is
drawn inside the figure, as a ring: the figure, and the figure inset by the stroke's width gone
round the other way, which libass leaves as a hole. The fill reaches under the middle of the
stroke, so that no seam shows between them. The shadow is what is drawn (the figure, or the ring of
an outline alone) again, moved and in the shadow's colour, blurred with `\\blur`, as a Text Layer's.
A line and an arrow are all stroke: their outline is one drawing in the stroke's colour, and their
shadow that again.

ffmpeg's `ass` filter with `alpha=1` over a transparent canvas doesn't give straight alpha: where
libass blends a partly covered pixel, the colour comes out multiplied by its coverage and the alpha
by it twice over, so a white stroke over transparency gets a dark fringe. So the script is drawn
twice in one ffmpeg run, over black and over white, and the alpha is recovered from the difference
(difference matting): where the two differ by d, the picture is 1 − d/255 opaque, and its colour is
what shows over black divided by that.

The fonts directory libass is given holds just the layout's Faces (app/fonts.py's `gather`), so that
no other font is matched; a render fails clearly when a file is gone.

Pictures are kept in the Job's PICTURES_DIR, named by their layout's hash, and written under a
temporary name renamed when complete, so a half-written one is never served. The preview's plan and
a render each make the pictures they need that aren't there yet. When a Job is opened, those none of
its Candidates nor any state in their Revision History shows are removed (`sweep`), never what one
being made is writing; and the folder they were kept in before Shapes had them too
(OLD_PICTURES_DIR), whose pictures are made again in PICTURES_DIR when asked for.
"""

import math
import os
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Iterable
from functools import singledispatch
from pathlib import Path

import cv2
import numpy as np

from app.ass import (
    ass_alpha, ass_filter, ass_text, reversed_drawing, rounded_box, shadow_tags, spacing, style_colour, tag_colour, tracked,
)
from app.candidates import Candidate, ShapeKind, ShapeStyle
from app.emoji import image_pixels
from app.fonts import font, registry
from app.planner import PictureLayout, ShapeLayout, TextLayout, emoji_square, font_metrics, shape_event, text_event
from app.renderer import last_lines

# In a Job's directory.
PICTURES_DIR = "layer-pictures"
# Where they were kept when only Text Layers had them: removed whole by the Job's sweep.
OLD_PICTURES_DIR = "texts"

# What pictures being made are writing now, which the sweep leaves.
_writing: set[Path] = set()
_writing_lock = threading.Lock()


def make_picture(ffmpeg: Path, layout: PictureLayout, folder: Path) -> Path:
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
            raise RuntimeError(f"A picture layer's picture couldn't be written to {folder}")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)
        with _writing_lock:
            _writing.discard(part)
    return target


def make_pictures(ffmpeg: Path, layouts: Iterable[PictureLayout], folder: Path) -> dict[str, Path]:
    """The pictures of `layouts` in `folder`, by their names, each made now if it isn't there yet."""
    return {layout.name: make_picture(ffmpeg, layout, folder) for layout in layouts}


def rasterised(ffmpeg: Path, layout: PictureLayout) -> np.ndarray:
    """`layout` drawn by libass (`layout_script`) with what is pasted over that (`pasted`), as
    straight-alpha RGBA pixels of its raster size."""
    width, height = layout.raster
    with tempfile.TemporaryDirectory(prefix="layer-picture-") as work:
        fonts = registry().gather(layout.faces, Path(work, "fonts"))
        script = Path(work, "layout.ass")
        script.write_text(layout_script(layout), encoding="utf-8")
        drawn = ass_filter(script, fonts)
        canvas = f"s={width}x{height}:r=1,format=rgb24"
        graph = f"color=c=black:{canvas},{drawn}[black];color=c=white:{canvas},{drawn}[white];[black][white]hstack"
        command = [
            str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-filter_complex", graph,
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ]
        result = subprocess.run(command, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't draw a picture layer: {last_lines(result.stderr.decode(errors='replace'))}")
    both = np.frombuffer(result.stdout, np.uint8).reshape(height, 2 * width, 3).astype(np.int32)
    return pasted(layout, matted(both[:, :width], both[:, width:]))


def matted(over_black: np.ndarray, over_white: np.ndarray) -> np.ndarray:
    """The straight-alpha RGBA picture that shows as `over_black` over black and as `over_white`
    over white (each RGB, as ints)."""
    alpha = np.clip(255 - (over_white - over_black).max(axis=2), 0, 255)
    colour = np.clip(np.rint(over_black * 255 / np.maximum(alpha, 1)[..., None]), 0, 255)
    colour[alpha == 0] = 0
    return np.dstack([colour, alpha]).astype(np.uint8)


@singledispatch
def pasted(layout: PictureLayout, pixels: np.ndarray) -> np.ndarray:
    """The picture `pixels` libass drew of `layout`, with what libass doesn't draw laid over it:
    nothing, unless its kind says otherwise."""
    return pixels


@pasted.register
def _text_pasted(layout: TextLayout, pixels: np.ndarray) -> np.ndarray:
    return with_emoji(pixels, layout)


def with_emoji(pixels: np.ndarray, layout: TextLayout) -> np.ndarray:
    """The picture `pixels` of `layout` with each emoji's image laid over it in its square, scaled to
    fill it across or down and centred in it."""
    across, down = pixels.shape[1] / layout.width, pixels.shape[0] / layout.height
    for runs, (_, baseline) in zip(layout.runs, layout.anchors):
        for run in runs:
            if run.image is None:
                continue
            x, top, side = emoji_square(run, baseline, layout.style.size)
            image = image_pixels(run.image)
            fit = min(side * across / image.shape[1], side * down / image.shape[0])
            width, height = max(1, round(image.shape[1] * fit)), max(1, round(image.shape[0] * fit))
            left = round((x + side / 2) * across - width / 2)
            upper = round((top + side / 2) * down - height / 2)
            _lay_over(pixels, _resized(image, width, height), left, upper)
    return pixels


def _resized(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """The straight-alpha RGBA `image` at `width` x `height`, premultiplied (so that no colour of its
    clear pixels bleeds into its edges), as floats from 0 to 1."""
    premultiplied = image.astype(np.float32) / 255
    premultiplied[..., :3] *= premultiplied[..., 3:]
    shrinking = width < image.shape[1]
    return cv2.resize(premultiplied, (width, height), interpolation=cv2.INTER_AREA if shrinking else cv2.INTER_CUBIC).clip(0, 1)


def _lay_over(pixels: np.ndarray, image: np.ndarray, left: int, top: int) -> None:
    """Lay the premultiplied `image` over the straight-alpha RGBA `pixels`, its top-left corner at
    (`left`, `top`), as far as it is on them."""
    x0, y0 = max(left, 0), max(top, 0)
    x1, y1 = min(left + image.shape[1], pixels.shape[1]), min(top + image.shape[0], pixels.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    over = image[y0 - top : y1 - top, x0 - left : x1 - left]
    under = pixels[y0:y1, x0:x1].astype(np.float32) / 255
    alpha = over[..., 3:] + under[..., 3:] * (1 - over[..., 3:])
    colour = (over[..., :3] + under[..., :3] * under[..., 3:] * (1 - over[..., 3:])) / np.maximum(alpha, 1e-6)
    pixels[y0:y1, x0:x1] = np.rint(np.dstack([colour, alpha]).clip(0, 1) * 255).astype(np.uint8)


@singledispatch
def layout_script(layout: PictureLayout) -> str:
    """`layout` as an ASS script of its size at scale 1, which libass scales to the canvas: each kind
    of layout has its own."""
    raise TypeError(f"No picture is drawn of a {type(layout).__name__}")


@layout_script.register
def text_script(layout: TextLayout) -> str:
    """A Text Layer's `layout` as an ASS script of its size at scale 1: its plate, its lines' shadow
    over it, then its lines over that. libass scales it to the canvas, the stroke, tracking and blur
    with it."""
    style = layout.style
    text, edge = style_colour(style.colour), style_colour(style.stroke_colour)
    events = []
    if layout.plates:
        plate = style.plate
        # One drawing, so that Strips that overlap are drawn once.
        drawing = " ".join(_moved(rounded_box(box.width, box.height, layout.radius), box.x, box.y) for box in layout.plates)
        events.append(f"{{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c{tag_colour(plate.colour)}\\alpha{ass_alpha(plate.opacity)}}}{drawing}{{\\p0}}")
    placed = []
    for runs, (_, baseline) in zip(layout.runs, layout.anchors):
        for run in runs:
            if not run.text or run.image is not None:
                continue
            # Centred (5) on its middle, and on the middle of its height (`centre_y`), so that every
            # run stands on the line's baseline. A fallback run names its Face: libass never falls
            # back on its own. libass centres its tracking after its last letter too (`tracked`).
            centre_y = font_metrics(run.face).centre_y(baseline, style.size)
            face = "" if run.face == style.font else f"\\fn{font(run.face).family}"
            x = tracked(run.x + run.width / 2, style.tracking)
            placed.append((x, centre_y, f"{face}{spacing(style.tracking)}", ass_text(run.text)))
    if layout.shadow is not None:
        dx, dy = layout.shadow
        tags = shadow_tags(style.shadow, style.stroke_width)
        events += [f"{{\\an5\\pos({x + dx:.3f},{y + dy:.1f}){run_tags}{tags}}}{words}" for x, y, run_tags, words in placed]
    events += [f"{{\\an5\\pos({x:.3f},{y:.1f}){run_tags}}}{words}" for x, y, run_tags, words in placed]
    look = (
        f"Text,{font(style.font).family},{style.size:g},{text},{text},{edge},{edge},0,0,0,0,100,100,0,0,1,"
        f"{style.stroke_width},0,5,0,0,0,1"
    )
    return _script(layout, look, events)


@layout_script.register
def shape_script(layout: ShapeLayout) -> str:
    """A Shape's `layout` as an ASS script of its size at scale 1: its shadow, its fill and its
    stroke, each one drawing of its figure in the middle of it; a line's or an arrow's shadow and its
    outline in its stroke's colour. libass scales it to the canvas, the stroke, corners and blur
    with it."""
    style = layout.style
    width, height = style.size
    left, top = (layout.width - width) / 2, (layout.height - height) / 2
    if style.kind.all_stroke:
        shadowed = line_drawing(style)
        drawn = [(shadowed, style.stroke_colour)]
    else:
        figure = figure_drawing(style)
        # Its stroke: the figure less its inside (all of it, when the stroke leaves no inside).
        inside = figure_drawing(style, style.stroke_width)
        ring = "" if not style.stroke_width else f"{figure} {reversed_drawing(inside)}" if inside else figure
        shadowed = figure if style.fill is not None else ring
        drawn = []
        if style.fill is not None and (filled := figure_drawing(style, style.stroke_width / 2)):
            drawn.append((filled, style.fill))
        if style.stroke_width:
            drawn.append((ring, style.stroke_colour))
    events = []
    if style.shadow.on:
        dx, dy = style.shadow.offset
        events.append(f"{{\\an7\\pos(0,0)\\p1{shadow_tags(style.shadow, 0)}}}{_moved(shadowed, left + dx, top + dy)}{{\\p0}}")
    for drawing, colour in drawn:
        events.append(f"{{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c{tag_colour(colour)}}}{_moved(drawing, left, top)}{{\\p0}}")
    return _script(layout, "Shape,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1", events)


def _script(layout: PictureLayout, style: str, events: list[str]) -> str:
    """An ASS script of `layout`'s size at scale 1 that draws `events` (each an event's text) in
    their order, each on a layer of its own over the one before, in the one Style `style` (its
    fields, its name first)."""
    name = style.partition(",")[0]
    return "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {layout.width}",
        f"PlayResY: {layout.height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        # Without it, libass takes the canvas for TV range and white comes out at 235.
        "YCbCr Matrix: None",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: {style}",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *(f"Dialogue: {layer},0:00:00.00,0:00:10.00,{name},,0,0,0,,{event}" for layer, event in enumerate(events)),
    ]) + "\n"


# How far a parallelogram leans, and how much narrower a trapezoid's top is on each side, as a share
# of its shorter side: the same slant at any width.
SLANT = 0.25
# How long an arrow's head is, in its thicknesses (ARROW_HEAD says how tall).
ARROW_HEAD_LENGTH = 3
# How far a quarter circle's Bézier control points are from its ends, as a share of its radius.
KAPPA = 0.5523
# How many short lines an inset ellipse is drawn with.
ELLIPSE_STEPS = 360


def figure_drawing(style: ShapeStyle, inset: float = 0.0) -> str:
    """An ASS drawing of a filled Shape Kind's figure, `width` x `height` from its top-left corner,
    inset `inset` pixels on every side (its stroke's inside, or the fill under it): what of the figure
    is further than `inset` from its edge, so that a stroke is as thick all round. "" when nothing of
    it is left. Each is drawn the same way round (clockwise on screen), so that one inside another,
    turned round, is a hole (`reversed_drawing`)."""
    width, height = style.width, style.height
    match style.kind:
        case ShapeKind.RECTANGLE:
            if min(width, height) - 2 * inset <= 0:
                return ""
            # Inset, a rounded corner keeps its centre: its radius is less by the inset.
            radius = max(style.radius * min(width, height) - inset, 0)
            return _moved(rounded_box(width - 2 * inset, height - 2 * inset, radius), inset, inset)
        case ShapeKind.ELLIPSE:
            return _ellipse(width / 2, height / 2, inset)
        case ShapeKind.TRIANGLE:
            corners = [(width / 2, 0), (width, height), (0, height)]
        case ShapeKind.PARALLELOGRAM:
            slant = SLANT * min(width, height)
            corners = [(slant, 0), (width, 0), (width - slant, height), (0, height)]
        case ShapeKind.TRAPEZOID:
            slant = SLANT * min(width, height)
            corners = [(slant, 0), (width - slant, 0), (width, height), (0, height)]
        case _:
            raise ValueError(f"A {style.kind} isn't a filled figure")
    return _polygon(_inset(corners, inset))


def line_drawing(style: ShapeStyle) -> str:
    """An ASS drawing of a line or an arrow, all stroke, its style's `size` from its top-left corner,
    clockwise on screen: a line a bar of its thickness with round ends; an arrow a shaft of its
    thickness with a round tail and a head at the right, ARROW_HEAD thicknesses tall and
    ARROW_HEAD_LENGTH long (all head, when it is shorter than that)."""
    (length, tall), thick = style.size, style.stroke_width
    if style.kind is ShapeKind.LINE:
        return rounded_box(length, thick, min(length, thick) / 2)
    head = min(ARROW_HEAD_LENGTH * thick, length)
    shaft, middle = length - head, tall / 2
    upper, lower = middle - thick / 2, middle + thick / 2
    # The tail's round end reaches back as far as the shaft allows.
    cap = min(thick / 2, shaft)
    drawing = _polygon([(cap, upper), (shaft, upper), (shaft, 0), (length, middle), (shaft, tall), (shaft, lower), (cap, lower)])
    if not cap:
        return drawing
    reach = thick / 2
    return (
        f"{drawing} b {cap - KAPPA * cap:g} {lower:g} 0 {middle + KAPPA * reach:g} 0 {middle:g}"
        f" b 0 {middle - KAPPA * reach:g} {cap - KAPPA * cap:g} {upper:g} {cap:g} {upper:g}"
    )


def _polygon(corners: list[tuple[float, float]]) -> str:
    """An ASS drawing of the figure with these `corners`, in their order; "" for none."""
    if not corners:
        return ""
    (x, y), *rest = corners
    return " ".join([f"m {x:g} {y:g}", *(f"l {x:g} {y:g}" for x, y in rest)])


def _inset(corners: list[tuple[float, float]], inset: float) -> list[tuple[float, float]]:
    """A convex figure's `corners` (clockwise on screen) with each side moved `inset` in, square to
    itself: the figure cut by each side's line moved in. None when nothing is left."""
    kept = list(corners)
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        # Clockwise on screen, a side's inside is on its right.
        length = math.hypot(x1 - x0, y1 - y0)
        across = (-(y1 - y0) / length, (x1 - x0) / length)

        def depth(point: tuple[float, float]) -> float:
            return (point[0] - x0) * across[0] + (point[1] - y0) * across[1] - inset

        cut = []
        for here, there in zip(kept, kept[1:] + kept[:1]):
            if depth(here) >= 0:
                cut.append(here)
            if (depth(here) >= 0) != (depth(there) >= 0):
                share = depth(here) / (depth(here) - depth(there))
                cut.append((here[0] + share * (there[0] - here[0]), here[1] + share * (there[1] - here[1])))
        kept = cut
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(kept, kept[1:] + kept[:1])) / 2
    return kept if len(kept) >= 3 and area > 1e-6 else []


def _ellipse(across: float, down: float, inset: float) -> str:
    """An ASS drawing of an ellipse of semi-axes `across` and `down` from its box's top-left corner,
    inset `inset` on every side, clockwise on screen from its top: four Béziers, or inset, the curve
    `inset` inside its edge all round (an ellipse's is no ellipse), as many short lines."""
    if min(across, down) <= inset:
        return ""
    if not inset:
        a, b, ka, kb = across, down, KAPPA * across, KAPPA * down
        return (
            f"m {a:g} 0 b {a + ka:g} 0 {2 * a:g} {b - kb:g} {2 * a:g} {b:g} b {2 * a:g} {b + kb:g} {a + ka:g} {2 * b:g} {a:g} {2 * b:g} "
            f"b {a - ka:g} {2 * b:g} 0 {b + kb:g} 0 {b:g} b 0 {b - kb:g} {a - ka:g} 0 {a:g} 0"
        )
    turns = np.linspace(-np.pi / 2, 3 * np.pi / 2, ELLIPSE_STEPS, endpoint=False)
    edge = np.stack([across * np.cos(turns), down * np.sin(turns)], axis=1)
    outward = np.stack([down * np.cos(turns), across * np.sin(turns)], axis=1)
    curve = edge - inset * outward / np.hypot(outward[:, :1], outward[:, 1:])
    # Where the edge is rounder than `inset` (at the ends of a long ellipse), the curve crosses
    # itself: what of it is nearer the edge than `inset` is left out.
    if inset > min(across, down) ** 2 / max(across, down):
        dense = np.linspace(0, 2 * np.pi, 4096, endpoint=False)
        edges = np.stack([across * np.cos(dense), down * np.sin(dense)], axis=1)
        nearest = np.sqrt(((curve[:, None, :] - edges[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
        curve = curve[nearest >= inset - 0.01]
    return _polygon([(x + across, y + down) for x, y in curve.tolist()])


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
    """The names of the pictures `candidates`' picture layers (their Text Layers and Shapes) are drawn
    from."""
    candidates = list(candidates)
    texts = (text_event(layer, math.inf, candidate.canvas) for candidate in candidates for layer in candidate.text_layers)
    shapes = (shape_event(shape, math.inf) for candidate in candidates for shape in candidate.shapes)
    return {event.image for events in (texts, shapes) for event in events if event is not None}


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
