// .scratch/text-advanced/issues/03-wrap-width-and-fixed-height.md: a picked Text Layer's side Grips
// set its wrap width and its top and bottom Grips its fixed height, about its middle (where the
// planner centres its box), each drag one change.
import { describe, expect, test } from "vitest";
import { textStyle } from "../advanced/textStyle";
import { boxDragged, boxGrab, boxStyle, edgeMiddle } from "./textBox";

const BOX = { x: 340, y: 900, width: 400, height: 120 };

describe("a Text Layer's box Grips", () => {
  test("a side grows or shrinks the box by as much on the other side, about its middle", () => {
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 790, y: 1000 })).toEqual({ ...BOX, x: 290, width: 500 });
    expect(boxDragged(BOX, "left", { x: 340, y: 960 }, { x: 390, y: 960 })).toEqual({ ...BOX, x: 390, width: 300 });
    expect(boxDragged(BOX, "bottom", { x: 540, y: 1020 }, { x: 600, y: 1100 })).toEqual({ ...BOX, y: 820, height: 280 });
    expect(boxDragged(BOX, "top", { x: 540, y: 900 }, { x: 540, y: 880 })).toEqual({ ...BOX, y: 880, height: 160 });
    // Never narrower than a few pixels, and in whole pixels.
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 100, y: 960 }).width).toBe(8);
    expect(boxDragged(BOX, "right", { x: 740, y: 960 }, { x: 740.3, y: 960 }).width).toBe(401);
  });

  test("the sides set the wrap width and the top and bottom the fixed height, the rest of the style kept", () => {
    const style = textStyle({ size: 60, plate: { shape: "block" } });
    expect(boxStyle(style, "left", { ...BOX, width: 500 })).toEqual({ ...style, wrap_width: 500 });
    expect(boxStyle(style, "bottom", { ...BOX, height: 300 })).toEqual({ ...style, fixed_height: 300 });
  });

  test("a drag is drawn as it goes and makes one change when let go, none when it ends where it began", () => {
    const grab = boxGrab(BOX, "right", edgeMiddle(BOX, "right"));
    expect(grab.move({ x: 760, y: 960 }).width).toBe(440);
    expect(grab.move({ x: 800, y: 960 }).width).toBe(520);
    expect(grab.end()).toEqual({ ...BOX, x: 280, width: 520 });
    const back = boxGrab(BOX, "top", edgeMiddle(BOX, "top"));
    back.move({ x: 540, y: 850 });
    back.move({ x: 540, y: 900 });
    expect(back.end()).toBeNull();
    expect(boxGrab(BOX, "left", edgeMiddle(BOX, "left")).end()).toBeNull();
  });

  test("each Grip is in the middle of its edge", () => {
    expect(edgeMiddle(BOX, "top")).toEqual({ x: 540, y: 900 });
    expect(edgeMiddle(BOX, "right")).toEqual({ x: 740, y: 960 });
    expect(edgeMiddle(BOX, "bottom")).toEqual({ x: 540, y: 1020 });
    expect(edgeMiddle(BOX, "left")).toEqual({ x: 340, y: 960 });
  });
});
