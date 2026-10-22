// .scratch/background-removal/issues/12: a press on the stage reaches a Behind Overlay where the
// Segment's picture doesn't show: off it, or where its cut has taken it away.
import { describe, expect, test } from "vitest";
import type { OverlayEvent, Picture, RenderPlan, ScenePlan, Transform } from "../../../api";
import { pictureSpot, reachedBehind, segmentShows } from "./behindStage";
import type { PictureTarget, StageControls } from "./ClipPreview";
import { stagePictures } from "./stagePictures";

const SOURCE = { width: 1920, height: 1080 };

// A picture of a 1920x1080 item, uncropped, drawn `width` x `height` about `centre`.
const picture = (centre: [number, number], width: number, height: number, changes: Partial<Picture> = {}): Picture => ({
  crop: { x: 0, y: 0, width: 1920, height: 1080 },
  item_size: [1920, 1080],
  width,
  height,
  centre,
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: {
    x: centre[0] - width / 2,
    y: centre[1] - height / 2,
    width,
    height,
  },
  radius: 0,
  border: null,
  shadow: null,
  ...changes,
});

const scene = (changes: Partial<ScenePlan>): ScenePlan => ({
  start: 0,
  end: 10,
  layout: "manual",
  panels: [],
  picture: null,
  colour: null,
  framing: null,
  ...changes,
});

describe("where the Segment's picture shows", () => {
  test("on a Manual or media picture: a share of its item's frame, flipped and cropped as drawn; null off it", () => {
    const half = scene({ picture: picture([540, 960], 960, 540) });
    expect(pictureSpot(half, { x: 540, y: 960 }, 0, SOURCE)).toEqual({
      u: 0.5,
      v: 0.5,
    });
    expect(pictureSpot(half, { x: 60 + 240, y: 690 + 135 }, 0, SOURCE)).toEqual({ u: 0.25, v: 0.25 });
    expect(pictureSpot(half, { x: 540, y: 300 }, 0, SOURCE)).toBeNull();
    const flipped = scene({
      picture: picture([540, 960], 960, 540, {
        flip_h: true,
        crop: { x: 960, y: 0, width: 960, height: 1080 },
      }),
    });
    // Its left edge shows its crop's right edge: the item's own.
    expect(pictureSpot(flipped, { x: 61, y: 960 }, 0, SOURCE)!.u).toBeCloseTo(1, 2);
  });

  test("turned: by its own axes", () => {
    const turned = scene({
      picture: picture([540, 960], 960, 540, { rotation: 90 }),
    });
    // Turned a quarter, its top edge is on the right.
    expect(pictureSpot(turned, { x: 540 + 260, y: 960 }, 0, SOURCE)!.v).toBeCloseTo(0.0185, 3);
    expect(pictureSpot(turned, { x: 540 + 300, y: 960 }, 0, SOURCE)).toBeNull();
  });

  test("on a Track or Split panel, by its crop at that time; a Blur fill isn't the picture", () => {
    const split = scene({
      layout: "split",
      panels: [
        {
          area: { x: 0, y: 0, width: 1080, height: 900 },
          crop_width: 540,
          crop_height: 450,
          blur: false,
          path: [
            { at: 0, x: 0, y: 0 },
            { at: 5, x: 100, y: 0 },
          ],
        },
        {
          area: { x: 0, y: 1020, width: 1080, height: 900 },
          crop_width: 540,
          crop_height: 450,
          blur: false,
          path: [{ at: 0, x: 1380, y: 630 }],
        },
      ],
    });
    expect(pictureSpot(split, { x: 540, y: 450 }, 1, SOURCE)).toEqual({
      u: 270 / 1920,
      v: 225 / 1080,
    });
    expect(pictureSpot(split, { x: 540, y: 450 }, 6, SOURCE)).toEqual({
      u: 370 / 1920,
      v: 225 / 1080,
    });
    // The gap between the two.
    expect(pictureSpot(split, { x: 540, y: 960 }, 1, SOURCE)).toBeNull();
    const fill = scene({
      layout: "blur",
      panels: [
        {
          area: { x: 0, y: 0, width: 1080, height: 1920 },
          crop_width: 607,
          crop_height: 1080,
          blur: true,
          path: [{ at: 0, x: 0, y: 0 }],
        },
      ],
    });
    expect(pictureSpot(fill, { x: 540, y: 960 }, 1, SOURCE)).toBeNull();
  });

  test("cut out, only where its Matte keeps it; shown whole (no cut drawn), all of it", () => {
    const whole = scene({
      picture: picture([540, 960], 1080, 1920 * (1080 / 1920)),
    });
    const at = { x: 540, y: 960 };
    expect(segmentShows(whole, at, 0, SOURCE, () => null)).toBe(true);
    expect(segmentShows(whole, at, 0, SOURCE, () => 0.9)).toBe(true);
    expect(segmentShows(whole, at, 0, SOURCE, () => 0.1)).toBe(false);
    expect(segmentShows(whole, { x: 540, y: 100 }, 0, SOURCE, () => 1)).toBe(false);
    expect(segmentShows(undefined, at, 0, SOURCE, () => 1)).toBe(false);
  });
});

