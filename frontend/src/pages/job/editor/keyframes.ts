import type { Ease, Keyframe } from "../../../api";

/**
 * Sampling Keyframes (ADR 0008): the value of a property's Keyframes at a time, eased between
 * neighbours by a cubic-bezier. A copy of backend/app/keyframes.py, which the renderer draws keyed
 * pictures by; both are tested on the Ease vectors in backend/tests/fixtures/ease_vectors.json, so
 * that the preview moves as the Clip does (ADR 0001). The solver is Concat's: up to 8 Newton steps
 * from t = x, then 32 steps of bisection where the curve is too flat for Newton; a linear Ease
 * needs none.
 */

// The presets (backend/app/candidates.py's); any other Ease is Custom.
export const LINEAR: Ease = [0, 0, 1, 1];
export const EASE_IN: Ease = [0.42, 0, 1, 1];
export const EASE_OUT: Ease = [0, 0, 0.58, 1];
export const EASE_IN_OUT: Ease = [0.42, 0, 0.58, 1];

/**
 * The value of `keys` (sorted by `at`) at `time`, in the same seconds as their `at`: `constant`
 * without any; the first one's value before it and the last one's after it; between two, the
 * earlier's value moved towards the later's by the later's Ease.
 */
export function valueAt(keys: readonly Keyframe[], time: number, constant: number): number {
  if (!keys.length) return constant;
  if (time <= keys[0].at) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const [before, key] = [keys[i - 1], keys[i]];
    if (time > key.at) continue;
    if (key.at <= before.at) return key.value;
    return before.value + (key.value - before.value) * eased(key.ease, (time - before.at) / (key.at - before.at));
  }
  return keys[keys.length - 1].value;
}

/** How far along `ease` is at `x`, the share of the time between two Keyframes (held to 0..1). */
export function eased([x1, y1, x2, y2]: Ease, x: number): number {
  if (Math.abs(x1 - y1) < 1e-6 && Math.abs(x2 - y2) < 1e-6) return Math.min(Math.max(x, 0), 1);
  return bezierYAtX(x1, y1, x2, y2, x);
}

/** y of the cubic-bezier from (0, 0) to (1, 1) through (x1, y1) and (x2, y2) where its x is `x`. */
export function bezierYAtX(x1: number, y1: number, x2: number, y2: number, x: number): number {
  x = Math.min(Math.max(x, 0), 1);
  let t = x;
  for (let step = 0; step < 8; step++) {
    const error = axis(x1, x2, t) - x;
    if (Math.abs(error) < 1e-7) return axis(y1, y2, t);
    const slope = slopeOf(x1, x2, t);
    if (Math.abs(slope) < 1e-9) break;
    t -= error / slope;
  }
  let [low, high] = [0, 1];
  t = x;
  for (let step = 0; step < 32; step++) {
    const at = axis(x1, x2, t);
    if (Math.abs(at - x) < 1e-7) break;
    if (at > x) high = t;
    else low = t;
    t = (low + high) / 2;
  }
  return axis(y1, y2, t);
}

// One coordinate of the curve at parameter `t`, its ends at 0 and 1.
function axis(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function slopeOf(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}
