// .scratch/shapes/issues/05-resize-on-stage.md: a Shape's edge Grips set its Shape Style's width or
// height instead of stretching it, and a line's or an arrow's Grips are its two ends, as worked
// examples of a Shape and a pointer in and the Shape Style and Transform out.
import { describe, expect, test } from "vitest";
import type { Picture, Shape, ShapeEvent, Transform } from "../../../api";
import { IDENTITY } from "../editor/picture";
import { endDragged, placed, pointOnPicture, resized, type Grabbed } from "../editor/pictureGestures";
import { heldLayerEvent, layerStagePicture } from "../editor/layerStage";
import { gripsIn, heldPicture } from "../editor/stagePicture";
import { LINEAR } from "../editor/keyframes";
import type { AdvancedEdits } from "./edits";
import { picked } from "./pick";
import { newShapeStyle, resizeShape, sizedStyle } from "./shapeStyle";

const FRAME = { width: 1080, height: 1920 };

const transform = (changes: Partial<Transform> = {}): Transform => ({ ...IDENTITY, x: 540, y: 960, ...changes });
const grabbed = (changes: Partial<Transform>, fitted: { width: number; height: number }): Grabbed => ({ transform: transform(changes), fitted, frame: FRAME });

// A rectangle 400 × 200 with a 10 px stroke, from 0 s for 4 s.
const plate = (changes: Partial<Shape> = {}): Shape => ({
  id: "r",
  start: 0,
  secs: 4,
  transform: transform(),
  style: { ...newShapeStyle("rectangle"), width: 400, height: 200, stroke_width: 10 },
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
  keys: {},
  ...changes,
});

function edits(shapes: Shape[]): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes,
    music: [],
    source_volume: 1,
    segments: [{ id: "s1", start: 100, end: 110 }],
    overlays: [],
    transitions: [],
  };
}

const near = (point: { x: number; y: number }) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });

describe("a Shape's edge Grip", () => {
  test("sets its width, the opposite edge staying put, its scale as it was", () => {
    // The right edge (740, 960) dragged 100 px right: 500 wide, its left edge still at 340.
    const { transform: next, fitted } = resized(grabbed({}, { width: 400, height: 200 }), "right", { x: 740, y: 960 }, { x: 840, y: 970 });
    expect(fitted).toEqual({ width: 500, height: 200 });
    expect(next).toEqual(transform({ x: 590 }));
  });

  test("sets its height from the top, the bottom staying put", () => {
    const { transform: next, fitted } = resized(grabbed({}, { width: 400, height: 200 }), "top", { x: 540, y: 860 }, { x: 540, y: 800 });
    expect(fitted).toEqual({ width: 400, height: 260 });
    expect(next).toEqual(transform({ y: 930 }));
  });

  test("on a turned Shape, goes along its own axis", () => {
    // Turned a quarter clockwise, its own right edge is below its centre, at (540, 1160).
    const grab = grabbed({ rotation: 90 }, { width: 400, height: 200 });
    const { transform: next, fitted } = resized(grab, "right", { x: 540, y: 1160 }, { x: 600, y: 1260 });
    expect(fitted).toEqual({ width: 500, height: 200 });
    expect(near(next)).toEqual({ x: 540, y: 1010 });
    // Its own left edge, at (540, 760), where it was.
    const left = pointOnPicture(placed(next, fitted), -fitted.width / 2, 0);
    expect(near(left)).toEqual({ x: 540, y: 760 });
  });

  test("on a scaled Shape, sets its own pixels: the drag over its scale, whole", () => {
    const { transform: next, fitted } = resized(grabbed({ scale: 2 }, { width: 400, height: 200 }), "left", { x: 140, y: 960 }, { x: 39, y: 960 });
    expect(fitted).toEqual({ width: 451, height: 200 });
    expect(next).toEqual(transform({ scale: 2, x: 489 }));
  });

  test("keeps it between 2 and 4096 px", () => {
    const grab = grabbed({}, { width: 400, height: 200 });
    expect(resized(grab, "right", { x: 740, y: 960 }, { x: 100, y: 960 }).fitted.width).toBe(2);
    expect(resized(grab, "bottom", { x: 540, y: 1060 }, { x: 540, y: 9000 }).fitted.height).toBe(4096);
  });

  test("about its centre, moves the opposite edge as far the other way", () => {
    const { transform: next, fitted } = resized(grabbed({}, { width: 400, height: 200 }), "right", { x: 740, y: 960 }, { x: 790, y: 960 }, true);
    expect(fitted).toEqual({ width: 500, height: 200 });
    expect(next).toEqual(transform());
  });
});

