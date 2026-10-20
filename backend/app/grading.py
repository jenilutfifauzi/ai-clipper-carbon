"""The fold of a Grade (docs/adr/0013): its Adjust turned into one table per channel, one colour
matrix and the sharpen and vignette amounts, which the render draws with ffmpeg's `curves`,
`colorchannelmixer`, `unsharp` and `vignette` (`grade_filters`), in that order.

Written twice: frontend/src/pages/job/editor/grading.ts folds a Grade the same way for the preview's
SVG filter, and both test suites read the same cases (tests/fixtures/grade_folds.json), so that the
two can't drift.

Both work on the picture as it is encoded (sRGB, 0..1), as an SVG filter with
color-interpolation-filters="sRGB" does. The tables come first, then the matrix:
- **The tables** (exposure, brightness, contrast, highlights, shadows, whites, blacks, fade), each
  step held within 0..1. Exposure is in stops of light (on the linear values); brightness a gamma;
  contrast an S-curve about the middle grey; highlights and shadows lift or lower the upper and
  lower halves; whites and blacks move the ends; fade lifts the blacks into a matte and dims the
  whites a little. The three tables are alike for the Adjust dials; a Look's may differ (ticket 06).
- **The matrix** (temperature, tint, saturation): gains per channel, warmer above 6500 K (red up,
  blue down) and more magenta with tint (green down), kept at the same luma; then saturation, mixed
  with the luma (Rec. 709) from grey at −100 to twice as vivid at +100. It has no offset term, as
  ffmpeg's colorchannelmixer has none: whatever moves a level goes in the tables.
- **Sharpen and vignette** (0..100), carried as amounts. Sharpen adds the picture's difference from
  a 3×3 blur of it, times up to SHARPEN_AMOUNT (on the luma); vignette multiplies each pixel by
  cos(angle · d)^4, d its distance from the centre over the half diagonal, the angle up to
  VIGNETTE_ANGLE (the corners black). The preview's are near, not
  exact: an feConvolveMatrix of the same 3×3 sum (on R, G and B) and a radial gradient of the same
  falloff.

A Grade's **Look** (app/looks.py) is a set of Adjust values laid over the Grade's own: the Grade with
its Look has, for each dial, the Grade's value moved by as much as the Look's is from neutral (its
temperature from 6500 K), held within the dial's range (`with_look`). So the Look styles what the
dials corrected, and a dial the Look leaves at neutral stays the Grade's. That Adjust is folded as
any other; then the Look's intensity mixes it over the fold without the Look: each table entry,
matrix weight and amount is a + (b − a) · intensity / 100, a missing table or matrix taken as the
identity. At 0 it is the fold without the Look, at 100 the fold with it.

An **Imported Look** (app/looks.py) has neutral Adjust values and a 3D table of its own, which comes
after the tables and matrix and before sharpen and vignette (`Folded.lut`). The render draws it with
`lut3d`, from a table mixed over the identity at the Grade's intensity (`ImportedLooks.table`), which
mixes the picture after it over the picture before it by the intensity. The preview draws the table
per channel and the matrix fitted to it at import (`Fit`) in its place, mixed so too.
"""

import math

from dataclasses import dataclass, replace

from app.ass import filter_value
from app.candidates import EXPOSURE_EV, NEUTRAL_TEMPERATURE_K, TEMPERATURE_K, Adjust, Grade
from app.looks import Fit, LookNotFound, get_look, imported_looks

TABLE_SIZE = 256
# The luma weights (Rec. 709) a saturation change keeps, and the temperature and tint gains too.
LUMA = (0.2126, 0.7152, 0.0722)
# How far each dial goes at its end.
TEMPERATURE_GAIN = 0.25  # red up and blue down, at 11000 K (the other way at 2000 K)
TEMPERATURE_SPAN_K = 4500  # 6500 K to either end
TINT_GAIN = 0.2  # green down at +100
CONTRAST_STOPS = 1.5  # the S-curve's slope at the middle grey, 2^±1.5
TONE_SHIFT = 0.15  # highlights and shadows, at most
END_SHIFT = 0.25  # whites and blacks, at their ends
FADE_LIFT = 0.25  # black, at fade 100
FADE_DIM = 0.05  # white, at fade 100
SHARPEN_AMOUNT = 2.0  # unsharp's luma amount, at sharpen 100
VIGNETTE_ANGLE = math.pi / 2  # vignette's lens angle, at vignette 100: the corners black

# Each dial's range (Adjust's), which a Look's added values are held within.
DIAL_RANGES: dict[str, tuple[float, float]] = {
    "temperature": TEMPERATURE_K,
    "exposure": EXPOSURE_EV,
    **{dial: (0, 100) for dial in ("sharpen", "fade", "vignette")},
}
_IDENTITY_TABLE = tuple(i / (TABLE_SIZE - 1) for i in range(TABLE_SIZE))
_IDENTITY_MATRIX = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

