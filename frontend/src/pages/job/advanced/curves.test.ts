// The Keyframes pane's Curves (.scratch/keyframes/spec.md): a property's curve as drawn is the value
// the sampling module gives, on the shared Ease vectors (backend/tests/fixtures/ease_vectors.json),
// so that what the owner shapes is what plays.
import { describe, expect, test } from "vitest";
import vectors from "../../../../../backend/tests/fixtures/ease_vectors.json";
import type { Ease, Keyframe } from "../../../api";
import { EASE_OUT, LINEAR, valueAt } from "../editor/keyframes";
import { curvePath, curveRange, easeHandles, handleShares, plotPoint, plotValue } from "./curves";
import { PORTRAIT } from "../editor/canvas";

type Point = [number, number];

// The path's pieces: where it starts, and each line or cubic after it.
function pieces(path: string): { start: Point; pieces: ({ kind: "L"; to: Point } | { kind: "C"; c1: Point; c2: Point; to: Point })[] } {
  const tokens = path.trim().split(/\s+/);
  const number = () => Number(tokens.shift());
  const point = (): Point => [number(), number()];
  expect(tokens.shift()).toBe("M");
  const start = point();
  const out = [];
  while (tokens.length) {
    const kind = tokens.shift();
    if (kind === "L") out.push({ kind: "L" as const, to: point() });
    else if (kind === "C") out.push({ kind: "C" as const, c1: point(), c2: point(), to: point() });
    else throw new Error(`Not a path command: ${kind}`);
  }
  return { start, pieces: out };
}

// The y of a cubic from `from` where its x is `x`, by bisection (its x only grows: the Ease's x is within 0..1).
function cubicYAtX(from: Point, c1: Point, c2: Point, to: Point, x: number): number {
  const at = (t: number, i: 0 | 1) => {
    const u = 1 - t;
    return u * u * u * from[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * to[i];
  };
  let [low, high] = [0, 1];
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (at(middle, 0) < x) low = middle;
    else high = middle;
  }
  return at((low + high) / 2, 1);
}

// The y the path draws at `x`: on its line or its cubic there.
function drawnAt(path: string, x: number): number {
  const { start, pieces: drawn } = pieces(path);
  let from = start;
  for (const piece of drawn) {
    if (x <= piece.to[0] + 1e-12) {
      if (piece.kind === "C") return cubicYAtX(from, piece.c1, piece.c2, piece.to, x);
      const share = piece.to[0] === from[0] ? 1 : (x - from[0]) / (piece.to[0] - from[0]);
      return from[1] + (piece.to[1] - from[1]) * share;
    }
    from = piece.to;
  }
  return from[1];
}

describe("a span of the Curves", () => {
  // An item 4 s long, plotted from 100 to 900; a span from 200 at 1 s to 800 at 3 s.
  const plot = { secs: 4, low: 100, high: 900 };
  for (const vector of vectors.eases) {
    test(`with the Ease ${vector.name} is drawn where the sampling module puts it`, () => {
      const keys: Keyframe[] = [
        { at: 1, value: 200, ease: LINEAR },
        { at: 3, value: 800, ease: vector.ease as Ease },
      ];
      const path = curvePath(keys, plot);
      for (const [x, y] of vector.at) {
        const time = 1 + 2 * x;
        const drawn = drawnAt(path, time / plot.secs);
        // As the shared vector says, and as valueAt samples it.
        expect(Math.abs(plotValue(plot, drawn) - (200 + 600 * y))).toBeLessThan(1e-4);
        expect(Math.abs(plotValue(plot, drawn) - valueAt(keys, time, 0))).toBeLessThan(1e-4);
      }
    });
  }

  test("holds the first value before the first Keyframe and the last after the last", () => {
    const keys: Keyframe[] = [
      { at: 1, value: 200, ease: LINEAR },
      { at: 3, value: 800, ease: EASE_OUT },
    ];
    const path = curvePath(keys, plot);
    expect(drawnAt(path, 0)).toBeCloseTo(plotPoint(plot, 0, 200).y, 9);
    expect(drawnAt(path, 0.2)).toBeCloseTo(plotPoint(plot, 0, 200).y, 9);
    expect(drawnAt(path, 1)).toBeCloseTo(plotPoint(plot, 0, 800).y, 9);
    expect(curvePath([], plot)).toBe("");
  });
});

describe("the Curves' plot", () => {
  test("is a curve's own range, overshoot included, with room around it", () => {
    const [low, high] = curveRange("x", [
      { at: 0, value: 200, ease: LINEAR },
      { at: 2, value: 600, ease: [0.34, 1.56, 0.64, 1] },
    ], PORTRAIT);
    // It goes past 600 (to about 635) on its way.
    expect(low).toBeLessThan(200);
    expect(high).toBeGreaterThan(635);
    expect(high - low).toBeLessThan(600);
  });

  test("of a flat curve is a band around its value, within its property's range", () => {
    const [low, high] = curveRange("opacity", [{ at: 0, value: 1, ease: LINEAR }], PORTRAIT);
    expect(low).toBeLessThan(1);
    expect(high).toBe(1);
  });

  test("maps a value to a height and back", () => {
    const plot = { secs: 2, low: 0, high: 10 };
    expect(plotPoint(plot, 0.5, 7.5)).toEqual({ x: 0.25, y: 0.25 });
    expect(plotValue(plot, 0.25)).toBe(7.5);
  });
});

describe("a span's Ease handles", () => {
  const plot = { secs: 4, low: 0, high: 100 };
  const keys: Keyframe[] = [
    { at: 0, value: 0, ease: LINEAR },
    { at: 2, value: 100, ease: [0.3, -0.5, 0.2, 1.4] },
  ];

  test("hang from its two ends, where its Ease's numbers put them", () => {
    const handles = easeHandles(keys, 1, plot)!;
    const near = (point: { x: number; y: number }) => [point.x, point.y].map((n) => Math.round(n * 1e9) / 1e9);
    expect([handles.from, handles.to, handles.first, handles.second].map(near)).toEqual([
      [0, 1],
      [0.5, 0],
      [0.15, 1.5],
      [0.1, -0.4],
    ]);
    expect(easeHandles(keys, 0, plot)).toBeNull();
  });

  test("dragged, give the shares of its span the Ease is made of", () => {
    const shares = handleShares(keys, 1, plot, { x: 0.25, y: 0.2 });
    expect(shares.x).toBeCloseTo(0.5, 9);
    expect(shares.y).toBeCloseTo(0.8, 9);
  });

  test("of a flat span leave the Ease's y as it is: there is no change to share", () => {
    const flat: Keyframe[] = [
      { at: 0, value: 50, ease: LINEAR },
      { at: 2, value: 50, ease: LINEAR },
    ];
    expect(handleShares(flat, 1, plot, { x: 0.25, y: 0.2 })).toEqual({ x: 0.5, y: null });
  });
});
