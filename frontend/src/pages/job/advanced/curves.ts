import type { Keyframe, KeyProperty } from "../../../api";
import { eased, KEY_RANGES } from "../editor/keyframes";

/**
 * The Keyframes pane's Curves, worked out from numbers alone: a property's value over its item drawn
 * in a unit square (time across, from its start to its end; value up, over its plot's range). Between
 * two Keyframes the curve is the cubic-bezier of the later one's Ease, scaled to the span: an Ease's
 * handles are the curve's own, so the drawn curve is the value the sampling module gives (ADR 0008).
 */

/** What a curve is drawn over: its item's length, and the range of values from the bottom to the top. */
export interface Plot {
  secs: number;
  low: number;
  high: number;
}

/** A point of the plot: x a share of the item's length, y a share of its height from the top. */
export interface PlotPoint {
  x: number;
  y: number;
}

/** Where `value` at `at` (the item's seconds) is in `plot`. */
export function plotPoint(plot: Plot, at: number, value: number): PlotPoint {
  const span = plot.high - plot.low;
  return { x: plot.secs > 0 ? at / plot.secs : 0, y: span > 0 ? 1 - (value - plot.low) / span : 0.5 };
}

/** The value at height `y` of `plot`. */
export const plotValue = (plot: Plot, y: number) => plot.low + (1 - y) * (plot.high - plot.low);

/** The time at `x` of `plot`, in its item's seconds. */
export const plotTime = (plot: Plot, x: number) => x * plot.secs;

const point = ({ x, y }: PlotPoint) => `${x} ${y}`;

/**
 * The SVG path of `keys` (sorted) in `plot`'s unit square: held at the first value from the item's
 * start, a cubic per span, held at the last value to its end. Empty without Keyframes.
 */
export function curvePath(keys: readonly Keyframe[], plot: Plot): string {
  if (!keys.length) return "";
  const first = plotPoint(plot, keys[0].at, keys[0].value);
  const last = plotPoint(plot, keys[keys.length - 1].at, keys[keys.length - 1].value);
  const parts = [`M 0 ${first.y}`, `L ${point(first)}`];
  for (let index = 1; index < keys.length; index++) {
    const handles = easeHandles(keys, index, plot)!;
    parts.push(`C ${point(handles.first)} ${point(handles.second)} ${point(handles.to)}`);
  }
  parts.push(`L 1 ${last.y}`);
  return parts.join(" ");
}

/**
 * The span ending at Keyframe `index` in `plot`: its two ends, and its Ease's two handles (the first
 * hangs from where it starts, the second from where it ends). Null for the first Keyframe, which ends no span.
 */
export function easeHandles(keys: readonly Keyframe[], index: number, plot: Plot): { from: PlotPoint; to: PlotPoint; first: PlotPoint; second: PlotPoint } | null {
  if (index < 1 || index >= keys.length) return null;
  const from = plotPoint(plot, keys[index - 1].at, keys[index - 1].value);
  const to = plotPoint(plot, keys[index].at, keys[index].value);
  const [x1, y1, x2, y2] = keys[index].ease;
  const along = (x: number, y: number) => ({ x: from.x + x * (to.x - from.x), y: from.y + y * (to.y - from.y) });
  return { from, to, first: along(x1, y1), second: along(x2, y2) };
}

/**
 * Where a handle of the span ending at Keyframe `index` dragged to `at` (a point of `plot`) is, as
 * shares of the span's time and change: an Ease's x and y. A flat span has no change to share: its
 * y is null, and the Ease keeps its own.
 */
export function handleShares(keys: readonly Keyframe[], index: number, plot: Plot, at: PlotPoint): { x: number; y: number | null } {
  const { from, to } = easeHandles(keys, index, plot)!;
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  return { x: dx ? (at.x - from.x) / dx : 0, y: Math.abs(dy) > 1e-9 ? (at.y - from.y) / dy : null };
}

// Each eased span is looked at this many times for how far it overshoots.
const LOOKS = 24;
// The room left above and below a curve, a share of its range.
const ROOM = 0.15;

/**
 * The range a curve of `prop`'s `keys` is plotted over: from its lowest to its highest value, an
 * Ease's overshoot included, with some room above and below, within the property's range. A flat
 * curve gets a band around its value of a twentieth of the property's range.
 */
export function curveRange(prop: KeyProperty, keys: readonly Keyframe[]): [number, number] {
  const [lowest, highest] = KEY_RANGES[prop];
  const values = keys.map((key) => key.value);
  for (let index = 1; index < keys.length; index++) {
    const [before, key] = [keys[index - 1], keys[index]];
    for (let look = 1; look < LOOKS; look++) values.push(before.value + (key.value - before.value) * eased(key.ease, look / LOOKS));
  }
  let [low, high] = values.length ? [Math.min(...values), Math.max(...values)] : [lowest, highest];
  const room = high - low > 1e-9 ? (high - low) * ROOM : (highest - lowest) / 40;
  [low, high] = [low - room, high + room];
  return [Math.max(low, lowest), Math.min(high, highest)];
}
