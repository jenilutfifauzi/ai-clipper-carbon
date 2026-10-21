// .scratch/transitions-expanded/issues/10-overlay-animations.md: an Overlay comes on and goes off
// as a picture layer does, its animations stacked on its keyed values, as worked examples of the
// render's (backend/tests/test_overlay_animations.py's).
import { describe, expect, test } from "vitest";
import type { OverlayEvent, Picture } from "../../../api";
import { animatedPicture, overlayLook } from "./animation";
import { PORTRAIT } from "./canvas";

// A 200x100 image fitted as 1080x540, drawn at 0.5 (540x270) about (540, 900), its corners rounded 135 px.
const picture = (changes: Partial<Picture> = {}): Picture => ({
  crop: { x: 0, y: 0, width: 200, height: 100 },
  item_size: [200, 100],
  width: 540,
  height: 270,
  centre: [540, 900],
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: { x: 270, y: 765, width: 540, height: 270 },
  radius: 135,
  border: null,
  shadow: null,
  ...changes,
});

// From 1 s to 3 s, keyed at half opacity and from y 800 to 1000 over its 2 s.
const keyed = picture({
  opacity: 0.5,
  motion: {
    y: [
      { at: 1, value: 800, ease: [0, 0, 1, 1] },
      { at: 3, value: 1000, ease: [0, 0, 1, 1] },
    ],
  },
  unscaled: [1080, 540],
});

const overlay = (changes: Partial<OverlayEvent> = {}): OverlayEvent => ({
  id: "o1",
  media: "m1",
  picture: keyed,
  start: 1,
  end: 3,
  offset: 0,
  image: true,
  ...changes,
});

const near = (value: number) => expect.closeTo(value, 6);

const drawnAt = (event: OverlayEvent, time: number) => {
  const look = overlayLook(event, time);
  return look && animatedPicture(event.picture, time, look, PORTRAIT);
};

describe("an Overlay's animations", () => {
  test("stored without any, it is drawn as keyed while it shows, and not outside its time", () => {
    const still = overlay();
    expect(drawnAt(still, 2)).toMatchObject({ centre: [540, 900], width: 540, height: 270, opacity: 0.5 });
    expect(drawnAt(still, 0.9)).toBeNull();
    expect(drawnAt(still, 3)).toBeNull();
  });

  test("a keyed opacity of 0.5 fading in reaches 0.5, not 1", () => {
    const faded = overlay({ animation_in: "fade", animation_ms: 500 });
    expect(drawnAt(faded, 1)!.opacity).toBe(0);
    expect(drawnAt(faded, 1.25)!.opacity).toBeCloseTo(0.25);
    expect(drawnAt(faded, 1.5)!.opacity).toBeCloseTo(0.5);
    expect(drawnAt(faded, 2.9)!.opacity).toBeCloseTo(0.5);
  });

  test("Pop and Slide are stacked on its keyed values: opacity and scale multiplied, the drop added", () => {
    const popped = overlay({ animation_in: "pop", animation_out: "slide", animation_ms: 400 });
    // Half way in: half its keyed opacity, 85% of its size and corners, at its keyed place.
    expect(drawnAt(popped, 1.2)).toMatchObject({ width: near(459), height: near(229.5), radius: near(114.75), opacity: near(0.25) });
    expect(drawnAt(popped, 1.2)!.centre[1]).toBeCloseTo(820);
    // Half way out: half its keyed opacity, 30 px below its keyed place, at its size.
    expect(drawnAt(popped, 2.8)).toMatchObject({ width: 540, height: 270, opacity: near(0.25) });
    expect(drawnAt(popped, 2.8)!.centre[1]).toBeCloseTo(980 + 30);
    // In between, as keyed.
    expect(drawnAt(popped, 2)).toMatchObject({ centre: [540, 900], width: 540, opacity: 0.5 });
  });

  test("each end takes at most half its length", () => {
    const short = overlay({ end: 2, picture: picture(), animation_in: "pop", animation_out: "pop", animation_ms: 2000 });
    expect(drawnAt(short, 1.25)!.opacity).toBeCloseTo(0.5);
    expect(drawnAt(short, 1.5)!.opacity).toBeCloseTo(1);
    expect(drawnAt(short, 1.75)!.opacity).toBeCloseTo(0.5);
  });
});