describe("the Behind Overlay a press reaches", () => {
  const full = {
    id: "overlay:full",
    picture: picture([540, 960], 3414, 1920),
    start: 0,
    end: 10,
  };
  const corner = {
    id: "overlay:corner",
    picture: picture([200, 200], 300, 200),
    start: 2,
    end: 4,
  };

  test("the topmost showing under the point, where the Segment's picture doesn't show", () => {
    expect(reachedBehind([full, corner], { x: 200, y: 200 }, 3, () => false)).toBe("overlay:corner");
    expect(reachedBehind([full, corner], { x: 200, y: 200 }, 5, () => false)).toBe("overlay:full");
    expect(reachedBehind([full, corner], { x: 900, y: 1500 }, 3, () => false)).toBe("overlay:full");
  });

  test("none where the Segment's picture shows over it, or where none is", () => {
    expect(reachedBehind([full, corner], { x: 200, y: 200 }, 3, () => true)).toBeNull();
    expect(reachedBehind([corner], { x: 900, y: 1500 }, 3, () => false)).toBeNull();
    expect(reachedBehind([], { x: 900, y: 1500 }, 3, () => false)).toBeNull();
  });
});

describe("the stage's pictures", () => {
  const T = { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 };
  const event = (id: string, at: Picture): OverlayEvent => ({ id, media: "clip", picture: at, start: 0, end: 10, offset: 0, image: false }) as OverlayEvent;
  const plan = {
    scenes: [scene({ layout: "track", panels: [{ area: { x: 0, y: 0, width: 1080, height: 1920 }, crop_width: 1080, crop_height: 1920, blur: false, path: [{ at: 0, x: 0, y: 0 }] }] })],
    behind: [event("b", picture([540, 960], 3414, 1920))],
    overlays: [event("o", picture([200, 200], 300, 200))],
    shapes: [],
    texts: [],
  } as unknown as RenderPlan;
  const moved: [string, Transform][] = [];
  const controls = (locked: string[] = []): StageControls => ({
    selected: [],
    onSelect: () => {},
    onPlace: () => {},
    overlays: { transformOf: (id) => (locked.includes(id) ? undefined : T), onTransform: (id, next) => void moved.push([id, next]) },
  });
  const segment: PictureTarget = { picked: false, onPick: () => {}, transform: null, onTransform: () => {} };

  test("list the Behind Overlays, under the Segment's picture and before the other Overlays; none on a locked Track", () => {
    const pictures = stagePictures(plan, controls(), segment, 0, 1, undefined);
    expect(pictures.map((each) => [each.id, !!each.under])).toEqual([
      ["picture:0", false],
      ["overlay:b", true],
      ["overlay:o", false],
    ]);
    expect(stagePictures(plan, controls(["b"]), segment, 0, 1, undefined).map((each) => each.id)).toEqual(["picture:0", "overlay:o"]);
  });

  test("a press on the Segment's picture reaches a Behind Overlay where the picture doesn't show; picked, a click where it does picks the picture", () => {
    let shows = false;
    const [picture, under] = stagePictures(plan, controls(), segment, 0, 1, undefined, { shows: () => shows, now: () => 1 });
    expect(picture.through!({ x: 540, y: 1800 })).toBe("overlay:b");
    expect(under.coveredBy!({ x: 540, y: 1800 })).toBeNull();
    shows = true;
    expect(picture.through!({ x: 540, y: 1800 })).toBeNull();
    expect(under.coveredBy!({ x: 540, y: 1800 })).toBe("picture:0");
  });

  test("dragging a Behind Overlay moves it: its gesture puts its Overlay where it is let go", () => {
    const [, under] = stagePictures(plan, controls(), segment, 0, 1, undefined);
    under.onTransform({ ...T, x: 700 }, "drag");
    expect(moved).toEqual([["b", { ...T, x: 700 }]]);
  });
});
