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
- **Sharpen and vignette** (0..100), carried as amounts (a Look's mixed in by its intensity, ticket
  05). Sharpen adds the picture's difference from a 3×3 blur of it, times up to SHARPEN_AMOUNT (on
  the luma); vignette multiplies each pixel by cos(angle · d)^4, d its distance from the centre over
  the half diagonal, the angle up to VIGNETTE_ANGLE (the corners black). The preview's are near, not
  exact: an feConvolveMatrix of the same 3×3 sum (on R, G and B) and a radial gradient of the same
  falloff.
"""

import math

from dataclasses import dataclass

from app.candidates import NEUTRAL_TEMPERATURE_K, Adjust, Grade

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

Matrix = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


@dataclass(frozen=True)
class Folded:
    """A Grade as the render and the preview draw it: a table per channel (R, G, B; TABLE_SIZE
    entries each, the output for input i / (TABLE_SIZE − 1), 0..1), or None when they would change
    nothing; then a colour matrix (rows R, G, B of weights on the input's R, G, B), or None likewise;
    then the sharpen and vignette amounts (0..100, 0 for none)."""

    tables: tuple[tuple[float, ...], tuple[float, ...], tuple[float, ...]] | None
    matrix: Matrix | None
    sharpen: float = 0.0
    vignette: float = 0.0


def fold(grade: Grade) -> Folded | None:
    """`grade` folded into its tables, matrix and amounts; None for a neutral one, which adds no filter."""
    adjust = grade.adjust
    tables = _tables(adjust)
    matrix = _matrix(adjust)
    if tables is None and matrix is None and not adjust.sharpen and not adjust.vignette:
        return None
    return Folded(tables, matrix, float(adjust.sharpen), float(adjust.vignette))


def grade_filters(grade: Grade) -> str:
    """The ffmpeg filters that draw `grade` on a picture, joined by commas, or "" for a neutral one."""
    folded = fold(grade)
    if folded is None:
        return ""
    filters = ["format=rgb24"] if folded.tables is not None or folded.matrix is not None else []
    if folded.tables is not None:
        # Every entry a point of the curve, so that a spline through them all gives each 8-bit level
        # its own. curves places a point on the level its x is at or just over: each x is nudged up a
        # little, so that rounding can't drop it onto the level below.
        points = [" ".join(f"{min(1.0, (i + 0.001) / (TABLE_SIZE - 1)):.6f}/{value:.6f}" for i, value in enumerate(table)) for table in folded.tables]
        filters.append("curves=" + ":".join(f"{channel}='{line}'" for channel, line in zip("rgb", points)))
    if folded.matrix is not None:
        weights = [f"{out}{given}={weight:.6f}" for out, row in zip("rgb", folded.matrix) for given, weight in zip("rgb", row)]
        filters.append("colorchannelmixer=" + ":".join(weights))
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

