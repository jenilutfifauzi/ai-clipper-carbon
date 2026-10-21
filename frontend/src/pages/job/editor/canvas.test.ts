// The Canvas as the editor takes it from the plan (docs/adr/0022), and the stage's size at its
// aspect in a player, as worked examples.
import { describe, expect, test } from "vitest";
import shared from "../../../../../backend/tests/fixtures/canvases.json";
import type { RenderPlan } from "../../../api";
import { aspectParts, aspectRatio, CANVASES, CAPTION_HEIGHT, canvasOf, fittedStage, fromReference, PORTRAIT, REFERENCE, tallestAspect, toReference } from "./canvas";
import { placedFields, watermarkPlaced } from "./placing";

const LANDSCAPE = { width: 1920, height: 1080, safe_area: { x: 96, y: 54, width: 1728, height: 972 } };

describe("the Canvas", () => {
  // backend/app/canvas.py is checked against the same file (backend/tests/test_canvas.py).
  test("each aspect's is canvas.py's, as the shared fixture says", () => {
    expect(CANVASES).toEqual(shared.canvases);
    expect(PORTRAIT).toBe(CANVASES["9:16"]);
    expect(REFERENCE).toEqual(shared.reference);
    expect(CAPTION_HEIGHT).toBe(shared.caption_height);
  });

  test("is the plan's width, height and Safe Area", () => {
    const plan = { ...LANDSCAPE, scenes: [] } as unknown as RenderPlan;
    expect(canvasOf(plan)).toEqual(LANDSCAPE);
  });

  test("is the 9:16 one before a plan comes", () => {
    expect(canvasOf(null)).toBe(PORTRAIT);
    expect(PORTRAIT).toEqual({ width: 1080, height: 1920, safe_area: { x: 0, y: 232, width: 950, height: 1304 } });
  });

  test("is the Candidate's aspect's before a plan comes, and the plan's once it does", () => {
    expect(canvasOf(null, "16:9")).toEqual(LANDSCAPE);
    expect(canvasOf(undefined, "4:5")).toEqual({ width: 1080, height: 1350, safe_area: { x: 54, y: 68, width: 972, height: 1214 } });
    expect(canvasOf(null, "9:16")).toBe(PORTRAIT);
    const plan = { ...CANVASES["1:1"], scenes: [] } as unknown as RenderPlan;
    expect(canvasOf(plan, "16:9")).toEqual(CANVASES["1:1"]);
  });

  test("a card of an aspect takes its shape", () => {
    expect(aspectRatio("9:16")).toBe("9 / 16");
    expect(aspectRatio("16:9")).toBe("16 / 9");
    expect(aspectParts("4:5")).toEqual({ width: 4, height: 5 });
  });

  test("cards of mixed shapes share the tallest one's slot", () => {
    expect(tallestAspect(["16:9", "1:1", "4:5"])).toBe("4:5");
    expect(tallestAspect(["16:9", "9:16", "1:1"])).toBe("9:16");
    expect(tallestAspect(["16:9", "16:9"])).toBe("16:9");
    expect(tallestAspect([])).toBe("9:16");
  });
});

describe("the stage in a player", () => {
  // The 9:16 stage as it was worked out before Canvases: whole ninths across and sixteenths down.
  const nineBySixteen = (width: number, height: number) => {
    const unit = Math.max(0, Math.min(width / 9, height / 16));
    return { width: Math.floor(unit * 9), height: Math.floor(unit * 16) };
  };

  test("is as large as fits on 9:16, to the pixel as before", () => {
    for (const [width, height] of [
      [800, 600],
      [333, 1000],
      [1234.5, 777.25],
      [0, 400],
      [360, 640],
    ])
      expect(fittedStage({ width, height }, PORTRAIT)).toEqual(nineBySixteen(width, height));
  });

  test("takes a 16:9 Canvas's shape: as wide as fits, or as tall", () => {
    expect(fittedStage({ width: 800, height: 600 }, LANDSCAPE)).toEqual({ width: 800, height: 450 });
    expect(fittedStage({ width: 800, height: 300 }, LANDSCAPE)).toEqual({ width: 533, height: 300 });
    expect(fittedStage({ width: 800, height: 600 }, { width: 1080, height: 1080 })).toEqual({ width: 600, height: 600 });
  });
});

// canvas-aspect/07: a caption, the hook or the Watermark dragged on the stage is kept in its Style
// in the Reference Space (1080x1920), which the planner maps back onto the Canvas.
describe("a place dragged on the stage", () => {
  const FEED = { width: 1080, height: 1350, safe_area: { x: 54, y: 68, width: 972, height: 1214 } };

  test("is in the Reference Space in proportion, and itself on 9:16", () => {
    expect(toReference(LANDSCAPE, { x: 480, y: 270 })).toEqual({ x: 270, y: 480 });
    expect(toReference(FEED, { x: 540, y: 675 })).toEqual({ x: 540, y: 960 });
    expect(toReference(PORTRAIT, { x: 333, y: 1201 })).toEqual({ x: 333, y: 1201 });
  });

  test.each([
    ["16:9", LANDSCAPE],
    ["4:5", FEED],
  ])("comes back to the pixel it was dropped on, on %s", (_, canvas) => {
    for (let x = 0; x <= canvas.width; x += 7) {
      for (const y of [0, 1, 233, 541, 677, 1001, canvas.height - 1, canvas.height]) {
        expect(fromReference(canvas, toReference(canvas, { x, y }))).toEqual({ x, y });
      }
    }
  });

  test("writes the captions', the hook's and the Watermark's Custom place in the Reference Space, the size as it is", () => {
    expect(placedFields({ x: 960, y: 810, size: 64 }, LANDSCAPE)).toEqual({ position: "custom", x: 540, y: 1440, size: 64 });
    expect(placedFields({ x: 1001, y: 300, size: null }, LANDSCAPE)).toEqual({ position: "custom", x: 563.06, y: 533.33 });
    expect(watermarkPlaced(FEED, 100, 1300)).toEqual({ position: "custom", x: 100, y: 1848.89 });
  });
});
