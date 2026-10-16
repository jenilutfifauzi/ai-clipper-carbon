// Seam K (.scratch/keyframes/spec.md): the sampling module, on the Ease vectors the backend's tests
// read too (backend/tests/fixtures/ease_vectors.json), so that the two solvers can't drift.
import { describe, expect, test } from "vitest";
import vectors from "../../../../../backend/tests/fixtures/ease_vectors.json";
import type { Ease, Keyframe } from "../../../api";
import { eased, EASE_IN_OUT, LINEAR, valueAt } from "./keyframes";

describe("an Ease", () => {
  for (const vector of vectors.eases) {
    test(`${vector.name} is solved as the shared vectors say`, () => {
      for (const [x, y] of vector.at) expect(Math.abs(eased(vector.ease as Ease, x) - y)).toBeLessThan(vectors.tolerance);
    });
  }
});

describe("the value of Keyframes at a time", () => {
  const keys: Keyframe[] = [
    { at: 1, value: 200, ease: LINEAR },
    { at: 3, value: 800, ease: EASE_IN_OUT },
  ];

  test("holds before the first and after the last, is the constant without any, and eases between", () => {
    expect(valueAt([], 2, 540)).toBe(540);
    expect(valueAt(keys, 0, 540)).toBe(200);
    expect(valueAt(keys, 5, 540)).toBe(800);
    // Half way in time is half way for an in-out Ease; a quarter of the way is less than a quarter.
    expect(valueAt(keys, 2, 540)).toBeCloseTo(500, 9);
    expect(valueAt(keys, 1.5, 540)).toBeCloseTo(200 + 600 * 0.129161931047, 3);
  });

  test("of two a frame apart steps within that frame", () => {
    const step: Keyframe[] = [
      { at: 0, value: 0, ease: LINEAR },
      { at: 1, value: 0, ease: LINEAR },
      { at: 1 + 1 / 30, value: 1, ease: LINEAR },
    ];
    expect(valueAt(step, 1, 0.5)).toBe(0);
    expect(valueAt(step, 1 + 1 / 60, 0.5)).toBeCloseTo(0.5, 9);
    expect(valueAt(step, 1 + 1 / 30, 0.5)).toBe(1);
  });
});
