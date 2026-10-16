// Seam E (.scratch/navigation-playback/spec.md): where the playhead goes on the Clip's frame grid,
// how far the Timeline scrolls to show it, and the Loop Region its marks make, as worked examples of
// times in and times out. Where the Region starts Play and wraps to: ../editor/loop.test.ts.
import { describe, expect, test } from "vitest";
import { lastFrame, loopRegion, onFrame, revealScroll, stepFrames } from "./playhead";

describe("the frame grid", () => {
  // A 10 s Clip, the playhead at 1.23 s: between frames at 25, 30 and 60 fps.
  const clip = (fps: number) => ({ fps, duration: 10 });

  test("at 25 fps, 1.23 s is nearest frame 31: one on is frame 32, ten back frame 21", () => {
    expect(stepFrames(1.23, 1, clip(25))).toBeCloseTo(1.28, 9);
    expect(stepFrames(1.23, -10, clip(25))).toBeCloseTo(0.84, 9);
  });

  test("at 30 fps, 1.23 s is nearest frame 37: one on is frame 38, ten back frame 27", () => {
    expect(stepFrames(1.23, 1, clip(30))).toBeCloseTo(38 / 30, 9);
    expect(stepFrames(1.23, -10, clip(30))).toBeCloseTo(0.9, 9);
  });

  test("at 60 fps, 1.23 s is nearest frame 74: one on is frame 75, ten back frame 64", () => {
    expect(stepFrames(1.23, 1, clip(60))).toBeCloseTo(1.25, 9);
    expect(stepFrames(1.23, -10, clip(60))).toBeCloseTo(64 / 60, 9);
  });

  test("a step stops at 0", () => {
    // 0.1 s is frame 3 at 30 fps: ten back would be frame −7.
    expect(stepFrames(0.1, -10, clip(30))).toBe(0);
    expect(stepFrames(0, -1, clip(30))).toBe(0);
  });

  test("a step stops at the last frame, a frame before the end", () => {
    // 9.9 s is frame 297 at 30 fps: ten on would be frame 307, past frame 299, the last of a 10 s Clip.
    expect(stepFrames(9.9, 10, clip(30))).toBeCloseTo(9.9667, 4);
    expect(stepFrames(10, 1, clip(30))).toBeCloseTo(9.9667, 4);
    expect(stepFrames(9.9, 1, clip(30))).toBeCloseTo(9.9333, 4);
  });

  test("End on a 10 s Clip at 30 fps is 9.9667", () => {
    expect(lastFrame(10, 30)).toBeCloseTo(9.9667, 4);
    expect(lastFrame(10, 25)).toBeCloseTo(9.96, 9);
  });

  test("the last frame of a Clip that ends between frames is the last one wholly in it", () => {
    // 10.01 s at 30 fps: frame 300 begins at 10 s but is cut short, so frame 299 is the last.
    expect(lastFrame(10.01, 30)).toBeCloseTo(9.9667, 4);
    // 10.04 s: frame 300 runs to 10.0333 s, inside it.
    expect(lastFrame(10.04, 30)).toBeCloseTo(10, 9);
    // A Clip shorter than a frame has only its first.
    expect(lastFrame(0.02, 30)).toBe(0);
  });

  test("a time is drawn on its nearest frame", () => {
    expect(onFrame(1.23, 30)).toBeCloseTo(37 / 30, 9);
    expect(onFrame(1.23, 25)).toBeCloseTo(1.24, 9);
    expect(onFrame(2, 60)).toBe(2);
  });
});

describe("keeping the playhead in view", () => {
  // The Timeline shows 400 to 1400 px from 0 s.
  const view = { scroll: 400, width: 1000 };

  test("a playhead in view leaves the scroll as it is, even at the very edge", () => {
    expect(revealScroll(900, view)).toBe(400);
    expect(revealScroll(400, view)).toBe(400);
    expect(revealScroll(1400, view)).toBe(400);
  });

  test("past the right edge, it scrolls to bring the playhead 48 px inside it", () => {
    expect(revealScroll(1401, view)).toBe(449);
    expect(revealScroll(5000, view)).toBe(4048);
  });

  test("before the left edge, it scrolls to bring the playhead 48 px inside it, but not before 0 s", () => {
    expect(revealScroll(399, view)).toBe(351);
    expect(revealScroll(20, view)).toBe(0);
  });

  test("a narrow Timeline keeps it a quarter of its width inside", () => {
    // 100 px wide: 25 px inside.
    expect(revealScroll(600, { scroll: 400, width: 100 })).toBe(525);
  });
});

describe("the Loop Region", () => {
  // A 10 s Clip at 30 fps: a frame is 1/30 s.
  const clip = { fps: 30, duration: 10 };

  test("marks in order make the Region between them", () => {
    expect(loopRegion({ in: 2, out: 4 }, clip)).toEqual({ in: 2, out: 4 });
  });

  test("crossed marks swap", () => {
    expect(loopRegion({ in: 4, out: 2 }, clip)).toEqual({ in: 2, out: 4 });
  });

  test("marks past the Clip clamp inside it", () => {
    expect(loopRegion({ in: -1, out: 12 }, clip)).toEqual({ in: 0, out: 10 });
    expect(loopRegion({ in: 8, out: 15 }, clip)).toEqual({ in: 8, out: 10 });
  });

  test("marks closer than a frame are a frame apart, still inside the Clip", () => {
    const at = loopRegion({ in: 3, out: 3 }, clip)!;
    expect(at.in).toBe(3);
    expect(at.out).toBeCloseTo(3 + 1 / 30, 9);
    // Both at the end: the Region is the last frame.
    const end = loopRegion({ in: 10, out: 10 }, clip)!;
    expect(end.in).toBeCloseTo(10 - 1 / 30, 9);
    expect(end.out).toBe(10);
  });

  test("a Clip edited shorter clamps the marks again", () => {
    // Marked 8–12 s on a Clip now 6 s long: both past it, so the Region is its last frame.
    const shorter = loopRegion({ in: 8, out: 12 }, { fps: 30, duration: 6 })!;
    expect(shorter.in).toBeCloseTo(6 - 1 / 30, 9);
    expect(shorter.out).toBe(6);
    expect(loopRegion({ in: 2, out: 12 }, { fps: 30, duration: 6 })).toEqual({ in: 2, out: 6 });
  });

  test("a missing mark is the Clip's start (In) or its end (Out); with none, there is no Region", () => {
    expect(loopRegion({ in: 2, out: null }, clip)).toEqual({ in: 2, out: 10 });
    expect(loopRegion({ in: null, out: 4 }, clip)).toEqual({ in: 0, out: 4 });
    expect(loopRegion({ in: null, out: null }, clip)).toBeNull();
  });
});
