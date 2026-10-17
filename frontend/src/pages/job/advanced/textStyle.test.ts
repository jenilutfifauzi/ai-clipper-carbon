// A Text Layer's Text Style (.scratch/text-advanced/issues/01-text-style-and-transform-shape.md): a
// size change taking the plate along, as the planner did. The looks new Text Layers start from are
// Text Presets (backend/assets/text-presets, tests/test_text_presets.py).
import { describe, expect, test } from "vitest";
import { atSize, styled, textStyle } from "./textStyle";

describe("a Text Style", () => {
  test("a new size grows or shrinks the plate's padding and corners with the words; another field changes alone", () => {
    const style = textStyle({ size: 80, plate: { shape: "block" } });
    expect(atSize(style, 120).plate).toEqual({ ...style.plate, radius: 30, padding_x: 42, padding_y: 26.4 });
    expect(atSize(style, 80)).toBe(style);
    expect(styled(style, "size", 40)).toEqual(atSize(style, 40));
    expect(styled(style, "colour", "#FF0000")).toEqual({ ...style, colour: "#FF0000" });
  });
});
