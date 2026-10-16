// The clip editor's Manual: its Layout pickers copy the plan's Framing when Manual is chosen and drop
// it for another Layout, and a gesture on a Manual Scene's picture saves only where its Framing is kept.
import { describe, expect, test } from "vitest";
import type { Framing, RenderPlan, ScenePlan, SegmentPlan } from "../../../api";
import { clipLayoutChange, pictureChange, sourceSceneNear } from "./clipManual";
import { NO_CROP } from "./cropGestures";
import type { LayoutEdits } from "./manual";
import { BLURRED, IDENTITY } from "./picture";
import type { PictureEdits } from "./stagePicture";

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

const segmentPlan = (start: number, end: number, source_start: number, media: string | null): SegmentPlan => ({
  start,
  end,
  source_start,
  source_end: source_start + end - start,
  media,
  volume: 1,
  silent: false,
  scenes: 1,
  gain: [],
  id: "",
});

// A clip of the Source from 100 s: a Track Scene for 3 s, then a Split one.
const TRACKED = framing(700, 3.16);
const SPLIT = framing(540, 3.16);
const VIDEO = framing(300, 0.5);
const plan = {
  start: 100,
  end: 106,
  segments: [] as SegmentPlan[],
  scenes: [scene(0, 3, "track", TRACKED), scene(3, 6, "split", SPLIT)],
} as RenderPlan;
// A cut one: a video's Segment, then the Source from 100 s.
const cut = {
  ...plan,
  segments: [segmentPlan(0, 4, 0, "clip"), segmentPlan(4, 7, 100, null)],
  scenes: [scene(0, 4, "media", VIDEO), scene(4, 7, "track", TRACKED)],
} as RenderPlan;

const edits = (changes: Partial<LayoutEdits> = {}): LayoutEdits => ({ layout: "auto", framing: null, layout_overrides: [], ...changes });

describe("the Scene a clip made Manual is framed as", () => {
  test("is the one under the playhead when it shows the Source", () => {
    expect(sourceSceneNear(plan, 1)).toBe(1);
  });

  test("is the first of the Source when a video's is under the playhead", () => {
    expect(sourceSceneNear(cut, 0)).toBe(1);
    const videoOnly = { ...cut, segments: cut.segments.slice(0, 1), scenes: cut.scenes.slice(0, 1) } as RenderPlan;
    expect(sourceSceneNear(videoOnly, 0)).toBeNull();
  });
});

describe("the clip's Layout chosen in the clip editor", () => {
  test("Manual copies the Framing of what the Scene under the playhead shows", () => {
    expect(clipLayoutChange(edits(), plan, 1, "manual")).toEqual({ layout: "manual", framing: SPLIT });
    expect(clipLayoutChange(edits(), cut, 0, "manual")).toEqual({ layout: "manual", framing: TRACKED });
  });

  test("another Layout drops the Framing", () => {
    expect(clipLayoutChange(edits({ layout: "manual", framing: SPLIT }), plan, 0, "track")).toEqual({ layout: "track", framing: null });
  });

  test("Manual before there is a plan keeps the clip's Framing, or fits the Source", () => {
    expect(clipLayoutChange(edits({ framing: SPLIT }), null, 0, "manual")).toEqual({ layout: "manual", framing: SPLIT });
    expect(clipLayoutChange(edits(), null, 0, "manual")).toEqual({
      layout: "manual",
      framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED },
    });
  });
});

describe("a gesture on a Manual Scene's picture", () => {
  const OWN = framing(400, 2);
  const picture = (changes: Partial<PictureEdits> = {}): PictureEdits => ({
    segments: [{ id: "main", start: 100, end: 106 }],
    ...edits({ layout_overrides: [{ at: 104.5, layout: "manual", framing: OWN }] }),
    ...changes,
  });
  const moved = { ...IDENTITY, x: 500, scale: 2.5 };

  test("saves its own override's Framing, the rest of it as it was", () => {
    expect(pictureChange(picture(), plan, { kind: "manual", segment: "main", scene: 1, transform: OWN.transform }, moved)).toEqual({
      layout_overrides: [{ at: 104.5, layout: "manual", framing: { ...OWN, transform: moved } }],
    });
  });

  test("saves the clip's Framing for a Scene that follows the clip's Manual Layout", () => {
    const clip = picture({ layout: "manual", framing: SPLIT });
    expect(pictureChange(clip, plan, { kind: "manual", segment: "main", scene: 0, transform: SPLIT.transform }, moved)).toEqual({
      framing: { ...SPLIT, transform: moved },
    });
  });

  test("saves nothing for an automatic Scene's or a video's", () => {
    expect(pictureChange(picture(), plan, { kind: "auto", segment: "main", scene: 0 }, moved)).toBeNull();
    expect(pictureChange(picture(), plan, { kind: "media", segment: "main", transform: IDENTITY }, moved)).toBeNull();
  });
});
