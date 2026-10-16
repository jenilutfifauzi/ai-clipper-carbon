import type { Ease, Keyframe, Keys } from "../../../api";

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
  return axis(y1, y2, parameterAt(x1, x2, x));
}

// The parameter t where the curve's x is `x` (held to 0..1).
function parameterAt(x1: number, x2: number, x: number): number {
  x = Math.min(Math.max(x, 0), 1);
  let t = x;
  for (let step = 0; step < 8; step++) {
    const error = axis(x1, x2, t) - x;
    if (Math.abs(error) < 1e-7) return t;
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
  return t;
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

// Re-anchoring (Concat's `rewindow`): an item trimmed, split or rippled keeps the Keyframes of the
// part it still plays, so that it plays what it did at the moments it keeps.

// The least time between two Keyframes of a property (KEY_GAP_SECS in backend/app/candidates.py).
const KEY_GAP_SECS = 1 / 30;
// How far outside the kept window a Keyframe can be and still be in it, for times rounded on the way.
const WINDOW_REACH = 1e-6;
// Re-anchored times are kept to a microsecond, so that the sums leave no float dust in them.
const microseconds = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/**
 * `keys` (sorted, in seconds from their item's start) for the item once it plays only from `from` to
 * `to` of itself as it was: each kept one moved `from` earlier, each outside removed. When some were
 * removed before `from`, one is added at 0 with the value there, Linear; when some were removed after
 * `to`, one at the new end with the value there and the Ease of the first one removed. A span cut
 * short eases over the part of its Ease it kept (easePart), so that the piece plays exactly what the
 * whole did; a Linear one stays Linear, and so is the rule's Ease where a span is whole. An added one
 * isn't wanted closer than a frame to a kept one (nor allowed: they are a frame apart at least). A
 * window past the item's ends (it got longer) removes none: a later end leaves them as they are (the
 * same list), an earlier start keeps them on the same moments.
 */
export function rewindow(keys: readonly Keyframe[], from: number, to: number): Keyframe[] {
  const kept = keys.filter((key) => key.at >= from - WINDOW_REACH && key.at <= to + WINDOW_REACH);
  if (Math.abs(from) <= WINDOW_REACH && kept.length === keys.length) return keys as Keyframe[];
  // In the item's old seconds first.
  const out = kept.map((key) => ({ ...key }));
  const cutBefore = keys.some((key) => key.at < from - WINDOW_REACH);
  const firstAfter = keys.find((key) => key.at > to + WINDOW_REACH);
  if (cutBefore && !(out.length && out[0].at - from < KEY_GAP_SECS)) out.unshift({ at: from, value: valueAt(keys, from, 0), ease: LINEAR });
  if (firstAfter && !(out.length && to - out[out.length - 1].at < KEY_GAP_SECS)) out.push({ at: to, value: valueAt(keys, to, 0), ease: firstAfter.ease });
  const length = microseconds(to - from);
  return out.map((key, i) => ({
    at: Math.min(Math.max(microseconds(key.at - from), 0), length),
    value: key.value,
    ease: i ? easeOver(keys, out[i - 1].at, key.at) : key.ease,
  }));
}

// The Ease the span of `keys` from `a` to `b` (both within one span of them) has: the Ease of the
// Keyframe that ends that span, or the part of it from `a` to `b` where it is cut short.
function easeOver(keys: readonly Keyframe[], a: number, b: number): Ease {
  const end = keys.findIndex((key) => key.at >= b - WINDOW_REACH);
  const [before, key] = [keys[end - 1], keys[end]];
  if (!before || !key || key.at <= before.at) return key?.ease ?? LINEAR;
  if (a <= before.at + WINDOW_REACH && b >= key.at - WINDOW_REACH) return key.ease;
  const span = key.at - before.at;
  return easePart(key.ease, (a - before.at) / span, (b - before.at) / span);
}

/**
 * The part of `ease` from `x0` to `x1` (shares of its span, 0 ≤ x0 < x1 ≤ 1) as an Ease of its own:
 * the cubic-bezier between those points, scaled to the unit square, so that a span cut there eases
 * as the whole span did between them. `ease` itself when it is linear, or where the part can't be an
 * Ease (it ends at the height it began, or its handles go past an Ease's bounds: y within −2..3).
 */
export function easePart(ease: Ease, x0: number, x1: number): Ease {
  const [x1h, y1h, x2h, y2h] = ease;
  if (Math.abs(x1h - y1h) < 1e-6 && Math.abs(x2h - y2h) < 1e-6) return ease;
  const [t0, t1] = [parameterAt(x1h, x2h, x0), parameterAt(x1h, x2h, x1)];
  // The part's ends, and its handles a third of the way along each end's tangent (exact for a cubic).
  const third = (t1 - t0) / 3;
  const [ax, ay, bx, by] = [axis(x1h, x2h, t0), axis(y1h, y2h, t0), axis(x1h, x2h, t1), axis(y1h, y2h, t1)];
  if (bx - ax < 1e-9 || Math.abs(by - ay) < 1e-9) return ease;
  const handles = [
    (ax + third * slopeOf(x1h, x2h, t0) - ax) / (bx - ax),
    (ay + third * slopeOf(y1h, y2h, t0) - ay) / (by - ay),
    (bx - third * slopeOf(x1h, x2h, t1) - ax) / (bx - ax),
    (by - third * slopeOf(y1h, y2h, t1) - ay) / (by - ay),
  ].map((value) => Math.round(value * 1e6) / 1e6);
  const [px1, py1, px2, py2] = handles;
  if ([py1, py2].some((y) => y < -2 || y > 3)) return ease;
  return [Math.min(Math.max(px1, 0), 1), py1, Math.min(Math.max(px2, 0), 1), py2];
}

/** Every keyed property of `keys` re-anchored to the window from `from` to `to` (see rewindow); `keys` itself when none changes. */
export function rewindowKeys(keys: Keys, from: number, to: number): Keys {
  const moved = (Object.entries(keys) as [keyof Keys, Keyframe[]][]).map(([property, list]) => [property, rewindow(list, from, to)] as const);
  return moved.every(([property, list]) => list === keys[property]) ? keys : Object.fromEntries(moved);
}

/**
 * `item` once it plays only from `from` to `to` seconds of itself as it was, its Keyframes
 * re-anchored to that window; an item without Keyframes (a Text Layer) as it is, and so is one whose
 * Keyframes all stay. Every trim, split and ripple of an item goes through this, whatever its kind.
 */
export function rekeyed<T extends object>(item: T, from: number, to: number): T {
  if (!("keys" in item)) return item;
  const keys = item.keys as Keys;
  const next = rewindowKeys(keys, from, to);
  return next === keys ? item : { ...item, keys: next };
}
