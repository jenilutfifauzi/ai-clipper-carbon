// .scratch/text-advanced/issues/14-hook-and-caption-shadow-and-box-shape.md: the preview draws the
// hook's and captions' drop shadow and box shape as the renderer does, and a Style Override of a
// shadow names some of its fields.
import { describe, expect, test } from "vitest";
import type { DropShadow } from "../../../api";
import { NO_SHADOW } from "./shadow";
import { highlightShape, hookPadding, drawnShadow } from "./styleShape";
import { overridden, sameValue } from "./useStyleDraft";

describe("the hook's and captions' box shape", () => {
  test("the hook's box is padded as its style says, or as its Shape is by default", () => {
    const style = { shape: "block", size: 88, padding_x: null, padding_y: null } as const;
    expect(hookPadding(style)).toEqual([36, 26]);
    expect(hookPadding({ ...style, shape: "strips" })).toEqual([22, 0.14 * 88]);
    expect(hookPadding({ ...style, shape: "strips", padding_x: 40 })).toEqual([40, 0.14 * 88]);
    expect(hookPadding({ ...style, padding_x: 60, padding_y: 10 })).toEqual([60, 10]);
    // Lines with no box keep a block's own.
    expect(hookPadding({ ...style, shape: "none", padding_x: 60, padding_y: 10 })).toEqual([36, 26]);
  });

  test("the highlight box is padded and rounded as its style says at its size, or in proportion to the line", () => {
    const style = { size: 100, padding_x: null, padding_y: null, radius: null };
    expect(highlightShape(style, 50)).toEqual({ padX: 6, padY: 4, radius: 6 });
    expect(highlightShape({ ...style, padding_x: 30, padding_y: 20, radius: 0 }, 100)).toEqual({ padX: 30, padY: 20, radius: 0 });
    // A line set smaller has it smaller.
    expect(highlightShape({ ...style, padding_x: 30, padding_y: 20, radius: 10 }, 50)).toEqual({ padX: 15, padY: 10, radius: 5 });
  });
});

describe("the hook's and captions' drop shadow", () => {
  const shadow: DropShadow = { colour: "#000000", opacity: 0.5, blur: 12, distance: 10, angle: 45 };

  test("falls its distance towards its angle, clockwise from the right, blurred by half its blur", () => {
    const drawn = drawnShadow(shadow)!;
    expect([drawn.x, drawn.y]).toEqual([expect.closeTo(7.071, 3), expect.closeTo(7.071, 3)]);
    expect([drawn.opacity, drawn.sigma]).toEqual([0.5, 6]);
    const down = drawnShadow({ ...shadow, angle: 90 })!;
    expect([down.x, down.y]).toEqual([expect.closeTo(0, 6), 10]);
    // A halo: blurred, not moved.
    expect(drawnShadow({ ...shadow, distance: 0 })).toEqual({ x: 0, y: 0, opacity: 0.5, sigma: 6 });
  });

  test("is off when transparent, or neither moved nor blurred", () => {
    expect(drawnShadow(NO_SHADOW)).toBeNull();
    expect(drawnShadow({ ...shadow, opacity: 0 })).toBeNull();
  });

  test("an override names some of the Preset's shadow's fields, and one equal to the Preset's is none", () => {
    const preset = { size: 90, shadow };
    expect(overridden(preset, { shadow: { blur: 0 }, size: 80 })).toEqual({ size: 80, shadow: { ...shadow, blur: 0 } });
    expect(overridden(preset, {})).toEqual(preset);
    expect(sameValue(shadow, { ...shadow })).toBe(true);
    expect(sameValue(shadow, { ...shadow, angle: 90 })).toBe(false);
    expect(sameValue(shadow, null)).toBe(false);
    expect(sameValue(4, 4)).toBe(true);
  });
});
