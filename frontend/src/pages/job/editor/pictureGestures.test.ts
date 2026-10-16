// Seam H (.scratch/transform-crop/spec.md): what the Grips do to a picture's Transform, as worked
// examples of a Transform and a pointer in and the Transform out.
import { describe, expect, test } from "vitest";
import {
  boundsOf,
  cornersOf,
  dragged,
  fittedSize,
  gripsOf,
  moved,
  pinched,
  placed,
  rotated,
  scaled,
  snapRotation,
  stretched,
  type Grabbed,
  type PictureTransform,
  type Point,
} from "./pictureGestures";

const FRAME = { width: 1080, height: 1920 };

function transform(changes: Partial<PictureTransform> = {}): PictureTransform {
  return { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1, ...changes };
}

// A 16:9 picture (1080×607.5 fitted), grabbed with `changes` to its Transform.
const grabbed = (changes: Partial<PictureTransform> = {}): Grabbed => ({
  transform: transform(changes),
  fitted: { width: 1080, height: 607.5 },
  frame: FRAME,
});

// A point `reach` px from (540, 960) at `degrees` clockwise from straight up.
const around = (degrees: number, reach = 300, centre: Point = { x: 540, y: 960 }): Point => ({
  x: centre.x + reach * Math.sin((degrees * Math.PI) / 180),
  y: centre.y - reach * Math.cos((degrees * Math.PI) / 180),
});

// Rounded to a thousandth, so cos 90° is 0.
const tidy = <T extends object>(value: T): T =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 + 0 : v)));

describe("the picture's size and box", () => {
  test("the fitted size is the largest that fits the frame keeping the aspect", () => {
    expect(fittedSize({ width: 1920, height: 1080 }, FRAME)).toEqual({ width: 1080, height: 607.5 });
    expect(fittedSize({ width: 1080, height: 2400 }, FRAME)).toEqual({ width: 864, height: 1920 });
  });

  test("it is drawn at the fitted size times its scale and stretch", () => {
    const fitted = { width: 1080, height: 607.5 };
    expect(placed(transform({ scale: 0.5 }), fitted)).toEqual({ x: 540, y: 960, width: 540, height: 303.75, rotation: 0 });
    expect(placed(transform({ scale: 0.5, stretch_x: 2 }), fitted)).toMatchObject({ width: 1080, height: 303.75 });
  });

  test("a 100×200 picture at 90° has 200×100 bounds about the same centre", () => {
    const picture = { x: 540, y: 960, width: 100, height: 200, rotation: 90 };
    expect(tidy(boundsOf(picture))).toEqual({ x: 440, y: 910, width: 200, height: 100 });
    // At 45° a 100×100 square's bounds are its diagonal across.
    const square = boundsOf({ ...picture, height: 100, rotation: 45 });
    expect(square.width).toBeCloseTo(100 * Math.SQRT2);
    expect(square.height).toBeCloseTo(100 * Math.SQRT2);
  });

  test("its corners turn with it, clockwise, its own top-left first", () => {
    const picture = { x: 540, y: 960, width: 200, height: 100, rotation: 0 };
    expect(cornersOf(picture)).toEqual([
      { x: 440, y: 910 },
      { x: 640, y: 910 },
      { x: 640, y: 1010 },
      { x: 440, y: 1010 },
    ]);
    // Turned a quarter clockwise, its top-left is at the top right.
    expect(tidy(cornersOf({ ...picture, rotation: 90 }))[0]).toEqual({ x: 590, y: 860 });
  });

  test("the Grips sit on the rotated box, the rotate handle above its own top edge", () => {
    const picture = { x: 540, y: 960, width: 200, height: 100, rotation: 0 };
    expect(gripsOf(picture, 40)).toEqual({
      "top-left": { x: 440, y: 910 },
      top: { x: 540, y: 910 },
      "top-right": { x: 640, y: 910 },
      right: { x: 640, y: 960 },
      "bottom-right": { x: 640, y: 1010 },
      bottom: { x: 540, y: 1010 },
      "bottom-left": { x: 440, y: 1010 },
      left: { x: 440, y: 960 },
      rotate: { x: 540, y: 870 },
    });
    // Turned a quarter clockwise, its top faces right: so does the rotate handle.
    const turned = tidy(gripsOf({ ...picture, rotation: 90 }, 40));
    expect(turned["top-left"]).toEqual({ x: 590, y: 860 });
    expect(turned.right).toEqual({ x: 540, y: 1060 });
    expect(turned.rotate).toEqual({ x: 630, y: 960 });
  });
});

describe("moving", () => {
  test("by (100, 0) from (540, 960) gives (640, 960)", () => {
    expect(moved(grabbed(), { x: 300, y: 300 }, { x: 400, y: 300 })).toEqual(transform({ x: 640 }));
  });

  test("the centre is clamped at the frame's edge, the picture is not", () => {
    expect(moved(grabbed({ x: 1000, y: 100 }), { x: 0, y: 0 }, { x: 200, y: -300 })).toMatchObject({ x: 1080, y: 0 });
    expect(moved(grabbed(), { x: 0, y: 0 }, { x: -900, y: 1200 })).toMatchObject({ x: 0, y: 1920 });
  });
});

describe("a corner scales about the centre", () => {
  test("the pointer going from 200 px to 400 px from the centre doubles the scale, keeping the stretch", () => {
    const grab = grabbed({ scale: 0.5, stretch_x: 1.5 });
    const next = scaled(grab, { x: 540 + 120, y: 960 + 160 }, { x: 540 + 240, y: 960 + 320 });
    expect(next).toEqual(transform({ scale: 1, stretch_x: 1.5 }));
  });

  test("the scale is clamped at 0.05 and 8", () => {
    expect(scaled(grabbed({ scale: 6 }), { x: 740, y: 960 }, { x: 940, y: 960 }).scale).toBe(8);
    expect(scaled(grabbed({ scale: 0.1 }), { x: 740, y: 960 }, { x: 590, y: 960 }).scale).toBe(0.05);
  });
});

