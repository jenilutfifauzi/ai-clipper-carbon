// The Manual Layout as the editors set it: a Scene switched to Manual copies the Framing the plan
// gives it, its own override's or the clip's, and back.
import { describe, expect, test } from "vitest";
import type { Framing, LayoutOverride, RenderPlan, ScenePlan, SegmentPlan } from "../../../api";
import { NO_CROP } from "./cropGestures";
import { forAllScenes, framingSource, reframed, sceneLayoutOverrides, sourceSceneAt, withClipLayout, withSceneFraming, type LayoutEdits } from "./manual";
import { BLURRED, IDENTITY } from "./picture";

const framing = (x: number, scale = 1): Framing => ({ transform: { ...IDENTITY, x, scale }, crop: NO_CROP, background: BLURRED });

const scene = (start: number, end: number, layout: ScenePlan["layout"], shown: Framing): ScenePlan => ({
  start,
  end,
  layout,
  panels: [],
  picture: null,
  colour: null,
  framing: shown,
});

// A clip of the Source from 100 s: a Track Scene for 3 s, then a Split one.
const TRACKED = framing(700, 3.16);
const SPLIT = framing(540, 3.16);
const plan = {
  start: 100,
  end: 106,
  segments: [] as SegmentPlan[],
  scenes: [scene(0, 3, "track", TRACKED), scene(3, 6, "split", SPLIT)],
} as RenderPlan;

const edits = (changes: Partial<LayoutEdits> = {}): LayoutEdits => ({ layout: "auto", framing: null, layout_overrides: [], ...changes });

describe("switching a Scene to Manual", () => {
  test("copies the Framing of what it shows into its own override, in place of the one it had", () => {
    const blurred: LayoutOverride = { at: 101, layout: "blur" };
    const other: LayoutOverride = { at: 104, layout: "track" };
    expect(reframed(edits({ layout_overrides: [other, blurred] }), plan, 0)).toEqual(
      edits({ layout_overrides: [{ at: 101.5, layout: "manual", framing: TRACKED }, other] }),
    );
    // Another Layout has no Framing; "default" follows the clip's again.
    expect(sceneLayoutOverrides([blurred, other], plan, 1, "blur")).toEqual([blurred, { at: 104.5, layout: "blur" }]);
    expect(sceneLayoutOverrides([blurred, other], plan, 1, "default")).toEqual([blurred]);
  });

  test("for every Scene: the clip's Layout Manual from the Scene's Framing, its own override gone", () => {
    const own: LayoutOverride = { at: 104, layout: "manual", framing: framing(300, 2) };
    expect(forAllScenes(edits({ layout_overrides: [own] }), plan, 1)).toEqual(edits({ layout: "manual", framing: framing(300, 2) }));
    expect(withClipLayout(edits(), plan, 0, "manual")).toEqual(edits({ layout: "manual", framing: TRACKED }));
    expect(withClipLayout(edits({ layout: "manual", framing: TRACKED }), plan, 0, "split")).toEqual(edits({ layout: "split" }));
  });
});

describe("a Manual Scene's Framing", () => {
  test("is its own override's, or else the clip's; an automatic Scene has none", () => {
    const own: LayoutOverride = { at: 104, layout: "manual", framing: framing(300, 2) };
    const clip = edits({ layout: "manual", framing: TRACKED, layout_overrides: [own] });
    expect(framingSource(clip, plan, 0)).toEqual({ framing: TRACKED, own: null });
    expect(framingSource(clip, plan, 1)).toEqual({ framing: own.framing, own });
    expect(framingSource(edits(), plan, 0)).toBeNull();

    expect(withSceneFraming(clip, plan, 1, framing(800))).toEqual({ ...clip, layout_overrides: [{ ...own, framing: framing(800) }] });
    expect(withSceneFraming(clip, plan, 0, framing(800))).toEqual({ ...clip, framing: framing(800) });
    expect(withSceneFraming(edits(), plan, 0, framing(800))).toBeNull();
  });
});

describe("the Scene at the playhead", () => {
  test("is the picked Segment's, when the playhead is on it and it shows the Source", () => {
    expect(sourceSceneAt(plan, 0, 1, 4)).toBe(1);
    const cut = {
      ...plan,
      segments: [
        { start: 0, end: 6, source_start: 100, source_end: 106, media: null, volume: 1, silent: false, scenes: 2 },
        { start: 6, end: 8, source_start: 0, source_end: 2, media: "ab", volume: 1, silent: false, scenes: 1 },
      ],
      scenes: [...plan.scenes, scene(6, 8, "media", framing(540))],
    } as RenderPlan;
    expect(sourceSceneAt(cut, 0, 2, 2)).toBe(0);
    expect(sourceSceneAt(cut, 0, 2, 7)).toBeNull();
    expect(sourceSceneAt(cut, 1, 2, 7)).toBeNull();
    // A plan not yet of the Main Track as it is.
    expect(sourceSceneAt(cut, 0, 3, 2)).toBeNull();
  });
});