describe("a line's or an arrow's end", () => {
  // An arrow 600 long and 12 thick, its head (its right end) at (840, 960), its tail at (240, 960).
  const arrow = grabbed({}, { width: 600, height: 48 });

  test("dragged by its head, leaves its tail where it was: the length, middle and turn follow", () => {
    const { transform: next, fitted } = endDragged(arrow, "right", { x: 840, y: 960 }, { x: 240, y: 360 }, {});
    expect(fitted).toEqual({ width: 600, height: 48 });
    expect(near(next)).toEqual({ x: 240, y: 660 });
    expect(next).toMatchObject({ rotation: -90, scale: 1 });
    const placedNow = placed(next, fitted);
    expect(near(pointOnPicture(placedNow, -300, 0))).toEqual({ x: 240, y: 960 });
    expect(near(pointOnPicture(placedNow, 300, 0))).toEqual({ x: 240, y: 360 });
  });

  test("dragged by its tail, leaves its head where it was", () => {
    const { transform: next, fitted } = endDragged(arrow, "left", { x: 240, y: 960 }, { x: 440, y: 760 }, {});
    expect(fitted.width).toBe(Math.round(Math.hypot(400, 200)));
    expect(next.rotation).toBeCloseTo((Math.atan2(200, 400) * 180) / Math.PI, 5);
    expect(near(pointOnPicture(placed(next, fitted), fitted.width / 2, 0))).toEqual({ x: 840, y: 960 });
  });

  test("on a scaled one, sets the length in its own pixels, its thickness as it was", () => {
    const scaled = grabbed({ scale: 2 }, { width: 300, height: 12 });
    const { transform: next, fitted } = endDragged(scaled, "right", { x: 840, y: 960 }, { x: 1040, y: 960 }, {});
    expect(fitted).toEqual({ width: 400, height: 12 });
    expect(next).toMatchObject({ x: 640, y: 960, rotation: 0, scale: 2 });
  });

  test("turns the short way round, snapping to a quarter turn as the rotate handle does", () => {
    // Turned 170°, its head at the left: dragged to just below its tail's straight left, a half turn.
    const turned = grabbed({ rotation: 170 }, { width: 600, height: 12 });
    const head = pointOnPicture(placed(turned.transform, turned.fitted), 300, 0);
    const tail = pointOnPicture(placed(turned.transform, turned.fitted), -300, 0);
    expect(endDragged(turned, "right", head, { x: tail.x - 600, y: tail.y + 20 }, {}).transform.rotation).toBe(180);
    // Just above it: past a half turn (185°), not back the long way (−175°), and not snapped.
    const past = 180 + (Math.atan2(50, 600) * 180) / Math.PI;
    expect(endDragged(turned, "right", head, { x: tail.x - 600, y: tail.y - 50 }, {}).transform.rotation).toBeCloseTo(past, 5);
    // With Alt, not snapped at all.
    expect(endDragged(turned, "right", head, { x: tail.x - 600, y: tail.y + 20 }, { alt: true }).transform.rotation).toBeCloseTo(180 - (Math.atan2(20, 600) * 180) / Math.PI, 5);
  });
});

describe("a Shape's Grips on the stage", () => {
  test("a line's are its two ends and the rotate handle", () => {
    expect(gripsIn("ends")).toEqual(["right", "left", "rotate"]);
    expect(gripsIn("all")).toContain("top");
  });

  test("while an edge is dragged, its last picture is stretched to the new size", () => {
    const area = { x: 340, y: 860, width: 400, height: 200 };
    const picture = { centre: [540, 960], width: 404, height: 204, rotation: 0, opacity: 1, bounds: area } as unknown as Picture;
    const event = { layer: plate(), start: 0, end: 4, area, image: "r.png", picture, bounds: area, picture_key: "k" } as ShapeEvent;
    const { picture: planned, fitted } = layerStagePicture(event);
    const shown = heldPicture(planned, transform({ x: 590 }), FRAME, { ...fitted, width: 500 });
    const held = heldLayerEvent(event, planned, shown);
    expect(held.image).toBe("r.png");
    expect(held.picture).toMatchObject({ centre: [590, 960], width: 505, height: 204 });
    expect(held.bounds).toEqual({ x: 340, y: 860, width: 500, height: 200 });
  });
});

describe("a Shape resized on the stage", () => {
  test("sets the width and height, leaving its scale and stroke as they were", () => {
    expect(sizedStyle(plate().style, { width: 500, height: 260 })).toEqual({ ...plate().style, width: 500, height: 260 });
  });

  test("a line's or an arrow's sets only its length: its height isn't its box's", () => {
    const line = { ...newShapeStyle("arrow"), height: 333 };
    expect(sizedStyle(line, { width: 800, height: 48 })).toEqual({ ...line, width: 800 });
  });

  test("is one change: its size and its Transform together", () => {
    const before = edits([plate()]);
    const put = transform({ x: 590 });
    const outcome = resizeShape({ edits: before, pick: picked({ kind: "shape", id: "r" }) }, "r", { width: 500, height: 200 }, put, 1);
    expect(outcome?.edits.shapes).toEqual([plate({ transform: put, style: { ...plate().style, width: 500 } })]);
    // Not on a locked Shape Track.
    expect(resizeShape({ edits: before, pick: null, locked: ["shape"] }, "r", { width: 500, height: 200 }, put, 1)).toBeNull();
  });

  test("keyed, writes its moved centre as a Keyframe at the playhead (auto-key)", () => {
    const keys = { x: [{ at: 0, value: 540, ease: LINEAR }, { at: 4, value: 540, ease: LINEAR }] };
    const before = edits([plate({ keys })]);
    const outcome = resizeShape({ edits: before, pick: null }, "r", { width: 500, height: 200 }, transform({ x: 590 }), 2, transform());
    const [after] = outcome!.edits.shapes;
    expect(after.style.width).toBe(500);
    expect(after.transform.x).toBe(540);
    expect(after.keys.x?.map((key) => [key.at, key.value])).toEqual([
      [0, 540],
      [2, 590],
      [4, 540],
    ]);
  });
});