describe("an edge stretches on the picture's own axis, about the centre", () => {
  test("on a picture rotated 90°, dragging the right edge's Grip downward stretches it across", () => {
    // Its own right faces down: its right Grip is below the centre.
    const grab = grabbed({ rotation: 90 });
    const next = stretched(grab, "right", { x: 540, y: 960 + 300 }, { x: 540, y: 960 + 600 });
    expect(next).toEqual(transform({ rotation: 90, stretch_x: 2 }));
    // Sideways is along its height: the stretch stays.
    expect(stretched(grab, "right", { x: 540, y: 1260 }, { x: 840, y: 1260 }).stretch_x).toBeCloseTo(1);
  });

  test("the top and bottom stretch it down", () => {
    const next = stretched(grabbed({ stretch_y: 2 }), "top", { x: 540, y: 660 }, { x: 600, y: 810 });
    expect(next).toEqual(transform({ stretch_y: 1 }));
  });

  test("the stretch is clamped at 0.1 and 10", () => {
    expect(stretched(grabbed(), "left", { x: 240, y: 960 }, { x: -6000, y: 960 }).stretch_x).toBe(10);
    expect(stretched(grabbed(), "left", { x: 240, y: 960 }, { x: 537, y: 960 }).stretch_x).toBe(0.1);
  });
});

describe("the handle above rotates it", () => {
  const turned = (to: number, changes: Partial<PictureTransform> = {}, keys = {}) =>
    rotated(grabbed(changes), around(0), around(to), keys).rotation;

  test("by the pointer's angle about the centre from where it was grabbed", () => {
    expect(turned(10, { rotation: 45 })).toBeCloseTo(55);
    expect(turned(-40)).toBeCloseTo(-40);
    // Grabbed off to one side, it is the angle turned that counts, not where it points.
    expect(rotated(grabbed(), around(90), around(130), {}).rotation).toBeCloseTo(40);
  });

  test("it snaps to 0, 90, 180 and 270 within 3°", () => {
    expect(turned(2)).toBe(0);
    expect(turned(-2.5)).toBe(0);
    expect(turned(88)).toBe(90);
    expect(turned(-2, { rotation: 180 })).toBe(180);
    expect(turned(88, { rotation: 180 })).toBe(270);
    expect(turned(5)).toBeCloseTo(5);
  });

  test("with Shift it turns in 15° steps", () => {
    expect(turned(22, {}, { shift: true })).toBe(15);
    expect(turned(23, {}, { shift: true })).toBe(30);
  });

  test("with Alt it doesn't snap", () => {
    expect(turned(2, {}, { alt: true })).toBeCloseTo(2);
    expect(turned(88, {}, { alt: true })).toBeCloseTo(88);
  });

  test("a turn past half way goes on round, kept within one turn either way", () => {
    expect(turned(-20, { rotation: 350 })).toBeCloseTo(330);
    expect(turned(20, { rotation: 350 })).toBeCloseTo(10);
    expect(turned(-20, { rotation: -350 })).toBeCloseTo(-10);
  });

  test("the snap alone", () => {
    expect(snapRotation(-91.5, {})).toBe(-90);
    expect(snapRotation(357.5, {})).toBe(360);
    expect(snapRotation(-8, { shift: true })).toBe(-15);
  });
});

describe("a Grip dragged", () => {
  test("is the gesture its place stands for", () => {
    const grab = grabbed();
    const [from, to] = [{ x: 840, y: 960 }, { x: 1140, y: 960 }];
    expect(dragged(grab, "body", from, to, {})).toEqual(moved(grab, from, to));
    expect(dragged(grab, "top-right", from, to, {})).toEqual(scaled(grab, from, to));
    expect(dragged(grab, "right", from, to, {})).toEqual(stretched(grab, "right", from, to));
    expect(dragged(grab, "rotate", from, to, { shift: true })).toEqual(rotated(grab, from, to, { shift: true }));
  });
});

describe("two fingers pinch and twist it", () => {
  test("moving apart to twice the distance and turning 30° give twice the scale and +30°", () => {
    const from: [Point, Point] = [around(-90, 100), around(90, 100)];
    const to: [Point, Point] = [around(-60, 200), around(120, 200)];
    expect(tidy(pinched(grabbed({ scale: 0.5 }), from, to, {}))).toEqual(transform({ scale: 1, rotation: 30 }));
  });

  test("a twist near 90° snaps, and with Shift it turns in 15° steps", () => {
    const from: [Point, Point] = [around(-90, 100), around(90, 100)];
    expect(pinched(grabbed(), from, [around(-2, 100), around(178, 100)], {}).rotation).toBe(90);
    expect(pinched(grabbed(), from, [around(-50, 100), around(130, 100)], { shift: true }).rotation).toBe(45);
  });

  test("the picture moves with the fingers' middle, and its scale is clamped", () => {
    const from: [Point, Point] = [{ x: 500, y: 900 }, { x: 600, y: 900 }];
    const to: [Point, Point] = [{ x: 900, y: 1000 }, { x: 1900, y: 1000 }];
    expect(tidy(pinched(grabbed({ scale: 2 }), from, to, {}))).toEqual(transform({ x: 1080, y: 1060, scale: 8 }));
  });
});
