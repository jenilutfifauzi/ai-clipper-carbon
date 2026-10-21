// The Canvas as the editor takes it from the plan (docs/adr/0022), and the stage's size at its
// aspect in a player, as worked examples.
import { describe, expect, test } from "vitest";
import type { RenderPlan } from "../../../api";
import { CANVASES, canvasOf, fittedStage, PORTRAIT } from "./canvas";

const LANDSCAPE = { width: 1920, height: 1080, safe_area: { x: 96, y: 54, width: 1728, height: 972 } };

describe("the Canvas", () => {
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
