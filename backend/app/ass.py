"""Writing ASS for libass: the colours, tags, drawings and text of the scripts that the Renderer
burns into a Clip (its captions, hook and Watermark) and that app/layer_pictures.py draws a picture
layer's picture (a Text Layer's or a Shape's) from, and the `ass` filter that draws a script.
"""

import math
from pathlib import Path

from app.styles import DropShadow

# libass's \blur N is a Gaussian blur whose sigma is N times this.
LIBASS_BLUR_SIGMA = 2 / math.sqrt(math.log(256))


def ass_filter(script: Path, fonts: Path) -> str:
    """The filter that draws the ASS `script` over the frames, in the Faces in `fonts`."""
    return f"ass=filename={_filter_value(str(script))}:fontsdir={_filter_value(str(fonts))}"


def spacing(tracking: float) -> str:
    """The override tag that sets text `tracking` pixels apart; none for none."""
    return f"\\fsp{tracking:g}" if tracking else ""


def tracked(x: float, tracking: float) -> float:
    """Where a centred line with `tracking` is placed for its letters to be centred on `x`: libass
    adds the tracking after its last letter too, and centres that."""
    return x + tracking / 2


def shadow_tags(shadow: DropShadow, stroke: float) -> str:
    """The override tags that draw text as its drop `shadow` (on), its `stroke` pixels wide stroke
    included: in the shadow's colour at its opacity, blurred as a CSS shadow of its blur is. With a
    stroke, only the stroke is drawn, over where the letters are too: a translucent fill would show
    where it meets the stroke, and libass blurs only the stroke of stroked text."""
    colour, opacity = tag_colour(shadow.colour), ass_alpha(shadow.opacity)
    blur = f"\\blur{shadow.blur / 2 / LIBASS_BLUR_SIGMA:.3g}" if shadow.blur else ""
    if stroke:
        return f"\\1a&HFF&\\3c{colour}\\3a{opacity}\\bord{stroke:g}\\shad0{blur}"
    return f"\\1c{colour}\\1a{opacity}\\bord0\\shad0{blur}"


def rounded_box(width: float, height: float, radius: float) -> str:
    """An ASS drawing of a `width` x `height` rectangle with rounded corners, from its top-left corner;
    each corner a Bézier quarter circle."""
    w, h, r = width, height, radius
    # How far from each corner its curve's control points are.
    c = round(r * (1 - 0.5523), 2)
    return (
        f"m {r:g} 0 l {w - r:g} 0 b {w - c:g} 0 {w:g} {c:g} {w:g} {r:g} l {w:g} {h - r:g} b {w:g} {h - c:g} {w - c:g} {h:g} {w - r:g} {h:g} "
        f"l {r:g} {h:g} b {c:g} {h:g} 0 {h - c:g} 0 {h - r:g} l 0 {r:g} b 0 {c:g} {c:g} 0 {r:g} 0"
    )


def reversed_drawing(drawing: str) -> str:
    """An ASS drawing of one closed figure (`m`, then `l` lines and `b` Béziers) gone round the other
    way. libass fills where a point is wound round a nonzero number of times, so a figure drawn the
    other way inside another, in the same drawing, is a hole in it."""
    words = drawing.split()
    if words[0] != "m" or "m" in words[1:]:
        raise ValueError("Only one figure, from one m, is turned round")
    numbers = [float(word) for word in words if not word.isalpha()]
    start, ends, controls = (numbers[0], numbers[1]), [], []
    i, command = 3, ""
    while i < len(words):
        if words[i].isalpha():
            command, i = words[i], i + 1
        count = 6 if command == "b" else 2
        points = [float(word) for word in words[i : i + count]]
        controls.append(points[:-2])
        ends.append((points[-2], points[-1]))
        i += count
    # Each piece runs from the end of the one before (the start, for the first) to its own end.
    froms = [start, *ends[:-1]]
    moved = [f"m {ends[-1][0]:g} {ends[-1][1]:g}"]
    for (x, y), inner in zip(reversed(froms), reversed(controls)):
        if inner:
            moved.append(f"b {inner[2]:g} {inner[3]:g} {inner[0]:g} {inner[1]:g} {x:g} {y:g}")
        else:
            moved.append(f"l {x:g} {y:g}")
    return " ".join(moved)


def style_colour(hex_colour: str, opacity: float = 1.0) -> str:
    """An #RRGGBB colour as an ASS style gives it, at `opacity`: &HAABBGGRR (AA 00 when opaque)."""
    return f"{ass_alpha(opacity)[:-1]}{tag_colour(hex_colour)[2:-1]}"


def ass_alpha(opacity: float) -> str:
    """An opacity as an ASS alpha tag gives it: &HAA&, 00 opaque and FF transparent."""
    return f"&H{round(255 * (1 - opacity)):02X}&"


def tag_colour(hex_colour: str) -> str:
    """An #RRGGBB colour as an ASS override tag gives it: &HBBGGRR&."""
    red, green, blue = hex_colour[1:3], hex_colour[3:5], hex_colour[5:7]
    return f"&H{blue}{green}{red}&".upper()


def ass_time(seconds: float) -> str:
    """A time as ASS writes it, in centiseconds: H:MM:SS.cc."""
    centis = round(seconds * 100)
    return f"{centis // 360000}:{centis // 6000 % 60:02}:{centis // 100 % 60:02}.{centis % 100:02}"


def ass_text(text: str) -> str:
    """Text with what libass would read as markup made harmless: override blocks and escapes."""
    return text.replace("\\", "⧵").replace("{", "(").replace("}", ")")


def _filter_value(value: str) -> str:
    """`value` escaped as a filter option inside a filtergraph: once for the option, once for the graph."""
    for special in ("\\':", "\\'[],;"):
        for char in special:
            value = value.replace(char, "\\" + char)
    return value
