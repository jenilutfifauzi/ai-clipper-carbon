// Seam H: a Picture of the plan as the preview draws it, and the fitted-size rule the inspector's
// Fit and Fill and a new Overlay go by (backend/app/pictures.py's, on the same worked examples).
import { describe, expect, test } from "vitest";
import type { Panel, Picture } from "../../../api";
import { coverScale, fillScale, fittedSize, panelStyle, pictureStyle, scaleForWidth } from "./picture";

const FRAME = { width: 1080, height: 1920 };

const picture = (fields: Partial<Picture> = {}): Picture => ({
  crop: { x: 0, y: 0, width: 640, height: 360 },
  item_size: [640, 360],
  width: 540,
  height: 304,
  centre: [270, 480],
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: { x: 0, y: 328, width: 540, height: 304 },
  radius: 0,
  border: null,
  shadow: null,
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
      inner: { left: "0%", top: "0%", width: "100%", height: "100%" },
    });
  });

  test("shows only its crop: its whole item sized and moved inside the box so that the crop fills it", () => {
    // A 1000x1000 item with its left quarter and its bottom half cut off keeps 750x500 from (250, 0).
    const cropped = picture({ crop: { x: 250, y: 0, width: 750, height: 500 }, item_size: [1000, 1000] });
    expect(pictureStyle(cropped, FRAME).inner).toEqual({
      left: `${(-250 / 750) * 100}%`,
      top: "0%",
      width: `${(1000 / 750) * 100}%`,
      height: "200%",
    });
    // The middle of it, from (100, 300): the item moved up and left by its share of the crop.
    expect(pictureStyle(picture({ crop: { x: 100, y: 300, width: 400, height: 200 }, item_size: [800, 800] }), FRAME).inner).toEqual({
      left: "-25%",
      top: "-150%",
      width: "200%",
      height: "400%",
    });
  });

  test("is turned clockwise about its centre after it is flipped, and faded", () => {
    expect(pictureStyle(picture({ rotation: 90, opacity: 0.5 }), FRAME)).toMatchObject({ transform: "translate(-50%, -50%) rotate(90deg)", opacity: 0.5 });
    expect(pictureStyle(picture({ flip_h: true }), FRAME).transform).toBe("translate(-50%, -50%) scale(-1, 1)");
    expect(pictureStyle(picture({ rotation: -30, flip_h: true, flip_v: true }), FRAME).transform).toBe("translate(-50%, -50%) rotate(-30deg) scale(-1, -1)");
  });

  test("rounds its corners in shares of its own size, and keeps its border and shadow in output pixels on the stage", () => {
    // 76 px is a seventh of its 540 px width and a quarter of its 304 px height.
    expect(pictureStyle(picture({ radius: 76 }), FRAME).radius).toBe(`${(76 / 540) * 100}% / 25%`);
    expect(pictureStyle(picture({ radius: 152 }), FRAME).radius).toBe(`${(152 / 540) * 100}% / 50%`);
    // `--scale` is the stage's pixels per output pixel.
    const decorated = pictureStyle(picture({ border: { width: 10, colour: "#FF0000" }, shadow: { blur: 30, x: 20, y: -8, colour: "#000000", opacity: 0.6 } }), FRAME);
    expect(decorated.border).toBe("calc(10px * var(--scale)) solid #FF0000");
    expect(decorated.shadow).toBe(
      "drop-shadow(calc(20px * var(--scale)) calc(-8px * var(--scale)) calc(30px * var(--scale)) rgb(0 0 0 / 0.6))",
    );
    expect(pictureStyle(picture(), FRAME)).toMatchObject({ radius: undefined, border: undefined, shadow: undefined });
  });

  test("may go past the frame's edges", () => {
    expect(pictureStyle(picture({ centre: [1080, 0], width: 2160, height: 1216 }), FRAME)).toMatchObject({ left: "100%", top: "0%", width: "200%" });
  });
});

describe("a Background panel as CSS", () => {
  test("is its area, with its item sized and moved inside it so that its crop fills it", () => {
    // The blurred cover of a 1280x720 video: its middle 404x720 from (438, 0), filling the frame.
    const panel: Panel = { area: { x: 0, y: 0, width: 1080, height: 1920 }, crop_width: 404, crop_height: 720, path: [{ at: 0, x: 438, y: 0 }], blur: true };
    expect(panelStyle(panel, [1280, 720], FRAME)).toEqual({
      box: { left: "0%", top: "0%", width: "100%", height: "100%" },
      inner: { left: `${(-438 / 404) * 100}%`, top: "0%", width: `${(1280 / 404) * 100}%`, height: "100%" },
    });
  });
});

describe("a media Segment's Framing", () => {
  test("is filled once turned a quarter: a sideways phone video stands up to cover the frame", () => {
    // 1920x1080 fits as 1080x607.5; turned 90°, it is 607.5 wide and 1080 tall at scale 1.
    expect(fillScale(1920, 1080, 0)).toBeCloseTo(1920 / 607.5);
    expect(fillScale(1920, 1080, 90)).toBeCloseTo(1080 / 607.5);
    expect(fillScale(1920, 1080, -270)).toBeCloseTo(1080 / 607.5);
    expect(fillScale(1920, 1080, 180)).toBeCloseTo(1920 / 607.5);
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