Matrix = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


@dataclass(frozen=True)
class LookTable:
    """An Imported Look's 3D table in a fold: the Look's id (whose table the render draws), the Grade's
    intensity it is mixed over the picture at (0..100), and the `fit` the preview draws in its place."""

    look: str
    intensity: float
    fit: Fit


@dataclass(frozen=True)
class Folded:
    """A Grade as the render and the preview draw it: a table per channel (R, G, B; TABLE_SIZE
    entries each, the output for input i / (TABLE_SIZE − 1), 0..1), or None when they would change
    nothing; then a colour matrix (rows R, G, B of weights on the input's R, G, B), or None likewise;
    then the sharpen and vignette amounts (0..100, 0 for none); then an Imported Look's table, drawn
    after the tables and matrix and before sharpen and vignette, or None."""

    tables: tuple[tuple[float, ...], tuple[float, ...], tuple[float, ...]] | None
    matrix: Matrix | None
    sharpen: float = 0.0
    vignette: float = 0.0
    lut: LookTable | None = None


def fold(grade: Grade, look: Adjust | None = None, fit: Fit | None = None) -> Folded | None:
    """`grade` folded into its tables, matrix and amounts; None for a neutral one, which adds no filter.

    `look` is the Adjust of the Grade's Look and `fit` its table's (an Imported Look's), by default
    the catalogue's (app/looks.py); a Look id that isn't there (as an imported one deleted) is drawn
    as no Look."""
    without = _folded(grade.adjust)
    if grade.look is None:
        return without
    if look is None:
        try:
            found = get_look(grade.look)
        except LookNotFound:
            return without
        look, fit = found.adjust, found.fit if found.has_table else None
    if grade.intensity <= 0:
        return without
    looked = _folded(with_look(grade.adjust, look))
    folded = looked if grade.intensity >= 100 else _mixed(without, looked, grade.intensity / 100)
    if fit is None:
        return folded
    return replace(folded or Folded(None, None), lut=LookTable(grade.look, float(grade.intensity), fit))


def with_look(adjust: Adjust, look: Adjust) -> Adjust:
    """`adjust` with `look`'s values laid over it: each dial moved by as much as the Look's is from
    neutral, held within its range."""
    neutral = Adjust()
    moved = {}
    for name in adjust.__dataclass_fields__:
        low, high = DIAL_RANGES.get(name, (-100, 100))
        moved[name] = min(high, max(low, getattr(adjust, name) + (getattr(look, name) - getattr(neutral, name))))
    return Adjust(**moved)


def _folded(adjust: Adjust) -> Folded | None:
    tables = _tables(adjust)
    matrix = _matrix(adjust)
    if tables is None and matrix is None and not adjust.sharpen and not adjust.vignette:
        return None
    return Folded(tables, matrix, float(adjust.sharpen), float(adjust.vignette))


def _mixed(a: Folded | None, b: Folded | None, t: float) -> Folded | None:
    """`b` mixed over `a` by `t` (0..1), entry by entry; a missing table or matrix is the identity."""
    if a is None and b is None:
        return None
    mix = lambda x, y: x + (y - x) * t  # noqa: E731
    a_tables, b_tables = (None if f is None else f.tables for f in (a, b))
    tables = None
    if a_tables is not None or b_tables is not None:
        given = [a_tables or (_IDENTITY_TABLE,) * 3, b_tables or (_IDENTITY_TABLE,) * 3]
        tables = tuple(tuple(mix(x, y) for x, y in zip(p, q)) for p, q in zip(*given))
    a_matrix, b_matrix = (None if f is None else f.matrix for f in (a, b))
    matrix = None
    if a_matrix is not None or b_matrix is not None:
        given = [a_matrix or _IDENTITY_MATRIX, b_matrix or _IDENTITY_MATRIX]
        matrix = tuple(tuple(mix(x, y) for x, y in zip(p, q)) for p, q in zip(*given))
    sharpen = mix(a.sharpen if a else 0.0, b.sharpen if b else 0.0)
    vignette = mix(a.vignette if a else 0.0, b.vignette if b else 0.0)
    return Folded(tables, matrix, sharpen, vignette)  # type: ignore[arg-type]


def grade_filters(grade: Grade, alpha: str | None = None) -> str:
    """The ffmpeg filters that draw `grade` on a picture, joined by commas, or "" for a neutral one.

    With `alpha` (a prefix for the labels it needs), the picture's alpha is kept, as an Overlay's
    image may have one: the tables and matrix are drawn on RGBA, and a vignette (which ffmpeg draws
    only on opaque pictures) on its colour alone, the alpha split off before and merged back after."""
    folded = fold(grade)
    if folded is None:
        return ""
    if alpha is not None and folded.vignette:
        coloured = _filters(folded, "rgb24")
        return f"format=rgba,split[{alpha}c][{alpha}a];[{alpha}a]alphaextract[{alpha}m];[{alpha}c]{coloured}[{alpha}g];[{alpha}g][{alpha}m]alphamerge"
    return _filters(folded, "rgb24" if alpha is None else "rgba")


