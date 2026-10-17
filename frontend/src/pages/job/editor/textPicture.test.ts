// .scratch/text-advanced/issues/02-text-layers-as-pictures.md: the preview draws a Text Layer as the
// picture the backend made of it (docs/adr/0010), asking for a new one only when its look changes,
// and keeping the last one on screen until the new one has loaded. 05: moving, turning, fading or
// scaling it down asks for no new picture; scaling it up past what its picture was made at does.
import { describe, expect, test } from "vitest";
import type { Picture, TextEvent } from "../../../api";
import { EASE_OUT, LINEAR, valueAt } from "./keyframes";
import { needsLoading, pictureToShow, placedText, wantedPicture, type Loaded } from "./textPicture";

const picture = (centre: [number, number], changes: Partial<Picture> = {}): Picture => ({
  crop: { x: 0, y: 0, width: 300, height: 160 },
  item_size: [300, 160],
  width: 300,
  height: 160,
  centre,
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: { x: centre[0] - 150, y: centre[1] - 80, width: 300, height: 160 },
  radius: 0,
  border: null,
  shadow: null,
  ...changes,
});

// The plan's event of a layer whose look is the picture `image` of `look`, centred at `centre`.
const event = (image: string, centre: [number, number] = [540, 960], changes: Partial<Picture> = {}, look = image.slice(0, 3)) =>
  ({ image, look, picture: picture(centre, changes) }) as TextEvent;

// The pictures loaded, the largest of each look.
const loadedOf = (...loaded: { look: string; url: string; made: number }[]) => {
  const largest = new Map(loaded.map((each) => [each.look, { url: each.url, made: each.made }]));
  return (look: string): Loaded | undefined => largest.get(look);
};

describe("a Text Layer's picture in the preview", () => {
  test("is asked for by its look alone: moving, turning or fading the layer keeps it, a new colour is another", () => {
    const here = wantedPicture("job 1", event("abc.png"));
    expect(here).toMatchObject({ url: "/api/jobs/job%201/texts/abc.png", width: 300, height: 160 });
    for (const changes of [{}, { rotation: 30 }, { opacity: 0.4 }]) {
      expect(wantedPicture("job 1", event("abc.png", [200, 1500], changes)).url).toBe(here.url);
    }
    expect(wantedPicture("job 1", event("def.png")).url).not.toBe(here.url);
  });

  test("keeps the last picture on screen until the new one has loaded", () => {
    const before = wantedPicture("j", event("abc.png"));
    const after = wantedPicture("j", event("def.png"));
    const loaded = loadedOf({ look: before.look, url: before.url, made: 300 });
    expect(pictureToShow(null, before, loaded)).toEqual({ url: before.url, width: 300, height: 160 });
    expect(needsLoading(after, loaded)).toBe(true);
    const shown = pictureToShow(null, before, loaded);
    expect(pictureToShow(shown, after, loaded)).toEqual(shown);
    const both = loadedOf({ look: before.look, url: before.url, made: 300 }, { look: after.look, url: after.url, made: 300 });
    expect(pictureToShow(shown, after, both)).toEqual({ url: after.url, width: 300, height: 160 });
    // Nothing is drawn before the first has loaded.
    expect(pictureToShow(null, after, () => undefined)).toBeNull();
  });

  test("scaled down, it draws the larger picture of its look it has; scaled up past it, it asks for a larger one", () => {
    // Made at scale 3 (900 px wide), the layer now at scale 2.5.
    const large = wantedPicture("j", event("abc-3.png", [540, 960], { width: 750, height: 400, item_size: [900, 480] }, "abc"));
    const loaded = loadedOf({ look: large.look, url: large.url, made: 900 });
    // Scaled down to 1.2: its picture would be made at 1.5, but the one at 3 is drawn, smaller.
    const smaller = wantedPicture("j", event("abc-1.5.png", [540, 960], { width: 360, height: 192, item_size: [450, 240] }, "abc"));
    expect(needsLoading(smaller, loaded)).toBe(false);
    expect(pictureToShow(null, smaller, loaded)).toEqual({ url: large.url, width: 360, height: 192 });
    // Scaled up to 4: a picture made at 4 is asked for, and the one at 3 drawn as large until it comes.
    const larger = wantedPicture("j", event("abc-4.png", [540, 960], { width: 1200, height: 640, item_size: [1200, 640] }, "abc"));
    expect(needsLoading(larger, loaded)).toBe(true);
    expect(pictureToShow(null, larger, loaded)).toEqual({ url: large.url, width: 1200, height: 640 });
  });
});

// 12: Keyframes on Text Layers.
describe("a keyed Text Layer's picture in the preview", () => {
  // 300×160 at scale 1, keyed from x 200 to 880 and from scale 1 to 2 over 1 s from 2 s into the Clip.
  const keyed = picture([540, 960], {
    motion: {
      x: [{ at: 2, value: 200, ease: LINEAR }, { at: 3, value: 880, ease: EASE_OUT }],
      scale: [{ at: 2, value: 1, ease: LINEAR }, { at: 3, value: 2, ease: LINEAR }],
      opacity: [{ at: 2, value: 0.8, ease: LINEAR }],
    },
    unscaled: [300, 160],
  });

  test("is drawn where its Keyframes have it, as the render draws it", () => {
    const at = placedText(keyed, 2.5, [1, 1, 0]);
    expect(at.x).toBeCloseTo(valueAt(keyed.motion!.x!, 2.5, 0));
    expect([at.y, at.width, at.height, at.opacity]).toEqual([960, 450, 240, 0.8]);
  });

  test("its Fade, Pop and Slide are stacked on its keyed values: opacity and scale multiplied, the drop added", () => {
    const at = placedText(keyed, 3.5, [0.5, 0.85, 30]);
    expect(at).toEqual({ x: 880, y: 990, width: 600 * 0.85, height: 320 * 0.85, rotation: 0, opacity: 0.4 });
    // Unkeyed, its plan's picture, animated.
    expect(placedText(picture([540, 960]), 3.5, [0.5, 0.85, 30])).toEqual({ x: 540, y: 990, width: 255, height: 136, rotation: 0, opacity: 0.5 });
  });
});
