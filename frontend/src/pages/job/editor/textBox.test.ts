// .scratch/text-advanced/issues/03-wrap-width-and-fixed-height.md: a picked Text Layer's side Grips
// set its wrap width and its top and bottom Grips its fixed height, about its middle (where the
// planner centres its box) and along its own axes, each drag one change.
import { describe, expect, test } from "vitest";
import { textStyle } from "../advanced/textStyle";
import { boxDragged, boxGrab, boxStyle } from "./textBox";

// A 400x120 box centred at (540, 960), unscaled and unturned.
const BOX = { x: 540, y: 960, width: 400, height: 120, rotation: 0 };

describe("a Text Layer's box Grips", () => {
  test("a side grows or shrinks the box by as much on the other side, about its middle", () => {
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 790, y: 1000 }, 1)).toEqual({ ...BOX, width: 500 });
    expect(boxDragged(BOX, "left", { x: 340, y: 960 }, { x: 390, y: 960 }, 1)).toEqual({ ...BOX, width: 300 });
    expect(boxDragged(BOX, "bottom", { x: 540, y: 1020 }, { x: 600, y: 1100 }, 1)).toEqual({ ...BOX, height: 280 });
    expect(boxDragged(BOX, "top", { x: 540, y: 900 }, { x: 540, y: 880 }, 1)).toEqual({ ...BOX, height: 160 });
    // Never narrower than a few pixels, and in whole pixels.
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 100, y: 960 }, 1).width).toBe(8);
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 740.3, y: 960 }, 1).width).toBe(401);
  });

  test("on a turned and scaled layer, along its own axes and in its own pixels", () => {
    // Turned a quarter, twice as large: its right edge points down the frame.
    const turned = { ...BOX, width: 800, height: 240, rotation: 90 };
    const wider = boxDragged(turned, "right", { x: 540, y: 1360 }, { x: 560, y: 1460 }, 2);
    expect(wider).toEqual({ ...turned, width: 1000 });
    const grab = boxGrab(turned, "right", { x: 540, y: 1360 }, 2);
    grab.move({ x: 560, y: 1460 });
    expect(grab.end()).toBe(500);
  });

  test("the sides set the wrap width and the top and bottom the fixed height, the rest of the style kept", () => {
    const style = textStyle({ size: 60, plate: { shape: "block" } });
    expect(boxStyle(style, "left", 500)).toEqual({ ...style, wrap_width: 500 });
    expect(boxStyle(style, "bottom", 300)).toEqual({ ...style, fixed_height: 300 });
  });

  test("a drag is drawn as it goes and makes one change when let go, none when it ends where it began", () => {
    const grab = boxGrab(BOX, "right", { x: 740, y: 960 }, 1);
    expect(grab.move({ x: 760, y: 960 }).width).toBe(440);
    expect(grab.move({ x: 800, y: 960 }).width).toBe(520);
    expect(grab.end()).toBe(520);
    const back = boxGrab(BOX, "top", { x: 540, y: 900 }, 1);
    back.move({ x: 540, y: 850 });
    back.move({ x: 540, y: 900 });
    expect(back.end()).toBeNull();
    expect(boxGrab(BOX, "left", { x: 340, y: 960 }, 1).end()).toBeNull();
  });
});
