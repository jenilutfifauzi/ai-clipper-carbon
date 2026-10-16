import { describe, expect, test } from "vitest";
import type { RenderPlan } from "../../../api";
import { offeredLayouts, portraitSource, shownLayout } from "./layouts";

const CHOICES = [
  { value: "default", label: "Clip's" },
  { value: "auto", label: "Auto" },
  { value: "track", label: "Track" },
  { value: "split", label: "Split" },
  { value: "blur", label: "Blur" },
  { value: "manual", label: "Manual" },
] as const;

const sized = (source_width: number, source_height: number) => ({ source_width, source_height }) as RenderPlan;

describe("a portrait Source", () => {
  test("is one taller than wide; a square or wide one is reframed", () => {
    expect(portraitSource(sized(1080, 1920))).toBe(true);
    expect(portraitSource(sized(1920, 1080))).toBe(false);
    expect(portraitSource(sized(1080, 1080))).toBe(false);
    expect(portraitSource(null)).toBe(false);
  });
});

describe("the Layouts offered", () => {
  test("are all of them for a Source that is reframed", () => {
    expect(offeredLayouts(CHOICES, false)).toEqual(CHOICES);
  });

  test("are As shot (Auto) and Manual for a portrait Source, keeping the clip's", () => {
    expect(offeredLayouts(CHOICES, true)).toEqual([
      { value: "default", label: "Clip's" },
      { value: "auto", label: "As shot" },
      { value: "manual", label: "Manual" },
    ]);
  });
});

describe("the Layout shown as chosen", () => {
  test("is the saved one for a Source that is reframed", () => {
    expect(shownLayout("split", false)).toBe("split");
  });

  test("is As shot (Auto) on a portrait Source for every automatic Layout, which all show it as shot", () => {
    expect(shownLayout("track", true)).toBe("auto");
    expect(shownLayout("split", true)).toBe("auto");
    expect(shownLayout("blur", true)).toBe("auto");
    expect(shownLayout("manual", true)).toBe("manual");
    expect(shownLayout("default", true)).toBe("default");
  });
});
