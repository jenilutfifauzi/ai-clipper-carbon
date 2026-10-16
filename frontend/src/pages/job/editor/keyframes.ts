import type { Ease, Keyframe, KeyProperty, Keys, Transform } from "../../../api";

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

/*
 * The editor's Keyframe actions (ADR 0004, ADR 0008): pure, each result saved as one change of the
 * edits. Times are an item's own seconds; values are in the property's units.
 */

// The least time between two Keyframes of a property, a frame, and the most Keyframes on one
// (KEY_GAP_SECS and MAX_KEYS in backend/app/candidates.py, which accepts a gap half a millisecond short).
export const KEY_GAP_SECS = 1 / 30;
export const MAX_KEYS = 100;
const GAP_REACH = 0.0005;
// A Keyframe within half a frame of a time is the one at it.
const HALF_FRAME = KEY_GAP_SECS / 2 + 1e-9;

// What can be keyed of a picture: its Transform's centre, scale, rotation and opacity.
export const PICTURE_KEYS = ["x", "y", "scale", "rotation", "opacity"] as const;
export type PictureKey = (typeof PICTURE_KEYS)[number];

// Each property's range (KEY_RANGES in backend/app/candidates.py).
const RANGES: Record<KeyProperty, readonly [number, number]> = {
  x: [0, 1080],
  y: [0, 1920],
  scale: [0.05, 8],
  rotation: [-3600, 3600],
  opacity: [0, 1],
  volume: [0, 2],
};

const toMillisecond = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The index of the Keyframe of `keys` at `at`: the nearest within half a frame, or -1. */
export function keyAt(keys: readonly Keyframe[], at: number): number {
  let found = -1;
  keys.forEach((key, index) => {
    const off = Math.abs(key.at - at);
    if (off <= HALF_FRAME && (found < 0 || off < Math.abs(keys[found].at - at))) found = index;
  });
  return found;
}

/** The times of the Keyframes nearest before and after `at`, beyond half a frame: where ‹ and › go. */
export function keysAround(keys: readonly Keyframe[], at: number): { before: number | null; after: number | null } {
  const before = keys.filter((key) => key.at < at - HALF_FRAME).at(-1);
  const after = keys.find((key) => key.at > at + HALF_FRAME);
  return { before: before?.at ?? null, after: after?.at ?? null };
}

/** A property's diamond at `at`: filled on a Keyframe ("here"), outlined between them ("elsewhere"), grey without any. */
export function keyState(keys: readonly Keyframe[], at: number): "here" | "elsewhere" | "constant" {
  if (!keys.length) return "constant";
  return keyAt(keys, at) >= 0 ? "here" : "elsewhere";
}

/**
 * `keys` of `prop` with a Keyframe of `value` (held to its range) at `at` (to the millisecond). It
 * replaces those closer than a frame, which the Candidate would refuse, so the one within half a
 * frame, and keeps the nearest one's Ease; else it takes the Ease of the one before it, or Linear as
 * the first, so that a run of Keyframes laid down keeps one shape. A 101st isn't added: `keys` come
 * back as they are.
 */
export function setKey(keys: readonly Keyframe[], prop: KeyProperty, at: number, value: number): Keyframe[] {
  const time = toMillisecond(Math.max(at, 0));
  const crowded = (key: Keyframe) => Math.abs(key.at - time) < KEY_GAP_SECS - GAP_REACH;
  const kept = keys.filter((key) => !crowded(key));
  if (kept.length >= MAX_KEYS) return keys as Keyframe[];
  const replaced = keys.filter(crowded).sort((a, b) => Math.abs(a.at - time) - Math.abs(b.at - time))[0];
  const ease = replaced?.ease ?? kept.filter((key) => key.at < time).at(-1)?.ease ?? LINEAR;
  const [low, high] = RANGES[prop];
  const key = { at: time, value: Math.min(Math.max(value, low), high), ease };
  return [...kept, key].sort((a, b) => a.at - b.at);
}

/** `keys` without the Keyframe at `at` (see keyAt); as they are when there is none. */
export function removeKey(keys: readonly Keyframe[], at: number): Keyframe[] {
  const index = keyAt(keys, at);
  return index < 0 ? (keys as Keyframe[]) : keys.filter((_, other) => other !== index);
}

// `keys` with `prop`'s Keyframes `list`: left out when there are none.
function withList(keys: Keys, prop: KeyProperty, list: Keyframe[]): Keys {
  const { [prop]: _, ...rest } = keys;
  return list.length ? { ...rest, [prop]: list } : rest;
}

/**
 * The diamond clicked: `prop` of an item (its Keyframes `keys` and its `constant`) with a Keyframe
 * at `at`, of the value shown there, so that nothing moves; or, when there is one there, without it.
 * Removing the last one leaves the constant at the value there, so that nothing jumps.
 */
export function toggleKey(keys: Keys, prop: KeyProperty, at: number, constant: number): { keys: Keys; constant: number } {
  const list = keys[prop] ?? [];
  if (keyAt(list, at) < 0) return { keys: withList(keys, prop, setKey(list, prop, at, valueAt(list, at, constant))), constant };
  const left = removeKey(list, at);
  return { keys: withList(keys, prop, left), constant: left.length ? constant : valueAt(list, at, constant) };
}

/**
 * `prop` of an item changed to `value` with the playhead at `at` (auto-key): a Keyframe written there
 * once the property has Keyframes, else its constant.
 */
export function writeKey(keys: Keys, prop: KeyProperty, at: number, value: number, constant: number): { keys: Keys; constant: number } {
  const list = keys[prop] ?? [];
  return list.length ? { keys: withList(keys, prop, setKey(list, prop, at, value)), constant } : { keys, constant: value };
}

/** `keys` without the Keyframes of `props`: of every property when none are named. */
export function clearKeys(keys: Keys, props?: readonly KeyProperty[]): Keys {
  if (!props) return {};
  return Object.fromEntries(Object.entries(keys).filter(([prop]) => !props.includes(prop as KeyProperty)));
}

/** `transform` as shown at `at`: its keyed fields at their Keyframes' values there, held to their ranges. */
export function shownTransform(transform: Transform, keys: Keys, at: number): Transform {
  const keyed = PICTURE_KEYS.filter((prop) => keys[prop]?.length);
  if (!keyed.length) return transform;
  const shown = { ...transform };
  for (const prop of keyed) {
    const value = valueAt(keys[prop]!, at, transform[prop]);
    const [low, high] = RANGES[prop];
    shown[prop] = prop === "rotation" ? value : Math.min(Math.max(value, low), high);
  }
  return shown;
}

/**
 * An item's `transform` and `keys` after a change to `next` with the playhead at `at` (auto-key: a
 * field, a Grips drag, Fit and Fill): each keyed field that differs from what was `shown` writes a
 * Keyframe there, and each other field is its constant. With the playhead outside the item (`at`
 * null), a keyed field's change is dropped.
 */
export function writtenTransform(
  transform: Transform,
  keys: Keys,
  next: Transform,
  at: number | null,
  shown: Transform = shownTransform(transform, keys, at ?? 0),
): { transform: Transform; keys: Keys } {
  let written = keys;
  const constants = { ...next };
  for (const prop of PICTURE_KEYS) {
    if (!keys[prop]?.length) continue;
    constants[prop] = transform[prop];
    if (at !== null && next[prop] !== shown[prop]) written = writeKey(written, prop, at, next[prop], transform[prop]).keys;
  }
  return { transform: constants, keys: written };
}
