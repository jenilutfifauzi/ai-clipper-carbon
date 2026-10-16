// Seam H: the picture behind the Overlays as the stage picks it (the Segment under the playhead, and
// where its Transform is kept), a gesture's Transform put back into the edits, and a picture drawn
// from that Transform while a Grip is held.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Framing, LayoutOverride, Picture, RenderPlan, ScenePlan, SegmentPlan } from "../../../api";
import { NO_CROP } from "./cropGestures";
import { BLURRED, IDENTITY } from "./picture";
import { gripsOf } from "./pictureGestures";
import {
  gripCursor,
  gripsOnFrame,
  heldPicture,
  pictureSource,
  segmentOfScene,
  tidyTransform,
  withPictureTransform,
  type PictureEdits,
} from "./stagePicture";

const FRAME = { width: 1080, height: 1920 };

const framing = (x: number, scale = 1): Framing => ({ transform: { ...IDENTITY, x, scale }, crop: NO_CROP, background: BLURRED });

const scene = (start: number, end: number, layout: ScenePlan["layout"], shown: Framing | null = null): ScenePlan => ({
  start,
  end,
  layout,
  panels: [],
  picture: null,
  colour: null,
  framing: shown,
});

const segmentPlan = (start: number, end: number, source_start: number, media: string | null = null): SegmentPlan => ({
  start,
  end,
  source_start,
  source_end: source_start + end - start,
  media,
  volume: 1,
  silent: false,
  scenes: 1,
});

// A Source Segment from 100 s (a Track Scene, then a Manual one), then a video's.
const VIDEO: Framing = framing(300, 0.5);
const segments: ClipSegment[] = [
  { id: "s1", start: 100, end: 106 },
  { id: "v1", start: 0, end: 4, media: "clip", framing: VIDEO },
];
const plan = {
  start: 100,
  end: 106,
  segments: [{ ...segmentPlan(0, 6, 100), scenes: 2 }, segmentPlan(6, 10, 0, "clip")],
  scenes: [scene(0, 3, "track", framing(700, 3.16)), scene(3, 6, "manual"), scene(6, 10, "media", VIDEO)],
} as RenderPlan;

const OWN = framing(400, 2);
const edits = (changes: Partial<PictureEdits> = {}): PictureEdits => ({
  segments,
  layout: "auto",
  framing: null,
  layout_overrides: [{ at: 104, layout: "manual", framing: OWN }],
  ...changes,
});

describe("the picture behind the Overlays", () => {
  test("is the Segment under the playhead: a video's by its Framing, a Manual Scene's by where its Framing is kept", () => {
    expect(pictureSource(edits(), plan, 1, 2)).toEqual({ kind: "media", segment: "v1", transform: VIDEO.transform });
    expect(pictureSource(edits(), plan, 0, 1)).toEqual({ kind: "manual", segment: "s1", scene: 1, transform: OWN.transform });
    // The clip's Framing, for a Scene of the clip's Layout when that is Manual.
    const clip = framing(600, 1.5);
    expect(pictureSource(edits({ layout: "manual", framing: clip }), plan, 0, 0)).toEqual({
      kind: "manual",
      segment: "s1",
      scene: 0,
      transform: clip.transform,
    });
  });

  test("of an automatic Scene is its Segment alone, with no Transform to set", () => {
    expect(pictureSource(edits(), plan, 0, 0)).toEqual({ kind: "auto", segment: "s1", scene: 0 });
  });

  test("of a Clip of one range is its one Segment", () => {
    const whole = { ...plan, segments: [], scenes: plan.scenes.slice(0, 2) } as RenderPlan;
    expect(pictureSource(edits({ segments: [segments[0]] }), whole, 0, 0)).toEqual({ kind: "auto", segment: "s1", scene: 0 });
  });

  test("is of the Segment whose Scenes the playhead's is one of", () => {
    expect([0, 1, 2].map((index) => segmentOfScene(plan, index))).toEqual([0, 0, 1]);
    expect(segmentOfScene({ ...plan, segments: [] } as RenderPlan, 1)).toBe(0);
  });

  test("is nothing while the plan is of another Main Track, or past it", () => {
    expect(pictureSource(edits({ segments: [segments[0]] }), plan, 0, 0)).toBeNull();
    expect(pictureSource(edits({ segments: [segments[1], segments[0]] }), plan, 1, 2)).toBeNull();
    expect(pictureSource(edits(), plan, 2, 3)).toBeNull();
  });
});

