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
export const KEY_RANGES: Record<KeyProperty, readonly [number, number]> = {
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
  const [low, high] = KEY_RANGES[prop];
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

// The Eases' names, the presets' as backend/app/candidates.py's EASES names them; any other is Custom.
export type EaseName = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "custom";
export const EASE_PRESETS: readonly { name: Exclude<EaseName, "custom">; label: string; ease: Ease }[] = [
  { name: "linear", label: "Linear", ease: LINEAR },
  { name: "ease_in", label: "Ease in", ease: EASE_IN },
  { name: "ease_out", label: "Ease out", ease: EASE_OUT },
  { name: "ease_in_out", label: "Ease in-out", ease: EASE_IN_OUT },
];
// An Ease within this of each of a preset's numbers is that preset (PRESET_REACH), and its y is held
// to EASE_Y (backend/app/candidates.py).
const PRESET_REACH = 0.005;
const EASE_Y = [-2, 3] as const;

/** The preset `ease` is, or "custom". */
export function easeName(ease: Ease): EaseName {
  return EASE_PRESETS.find((preset) => preset.ease.every((number, i) => Math.abs(number - ease[i]) <= PRESET_REACH + 1e-9))?.name ?? "custom";
}

/** `ease` as the Candidate keeps it (tidy_ease): its x held to 0..1, its y to −2..3, and Linear when any of it isn't finite. */
export function tidyEase(ease: Ease): Ease {
  if (!ease.every(Number.isFinite)) return LINEAR;
  const [x1, y1, x2, y2] = ease;
  const y = (value: number) => Math.min(Math.max(value, EASE_Y[0]), EASE_Y[1]);
  return [Math.min(Math.max(x1, 0), 1), y(y1), Math.min(Math.max(x2, 0), 1), y(y2)];
}

/** `keys` with the Keyframe at `index` approached by `ease` (tidied): a preset's four numbers, or a Custom one. */
export function setEase(keys: readonly Keyframe[], index: number, ease: Ease): Keyframe[] {
  return keys.map((key, other) => (other === index ? { ...key, ease: tidyEase(ease) } : key));
}

/**
 * `ease` with its first or second handle (`which`) dragged to (`x`, `y`): shares of its span's time
 * and change, as the Curves draw it. A Custom Ease, tidied, so its x stays within 0..1; to a
 * thousandth, finer than a drag can tell.
 */
export function handleEase(ease: Ease, which: 1 | 2, x: number, y: number): Ease {
  const [x1, y1, x2, y2] = ease;
  const [hx, hy] = [x, y].map((value) => Math.round(value * 1000) / 1000);
  return tidyEase(which === 1 ? [hx, hy, x2, y2] : [x1, y1, hx, hy]);
}

/**
 * The Keyframe whose Ease the Keyframes pane shows at `at`: the one there, else the next one; never
 * the first, whose Ease is unused. -1 when there is none.
 */
export function easedKey(keys: readonly Keyframe[], at: number): number {
  return keys.findIndex((key, index) => index > 0 && key.at >= at - HALF_FRAME);
}

/** Where a Keyframe can be dragged to: the Clip's frame rate, and its item's start (Timeline time) and length. */
export interface KeyGrid {
  fps: number;
  start: number;
  secs: number;
}

/**
 * `keys` with the one at `index` dragged to `to` (its item's seconds), keeping its Ease: onto the
 * nearest of the Clip's frames, and never past a neighbour or out of its item (a frame short of a
 * neighbour at the most, on a frame where there is one). With `value`, the Curves' drag, its value
 * changes too, held to its property's range. To the millisecond.
 */
export function moveKey(keys: readonly Keyframe[], index: number, to: number, grid: KeyGrid, value?: { prop: KeyProperty; value: number }): Keyframe[] {
  const key = keys[index];
  if (!key) return keys as Keyframe[];
  const { fps, start, secs } = grid;
  const low = index > 0 ? keys[index - 1].at + KEY_GAP_SECS : 0;
  const high = index < keys.length - 1 ? keys[index + 1].at - KEY_GAP_SECS : secs;
  let at = Math.round((start + to) * fps) / fps - start;
  if (at < low) at = Math.ceil((start + low) * fps - 1e-6) / fps - start;
  if (at > high) at = Math.floor((start + high) * fps + 1e-6) / fps - start;
  at = Math.min(Math.max(at, low), high);
  const moved = { ...key, at: toMillisecond(at) };
  if (value) {
    const [lowest, highest] = KEY_RANGES[value.prop];
    moved.value = Math.min(Math.max(value.value, lowest), highest);
  }
  return keys.map((other, i) => (i === index ? moved : other));
}

/** `transform` as shown at `at`: its keyed fields at their Keyframes' values there, held to their ranges. */
export function shownTransform(transform: Transform, keys: Keys, at: number): Transform {
  const keyed = PICTURE_KEYS.filter((prop) => keys[prop]?.length);
  if (!keyed.length) return transform;
  const shown = { ...transform };
  for (const prop of keyed) {
    const value = valueAt(keys[prop]!, at, transform[prop]);
    const [low, high] = KEY_RANGES[prop];
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

// Re-anchoring (Concat's `rewindow`): an item trimmed, split or rippled keeps the Keyframes of the
// part it still plays, so that it plays what it did at the moments it keeps.

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
