// Seam H: a Picture of the plan as the preview draws it, and the fitted-size rule the inspector's
// Fit and Fill and a new Overlay go by (backend/app/pictures.py's, on the same worked examples).
import { describe, expect, test } from "vitest";
import type { Picture } from "../../../api";
import { coverScale, fittedSize, pictureStyle, scaleForWidth } from "./picture";

const FRAME = { width: 1080, height: 1920 };

const picture = (fields: Partial<Picture> = {}): Picture => ({
  crop: { x: 0, y: 0, width: 640, height: 360 },
  width: 540,
  height: 304,
  centre: [270, 480],
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: { x: 0, y: 328, width: 540, height: 304 },
  ...fields,
});

describe("a Picture as CSS", () => {
  test("is a box of its drawn size centred on its centre, in shares of the frame", () => {
    expect(pictureStyle(picture(), FRAME)).toEqual({
      left: "25%",
      top: "25%",
      width: "50%",
      height: `${(304 / 1920) * 100}%`,
      transform: "translate(-50%, -50%)",
      opacity: 1,
    });
  });

  test("is turned clockwise about its centre after it is flipped, and faded", () => {
    expect(pictureStyle(picture({ rotation: 90, opacity: 0.5 }), FRAME)).toMatchObject({ transform: "translate(-50%, -50%) rotate(90deg)", opacity: 0.5 });
    expect(pictureStyle(picture({ flip_h: true }), FRAME).transform).toBe("translate(-50%, -50%) scale(-1, 1)");
    expect(pictureStyle(picture({ rotation: -30, flip_h: true, flip_v: true }), FRAME).transform).toBe("translate(-50%, -50%) rotate(-30deg) scale(-1, -1)");
  });

  test("may go past the frame's edges", () => {
    expect(pictureStyle(picture({ centre: [1080, 0], width: 2160, height: 1216 }), FRAME)).toMatchObject({ left: "100%", top: "0%", width: "200%" });
  });
});

describe("the fitted size", () => {
  test("is the largest that fits the frame, and the cover scale fills it", () => {
    expect(fittedSize(1920, 1080)).toEqual({ width: 1080, height: 607.5 });
    expect(fittedSize(540, 1080)).toEqual({ width: 960, height: 1920 });
    expect(coverScale(1920, 1080)).toBeCloseTo(1920 / 607.5);
    expect(coverScale(540, 960)).toBeCloseTo(1);
  });

  test("gives the scale that draws a picture so many pixels wide", () => {
    expect(scaleForWidth(1920, 1080, 540)).toBe(0.5);
    expect(scaleForWidth(200, 100, 540)).toBe(0.5);
    expect(scaleForWidth(540, 1080, 540)).toBeCloseTo(540 / 960);
    // Kept within the Transform's range.
    expect(scaleForWidth(1920, 1080, 10)).toBe(0.05);
  });
});