describe("a gesture's Transform put back", () => {
  const turned = { ...IDENTITY, x: 700, rotation: 90 };

  test("sets a video's Framing", () => {
    const next = withPictureTransform(edits(), plan, { kind: "media", segment: "v1", transform: VIDEO.transform }, turned);
    expect(next.segments).toEqual([segments[0], { ...segments[1], framing: { ...VIDEO, transform: turned } }]);
  });

  test("sets a Manual Scene's Framing where it is kept, the rest of it as it was", () => {
    const own = withPictureTransform(edits(), plan, { kind: "manual", segment: "s1", scene: 1, transform: OWN.transform }, turned);
    expect(own.layout_overrides).toEqual<LayoutOverride[]>([{ at: 104, layout: "manual", framing: { ...OWN, transform: turned } }]);
    const clip = edits({ layout: "manual", framing: framing(600) });
    const shared = withPictureTransform(clip, plan, { kind: "manual", segment: "s1", scene: 0, transform: IDENTITY }, turned);
    expect(shared).toEqual({ ...clip, framing: { ...framing(600), transform: turned } });
  });

  test("leaves an automatic Scene as it is", () => {
    const before = edits();
    expect(withPictureTransform(before, plan, { kind: "auto", segment: "s1", scene: 0 }, turned)).toBe(before);
  });

  test("is rounded: its centre to the pixel, its scale and stretch to four places, its turn to a hundredth", () => {
    const rough = { ...IDENTITY, x: 640.4, y: 959.6, scale: 1.234567, stretch_x: 2.000049, rotation: 33.33333 };
    expect(tidyTransform(rough)).toEqual({ ...IDENTITY, x: 640, y: 960, scale: 1.2346, stretch_x: 2, rotation: 33.33 });
  });
});

describe("a picture held by a Grip", () => {
  // A 1920x1080 video's crop of its right half (960x1080), fitted 1080x1215, at scale 0.5.
  const planned: Picture = {
    crop: { x: 960, y: 0, width: 960, height: 1080 },
    item_size: [1920, 1080],
    width: 540,
    height: 608,
    centre: [540, 960],
    rotation: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1,
    bounds: { x: 270, y: 656, width: 540, height: 608 },
    radius: 0,
    border: null,
    shadow: null,
  };

  test("is drawn from the drag's Transform: its centre, its size from its crop's fitted size, its turn and bounds", () => {
    const { bounds, ...held } = heldPicture(planned, { ...IDENTITY, x: 300, y: 400, scale: 1, stretch_x: 0.5, rotation: 90, flip_h: true }, FRAME);
    const { bounds: _, ...rest } = planned;
    expect(held).toEqual({ ...rest, centre: [300, 400], width: 540, height: 1215, rotation: 90, flip_h: true });
    // Turned a quarter, its bounds are as wide as it is high.
    const expected = { x: 300 - 607.5, y: 400 - 270, width: 1215, height: 540 };
    for (const key of ["x", "y", "width", "height"] as const) expect(bounds[key]).toBeCloseTo(expected[key]);
  });
});

describe("a Grip's cursor", () => {
  test("points along the picture as turned", () => {
    expect(gripCursor("right", 0)).toBe("ew-resize");
    expect(gripCursor("bottom-right", 0)).toBe("nwse-resize");
    expect(gripCursor("top-right", 0)).toBe("nesw-resize");
    expect(gripCursor("top", 0)).toBe("ns-resize");
    // A quarter turn stands the right edge's Grip up; an eighth lays a corner's flat.
    expect(gripCursor("right", 90)).toBe("ns-resize");
    expect(gripCursor("bottom-right", -45)).toBe("ew-resize");
    expect(gripCursor("rotate", 30)).toBe("grab");
  });
});

describe("the Grips as drawn", () => {
  test("sit on the picture as turned while it is inside the frame", () => {
    const small = { x: 540, y: 960, width: 400, height: 200, rotation: 30 };
    expect(gripsOnFrame(small, FRAME, 20, 10)).toEqual(gripsOf(small, 20));
  });

  test("of a picture larger than the frame are pulled in towards its centre, the rotate handle beyond the rest", () => {
    // Three frames wide and high: its corners and edges are far off the frame.
    const large = { x: 540, y: 960, width: 3240, height: 5760, rotation: 0 };
    const grips = gripsOnFrame(large, FRAME, 20, 10);
    // Along the line from the centre to its corner, as far as 30 px inside the frame.
    expect(grips["top-left"].x).toBeCloseTo(30);
    expect(grips["top-left"].y).toBeCloseTo(960 - (510 / 1620) * 2880);
    expect(grips.top).toEqual({ x: 540, y: 30 });
    expect(grips.right).toEqual({ x: 1050, y: 960 });
    expect(grips.rotate).toEqual({ x: 540, y: 10 });
  });
});
