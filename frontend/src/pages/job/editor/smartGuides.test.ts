// Seam H (.scratch/transform-crop/spec.md): the Smart Guides a dragged picture snaps to, as worked
// examples of the pictures at the playhead and a Transform in, and the Transform and lines out.
import { describe, expect, test } from "vitest";
import type { OverlayEvent, Picture, RenderPlan, ScenePlan, Transform } from "../../../api";
import { guideTargets, picturesAt, snapMoved, snapScaled } from "./smartGuides";

const FRAME = { width: 1080, height: 1920 };
// A stage 540 CSS px wide: a CSS pixel is 2 frame pixels, and 6 of them, 12.
const UNIT = 2;
// A 200×100 picture (at scale 1, before stretch).
const FITTED = { width: 200, height: 100 };

function transform(changes: Partial<Transform> = {}): Transform {
  return { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1, ...changes };
}

// Another Overlay at the playhead, 100..400 across and 200..400 down; and the picture dragged.
const others = [
  { id: "overlay:o2", bounds: { x: 100, y: 200, width: 300, height: 200 } },
  { id: "overlay:o1", bounds: { x: 700, y: 1300, width: 200, height: 100 } },
];
const targets = guideTargets(FRAME, others, "overlay:o1");

describe("the targets", () => {
  test("are the frame's edges and centre, the fixed guides, and the other pictures' edges and centres", () => {
    expect(targets).toEqual({
      x: [0, 100, 250, 400, 540, 950, 1080],
      y: [0, 200, 232, 300, 400, 960, 1536, 1920],
    });
  });

  test("the picture being dragged is not its own target", () => {
    expect(guideTargets(FRAME, others, "overlay:o2")).toEqual({
      x: [0, 540, 700, 800, 900, 950, 1080],
      y: [0, 232, 960, 1300, 1350, 1400, 1536, 1920],
    });
  });
});

describe("moving snaps the picture's edges and centre", () => {
  // Its edges and centre at y 1450, 1500 and 1550 are clear of every guide down.
  const at = (x: number, changes: Partial<Transform> = {}) => transform({ x, y: 1500, ...changes });

  test("a left edge 4 CSS px from another picture's right edge snaps to it, and the line is reported", () => {
    // Its left edge at 408: 8 frame pixels from 400.
    expect(snapMoved(at(508), FITTED, targets, { unit: UNIT })).toEqual({ transform: at(500), guides: { x: [400], y: [] } });
  });

  test("at 10 CSS px there is no snap", () => {
    expect(snapMoved(at(520), FITTED, targets, { unit: UNIT })).toEqual({ transform: at(520), guides: { x: [], y: [] } });
  });

  test("with Alt there is no snap", () => {
    expect(snapMoved(at(508), FITTED, targets, { unit: UNIT, alt: true })).toEqual({ transform: at(508), guides: { x: [], y: [] } });
  });

  test("a rotated picture snaps by its bounds", () => {
    // Turned 90°, it is 100 across: at 458 its bounds' left edge is at 408.
    const turned = snapMoved(at(458, { rotation: 90 }), FITTED, targets, { unit: UNIT });
    expect(turned.transform.x).toBeCloseTo(450);
    expect(turned.guides).toEqual({ x: [400], y: [] });
    // Unturned, its left edge is at 358, and nothing is near.
    expect(snapMoved(at(458), FITTED, targets, { unit: UNIT }).transform).toEqual(at(458));
  });

  test("the nearest target wins, and both axes snap at once", () => {
    // 400 px wide at 747, its left edge is 7 px past the frame's middle and its right edge 3 px
    // short of the fixed guide at 950; its top is 4 px below the safe area's top.
    const wide = { width: 400, height: 100 };
    const next = snapMoved(transform({ x: 747, y: 286 }), wide, targets, { unit: UNIT });
    expect(next).toEqual({ transform: transform({ x: 750, y: 282 }), guides: { x: [950], y: [232] } });
  });

  test("the frame's centre and edges are targets", () => {
    expect(snapMoved(at(545), FITTED, targets, { unit: UNIT }).guides.x).toEqual([540]);
    expect(snapMoved(at(110), FITTED, targets, { unit: UNIT })).toMatchObject({ transform: at(100), guides: { x: [0, 100] } });
  });

  test("a picture already on a target shows its line", () => {
    expect(snapMoved(at(500), FITTED, targets, { unit: UNIT })).toEqual({ transform: at(500), guides: { x: [400], y: [] } });
  });

  test("a line marks each target met at once", () => {
    // As wide as the other picture, its edges and centre meet the other's all at once.
    const narrow = { width: 300, height: 100 };
    expect(snapMoved(at(254), narrow, targets, { unit: UNIT }).guides.x).toEqual([100, 250, 400]);
  });
});

