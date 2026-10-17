// A Text Layer's Text Style (.scratch/text-advanced/issues/01-text-style-and-transform-shape.md): the
// looks new Text Layers start from, and a size change taking the plate along, as the planner did.
import { describe, expect, test } from "vitest";
import { TEXT_PRESETS } from "./TextLayers";
import { atSize, styled, textStyle } from "./textStyle";

describe("a Text Style", () => {
  test("the four looks are today's: their boxes padded and rounded as the planner did at their sizes", () => {
    const looks = Object.fromEntries(TEXT_PRESETS.map(({ name, layer }) => [name, layer]));
    expect(Object.keys(looks)).toEqual(["Text", "Title", "Label", "Subtitle"]);
    expect(looks.Label.style.plate).toEqual({ shape: "block", colour: "#FFFFFF", opacity: 1, radius: 16, padding_x: 22.4, padding_y: 14.08 });
    expect(looks.Subtitle.style.plate).toEqual({ shape: "block", colour: "#000000", opacity: 0.6, radius: 14, padding_x: 19.6, padding_y: 12.32 });
    expect(looks.Title.style).toMatchObject({ font: "anton", size: 130, colour: "#FFE600", stroke_width: 6 });
    expect([looks.Title.transform.y, looks.Subtitle.transform.y, looks.Text.transform.y]).toEqual([700, 1400, 960]);
    // Nothing a Text Layer can't have yet.
    for (const { layer } of TEXT_PRESETS) {
      expect(layer.style).toMatchObject({ tracking: 0, wrap_width: 0, fixed_height: 0, line_height: 1.1 });
      expect(layer.transform).toMatchObject({ scale: 1, rotation: 0, opacity: 1, stretch_x: 1, stretch_y: 1, flip_h: false, flip_v: false });
    }
  });

  test("a new size grows or shrinks the plate's padding and corners with the words; another field changes alone", () => {
    const style = textStyle({ size: 80, plate: { shape: "block" } });
    expect(atSize(style, 120).plate).toEqual({ ...style.plate, radius: 30, padding_x: 42, padding_y: 26.4 });
    expect(atSize(style, 80)).toBe(style);
    expect(styled(style, "size", 40)).toEqual(atSize(style, 40));
    expect(styled(style, "colour", "#FF0000")).toEqual({ ...style, colour: "#FF0000" });
  });
});
