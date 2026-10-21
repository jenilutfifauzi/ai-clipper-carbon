// Seam H: a Picture of the plan as the preview draws it, and the fitted-size rule the inspector's
// Fit and Fill and a new Overlay go by (backend/app/pictures.py's, on the same worked examples).
import { describe, expect, test } from "vitest";
import keyed from "../../../../../backend/tests/fixtures/keyed_picture.json";
import type { Ease, Panel, Picture } from "../../../api";
import { coverScale, fillScale, fittedSize, identity, IDENTITY, overlayPlacement, panelStyle, pictureAt, pictureStyle, scaleForWidth, slotView } from "./picture";
import { PORTRAIT, type Canvas } from "./canvas";

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

describe("a Source deck's two videos", () => {
  test("show a Scene's panels, or a Manual Scene's Background and then its picture", () => {
    const panel: Panel = { area: { x: 0, y: 0, width: 1080, height: 1920 }, crop_width: 608, crop_height: 1080, path: [{ at: 0, x: 656, y: 0 }], blur: true };
    const scene = { start: 0, end: 3, layout: "blur" as const, panels: [panel, { ...panel, blur: false }], picture: null, colour: null, framing: null };
    expect([0, 1].map((slot) => slotView(scene, slot))).toEqual([
      { panel, picture: null, colour: null },
      { panel: { ...panel, blur: false }, picture: null, colour: null },
    ]);
    const manual = { ...scene, layout: "manual" as const, panels: [panel], picture: picture() };
    expect([0, 1].map((slot) => slotView(manual, slot))).toEqual([
      { panel, picture: null, colour: null },
      { panel: null, picture: picture(), colour: null },
    ]);
    expect(slotView({ ...manual, panels: [], colour: "#123456" }, 0)).toEqual({ panel: null, picture: null, colour: "#123456" });
  });
});

describe("a media Segment's Framing", () => {
  test("is filled once turned a quarter: a sideways phone video stands up to cover the frame", () => {
    // 1920x1080 fits as 1080x607.5; turned 90°, it is 607.5 wide and 1080 tall at scale 1.
    expect(fillScale(1920, 1080, 0, PORTRAIT)).toBeCloseTo(1920 / 607.5);
    expect(fillScale(1920, 1080, 90, PORTRAIT)).toBeCloseTo(1080 / 607.5);
    expect(fillScale(1920, 1080, -270, PORTRAIT)).toBeCloseTo(1080 / 607.5);
    expect(fillScale(1920, 1080, 180, PORTRAIT)).toBeCloseTo(1920 / 607.5);
  });
});

