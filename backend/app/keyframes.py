"""Sampling Keyframes (docs/adr/0008-keyframes-for-pictures-and-sound.md): the value of a property's
Keyframes at a time, eased between neighbours by a cubic-bezier. Pure, and the one rule the
renderer draws a keyed picture by; the preview has a copy of it
(frontend/src/pages/job/editor/keyframes.ts), and both are tested on the Ease vectors in
tests/fixtures/ease_vectors.json, so that they can't drift (ADR 0001).

The solver is Concat's (concat-core/src/animate.rs): up to 8 Newton steps from t = x, then 32 steps
of bisection where the curve is too flat for Newton; a linear Ease needs none.
"""

from collections.abc import Sequence

from app.candidates import Ease, Keyframe


def value_at(keys: Sequence[Keyframe], time: float, constant: float) -> float:
    """The value of `keys` (sorted by `at`) at `time`, in the same seconds as their `at`: `constant`
    without any; the first one's value before it and the last one's after it; between two, the
    earlier's value moved towards the later's by the later's Ease."""
    if not keys:
        return constant
    if time <= keys[0].at:
        return keys[0].value
    for before, key in zip(keys, keys[1:]):
        if time <= key.at:
            if key.at <= before.at:
                return key.value
            return before.value + (key.value - before.value) * eased(key.ease, (time - before.at) / (key.at - before.at))
    return keys[-1].value


def eased(ease: Ease, x: float) -> float:
    """How far along `ease` is at `x`, the share of the time between two Keyframes (held to 0..1)."""
    if abs(ease.x1 - ease.y1) < 1e-6 and abs(ease.x2 - ease.y2) < 1e-6:
        return min(max(x, 0.0), 1.0)
    return bezier_y_at_x(*ease, x)


def bezier_y_at_x(x1: float, y1: float, x2: float, y2: float, x: float) -> float:
    """y of the cubic-bezier from (0, 0) to (1, 1) through (x1, y1) and (x2, y2) where its x is `x`."""
    x = min(max(x, 0.0), 1.0)
    t = x
    for _ in range(8):
        error = _axis(x1, x2, t) - x
        if abs(error) < 1e-7:
            return _axis(y1, y2, t)
        slope = _slope(x1, x2, t)
        if abs(slope) < 1e-9:
            break
        t -= error / slope
    low, high = 0.0, 1.0
    t = x
    for _ in range(32):
        at = _axis(x1, x2, t)
        if abs(at - x) < 1e-7:
            break
        if at > x:
            high = t
        else:
            low = t
        t = (low + high) / 2
    return _axis(y1, y2, t)


def _axis(p1: float, p2: float, t: float) -> float:
    """One coordinate of the curve at parameter `t`, its ends at 0 and 1."""
    u = 1 - t
    return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t


def _slope(p1: float, p2: float, t: float) -> float:
    u = 1 - t
    return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2)