describe("a corner scale snaps the moving edges", () => {
  // Another picture 650..850 across at the playhead.
  const near = guideTargets(FRAME, [{ id: "overlay:o2", bounds: { x: 650, y: 100, width: 200, height: 100 } }], "overlay:o1");

  test("an edge 3 CSS px short of a target scales out to meet it, about the centre", () => {
    // At 1.04 it is 208 across: its right edge at 644, 6 frame pixels from 650.
    const next = snapScaled(transform({ scale: 1.04 }), FITTED, near, { unit: UNIT });
    expect(next.transform.scale).toBeCloseTo(1.1);
    expect(next.transform).toMatchObject({ x: 540, y: 960 });
    expect(next.guides).toEqual({ x: [650], y: [] });
  });

  test("with Alt, or out of reach, there is no snap", () => {
    expect(snapScaled(transform({ scale: 1.04 }), FITTED, near, { unit: UNIT, alt: true }).transform.scale).toBe(1.04);
    expect(snapScaled(transform({ scale: 0.9 }), FITTED, near, { unit: UNIT })).toEqual({ transform: transform({ scale: 0.9 }), guides: { x: [], y: [] } });
  });

  test("a rotated picture snaps by its bounds", () => {
    // Turned 90° it is 100 across: at 2.18 its right edge is at 649, and at 2.2 at 650.
    const next = snapScaled(transform({ scale: 2.18, rotation: 90 }), FITTED, near, { unit: UNIT });
    expect(next.transform.scale).toBeCloseTo(2.2);
    expect(next.guides.x).toEqual([650]);
  });
});

describe("the pictures at the playhead", () => {
  // A picture whose bounds start at `x` across.
  const picture = (x: number): Picture => ({
    crop: { x: 0, y: 0, width: 100, height: 100 },
    item_size: [100, 100],
    width: 100,
    height: 100,
    centre: [x + 50, 50],
    rotation: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1,
    bounds: { x, y: 0, width: 100, height: 100 },
    radius: 0,
    border: null,
    shadow: null,
  });
  const scene = (start: number, end: number, shown: Picture | null): ScenePlan => ({
    start,
    end,
    layout: shown ? "media" : "track",
    panels: [],
    picture: shown,
    colour: null,
    framing: null,
  });
  const overlay = (id: string, start: number, end: number, x: number): OverlayEvent => ({
    id,
    media: "m1",
    picture: picture(x),
    start,
    end,
    offset: 0,
    image: true,
  });
  const plan = {
    ...FRAME,
    scenes: [scene(0, 4, null), scene(4, 8, picture(10))],
    overlays: [overlay("o1", 0, 5, 20), overlay("o2", 3, 6, 30), overlay("o3", 6, 9, 40)],
  } as RenderPlan;
  const at = (time: number, shown: number | null) => picturesAt(plan, time, shown).map(({ id, picture }) => [id, picture.bounds.x]);

  test("are the Scene's picture and the Overlays showing then, as the stage names them", () => {
    expect(at(4.5, 1)).toEqual([
      ["picture:1", 10],
      ["overlay:o1", 20],
      ["overlay:o2", 30],
    ]);
    // An Overlay ends where the next begins.
    expect(at(6, 1)).toEqual([
      ["picture:1", 10],
      ["overlay:o3", 40],
    ]);
  });

  test("leave out an automatic Scene, which has no picture, and the Scene's when it isn't shown", () => {
    expect(at(3.5, 0)).toEqual([
      ["overlay:o1", 20],
      ["overlay:o2", 30],
    ]);
    expect(at(4.5, null)).toEqual([
      ["overlay:o1", 20],
      ["overlay:o2", 30],
    ]);
  });
});