def _filters(folded: Folded, rgb: str) -> str:
    """The filters of `folded`, its tables, matrix and Look's table drawn on the pixel format `rgb`."""
    table = None
    if folded.lut is not None:
        try:
            table = imported_looks().table(folded.lut.look, folded.lut.intensity)
        except LookNotFound:
            # Deleted since: drawn as no Look.
            table = None
    coloured = folded.tables is not None or folded.matrix is not None or table is not None
    filters = [f"format={rgb}"] if coloured else []
    if folded.tables is not None:
        # Every entry a point of the curve, so that a spline through them all gives each 8-bit level
        # its own. curves places a point on the level its x is at or just over: each x is nudged up a
        # little, so that rounding can't drop it onto the level below.
        points = [" ".join(f"{min(1.0, (i + 0.001) / (TABLE_SIZE - 1)):.6f}/{value:.6f}" for i, value in enumerate(table)) for table in folded.tables]
        filters.append("curves=" + ":".join(f"{channel}='{line}'" for channel, line in zip("rgb", points)))
    if folded.matrix is not None:
        weights = [f"{out}{given}={weight:.6f}" for out, row in zip("rgb", folded.matrix) for given, weight in zip("rgb", row)]
        filters.append("colorchannelmixer=" + ":".join(weights))
    if table is not None:
        # Tetrahedral, as most grading tools read a table; an alpha (of rgba) is kept as it is.
        filters.append(f"lut3d=file={filter_value(str(table))}:interp=tetrahedral")
    if folded.sharpen:
        # On the luma only (unsharp takes no RGB): a 3×3 box, as the preview's convolution.
        filters.append(f"unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount={SHARPEN_AMOUNT * folded.sharpen / 100:.6f}:chroma_amount=0")
    if folded.vignette:
        # On RGB, so that it scales each channel's level as the preview's gradient does.
        filters.append(f"format=rgb24,vignette=angle={VIGNETTE_ANGLE * folded.vignette / 100:.6f}")
    return ",".join(filters)


def _tables(adjust: Adjust) -> tuple[tuple[float, ...], tuple[float, ...], tuple[float, ...]] | None:
    toned = (adjust.exposure, adjust.brightness, adjust.contrast, adjust.highlights, adjust.shadows, adjust.whites, adjust.blacks, adjust.fade)
    if not any(toned):
        return None
    table = tuple(_tone(i / (TABLE_SIZE - 1), adjust) for i in range(TABLE_SIZE))
    return (table, table, table)


def _tone(value: float, adjust: Adjust) -> float:
    """What the tables make of `value` (0..1)."""
    v = _linear_to_srgb(min(1.0, _srgb_to_linear(value) * 2**adjust.exposure))
    v = _within(v ** (2 ** (-adjust.brightness / 100)))
    slope = 2 ** (CONTRAST_STOPS * adjust.contrast / 100)
    v = _within(v**slope / (v**slope + (1 - v) ** slope))
    # Bumps over the lower and the upper half, each 1 at its peak (a third and two thirds up).
    shadows, highlights = 6.75 * v * (1 - v) ** 2, 6.75 * v * v * (1 - v)
    v = _within(v + TONE_SHIFT * (adjust.shadows / 100 * shadows + adjust.highlights / 100 * highlights))
    v = _within(v + END_SHIFT * (adjust.whites / 100 * v**4 + adjust.blacks / 100 * (1 - v) ** 4))
    fade = adjust.fade / 100
    return _within(FADE_LIFT * fade + v * (1 - (FADE_LIFT + FADE_DIM) * fade))


def _matrix(adjust: Adjust) -> Matrix | None:
    if adjust.temperature == NEUTRAL_TEMPERATURE_K and not adjust.tint and not adjust.saturation:
        return None
    warmth = (adjust.temperature - NEUTRAL_TEMPERATURE_K) / TEMPERATURE_SPAN_K
    gains = (1 + TEMPERATURE_GAIN * warmth, 1 - TINT_GAIN * adjust.tint / 100, 1 - TEMPERATURE_GAIN * warmth)
    # Kept at the same luma: a grey's brightness stays.
    scale = sum(weight * gain for weight, gain in zip(LUMA, gains))
    gains = tuple(gain / scale for gain in gains)
    vivid = 1 + adjust.saturation / 100
    rows = tuple(
        tuple(((1 - vivid) * LUMA[given] + (vivid if out == given else 0.0)) * gains[given] for given in range(3)) for out in range(3)
    )
    return rows  # type: ignore[return-value]


def _within(value: float) -> float:
    return min(1.0, max(0.0, value))


def _srgb_to_linear(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(value: float) -> float:
    return value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055