describe("the fitted size", () => {
  test("is the largest that fits the frame, and the cover scale fills it", () => {
    expect(fittedSize({ width: 1920, height: 1080 }, PORTRAIT)).toEqual({ width: 1080, height: 607.5 });
    expect(fittedSize({ width: 540, height: 1080 }, PORTRAIT)).toEqual({ width: 960, height: 1920 });
    expect(fittedSize({ width: 1080, height: 2400 }, PORTRAIT)).toEqual({ width: 864, height: 1920 });
    // In another frame.
    expect(fittedSize({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({ width: 100, height: 50 });
    expect(coverScale(1920, 1080, PORTRAIT)).toBeCloseTo(1920 / 607.5);
    expect(coverScale(540, 960, PORTRAIT)).toBeCloseTo(1);
  });

  test("gives the scale that draws a picture so many pixels wide", () => {
    expect(scaleForWidth(1920, 1080, 540, PORTRAIT)).toBe(0.5);
    expect(scaleForWidth(200, 100, 540, PORTRAIT)).toBe(0.5);
    expect(scaleForWidth(540, 1080, 540, PORTRAIT)).toBeCloseTo(540 / 960);
    // Kept within the Transform's range.
    expect(scaleForWidth(1920, 1080, 10, PORTRAIT)).toBe(0.05);
  });
});

describe("on a 16:9 Canvas", () => {
  // canvas.py's 16:9 Canvas, as its plan carries it.
  const LANDSCAPE: Canvas = { width: 1920, height: 1080, safe_area: { x: 96, y: 54, width: 1728, height: 972 } };

  test("a picture is fitted to it, and covers it at the cover scale", () => {
    // A 16:9 Source fills it at scale 1; a portrait phone video stands in its middle.
    expect(fittedSize({ width: 1920, height: 1080 }, LANDSCAPE)).toEqual({ width: 1920, height: 1080 });
    expect(coverScale(1920, 1080, LANDSCAPE)).toBeCloseTo(1);
    expect(fittedSize({ width: 1080, height: 1920 }, LANDSCAPE)).toEqual({ width: 607.5, height: 1080 });
    expect(coverScale(1080, 1920, LANDSCAPE)).toBeCloseTo(1920 / 607.5);
    // A square one is as tall as the frame, and covers it at its width over its height.
    expect(coverScale(1000, 1000, LANDSCAPE)).toBeCloseTo(1920 / 1080);
  });

  test("Fill turned a quarter covers it with the picture stood up", () => {
    // 1920x1080 turned 90° is 1080 wide and 1920 tall at scale 1: 1920 / 1080 covers the width.
    expect(fillScale(1920, 1080, 0, LANDSCAPE)).toBeCloseTo(1);
    expect(fillScale(1920, 1080, 90, LANDSCAPE)).toBeCloseTo(1920 / 1080);
  });

  test("the identity and a new Overlay take the same places as on 9:16", () => {
    expect(identity(LANDSCAPE)).toMatchObject({ x: 960, y: 540, scale: 1 });
    // Half the frame wide (960 px) and as far down as 760 of 1920.
    expect(overlayPlacement({ width: 1920, height: 1080 }, LANDSCAPE)).toEqual({ ...identity(LANDSCAPE), y: 428, scale: 0.5 });
    expect(overlayPlacement(undefined, LANDSCAPE)).toMatchObject({ x: 960, y: 428, scale: 0.5 });
    expect(scaleForWidth(1080, 1920, 960, LANDSCAPE)).toBeCloseTo(960 / 607.5);
  });

  test("a keyed centre is held to it, not to 9:16's frame", () => {
    const moving = { ...picture(), motion: { x: [{ at: 0, value: 1500, ease: [0, 0, 1, 1] as Ease }] } };
    expect(pictureAt(moving, 0, LANDSCAPE).centre[0]).toBe(1500);
    expect(pictureAt(moving, 0, PORTRAIT).centre[0]).toBe(1080);
  });
});

describe("a new Overlay's placement", () => {
  test("is 540 px wide in the frame's upper middle, which Reset puts it back to", () => {
    expect(overlayPlacement({ width: 1920, height: 1080 }, PORTRAIT)).toEqual({ ...IDENTITY, y: 760, scale: 0.5 });
    expect(overlayPlacement({ width: 540, height: 1080 }, PORTRAIT)).toEqual({ ...IDENTITY, y: 760, scale: 0.5625 });
    expect(overlayPlacement({ width: 1000, height: 3000 }, PORTRAIT).scale).toBe(Number((540 / 640).toFixed(4)));
  });

  test("is half the frame's scale while its item's size isn't known", () => {
    expect(overlayPlacement(undefined, PORTRAIT)).toEqual({ ...IDENTITY, y: 760, scale: 0.5 });
  });
});

// The keyed picture of backend/tests/fixtures/keyed_picture.json, sampled by the backend's
// picture_at, which the renderer draws by (and which its tests check against rendered frames).
describe("a keyed Picture at a time", () => {
  const planned = keyed.picture as Picture;

  for (const at of keyed.at) {
    test(`is where the renderer draws it at ${at.time} s`, () => {
      const drawn = pictureAt(planned, at.time, PORTRAIT);
      for (const [mine, theirs] of [
        [drawn.centre[0], at.centre[0]],
        [drawn.centre[1], at.centre[1]],
        [drawn.width, at.width],
        [drawn.height, at.height],
        [drawn.rotation, at.rotation],
        [drawn.opacity, at.opacity],
        [drawn.radius, at.radius],
      ])
        expect(Math.abs(mine - theirs)).toBeLessThan(1e-6);
      expect(drawn.bounds).toEqual(at.bounds);
      expect(drawn.motion).toEqual({});
    });
  }

  test("is itself, unkeyed", () => {
    const still = picture();
    expect(pictureAt(still, 1, PORTRAIT)).toBe(still);
  });

  test("is drawn as CSS from its sampled values", () => {
    const style = pictureStyle(pictureAt(planned, 1.7, PORTRAIT), FRAME);
    const at = keyed.at.find((sample) => sample.time === 1.7)!;
    expect(parseFloat(style.width)).toBeCloseTo((at.width / 1080) * 100, 9);
    expect(style.transform).toBe(`translate(-50%, -50%) rotate(${at.rotation}deg) scale(-1, 1)`);
  });
});
