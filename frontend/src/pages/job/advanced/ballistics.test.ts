// .scratch/audio-mixing/issues/13-meters.md: the Meters' ballistics. A bar rises at once and falls
// 24 dB a second, its peak is held for 1.5 s, and a sample at full scale latches the clip light until
// it is clicked.
import { describe, expect, test } from "vitest";
import { clearClip, decibels, FLOOR_DB, heldPeak, meterStep, QUIET, settled, type Meter } from "./ballistics";

// `meter` after `seconds` of silence, a frame at a time.
function silence(meter: Meter, seconds: number, frame = 1 / 60): Meter {
  let after = meter;
  for (let t = frame; t <= seconds + 1e-9; t += frame) after = meterStep(after, [0, 0], frame);
  return after;
}

describe("the Meters' ballistics", () => {
  test("read a peak in dB from -60 to 0", () => {
    expect(decibels(1)).toBe(0);
    expect(decibels(0.5)).toBeCloseTo(-6.02, 2);
    expect(decibels(0)).toBe(FLOOR_DB);
    expect(decibels(0.0001)).toBe(FLOOR_DB);
    // A mix past full scale stops at the top.
    expect(decibels(2)).toBe(0);
  });

  test("show a peak at once", () => {
    const meter = meterStep(QUIET, [0.5, 0.25], 1 / 60);
    expect(meter.left.level).toBeCloseTo(-6.02, 2);
    expect(meter.right.level).toBeCloseTo(-12.04, 2);
    expect(meter.left.held).toBe(meter.left.level);
  });

  test("fall 24 dB in one second", () => {
    const loud = meterStep(QUIET, [1, 0.5], 1 / 60);
    const after = silence(loud, 1);
    expect(after.left.level).toBeCloseTo(-24, 5);
    expect(after.right.level).toBeCloseTo(-6.02 - 24, 2);
    // A louder peak while falling shows at once again.
    expect(meterStep(after, [1, 1], 1 / 60).left.level).toBe(0);
  });

  test("hold the peak for 1.5 s, then let it fall", () => {
    const loud = meterStep(QUIET, [0.5, 0.5], 1 / 60);
    const held = silence(loud, 1.5);
    expect(held.left.held).toBeCloseTo(-6.02, 2);
    expect(heldPeak(held)).toBe(-6);
    const falling = silence(held, 0.5);
    expect(falling.left.held).toBeCloseTo(-6.02 - 12, 1);
    // Never under its bar.
    expect(falling.left.held).toBeGreaterThanOrEqual(falling.left.level);
  });

  test("show the held peak in whole dB, the louder side's, or none when quiet", () => {
    expect(heldPeak(QUIET)).toBeNull();
    expect(heldPeak(meterStep(QUIET, [0.3, 0.6], 1 / 60))).toBe(-4);
  });

  test("latch the clip light at a sample of 1.0 until it is cleared", () => {
    expect(meterStep(QUIET, [0.99, 0.99], 1 / 60).clipped).toBe(false);
    const clipped = meterStep(QUIET, [0.2, 1], 1 / 60);
    expect(clipped.clipped).toBe(true);
    const later = silence(clipped, 10);
    expect(later.clipped).toBe(true);
    expect(clearClip(later).clipped).toBe(false);
    expect(clearClip(later).left).toBe(later.left);
  });

  test("settle once the bars and the held peaks are down", () => {
    expect(settled(QUIET)).toBe(true);
    const loud = meterStep(QUIET, [1, 1], 1 / 60);
    expect(settled(loud)).toBe(false);
    // 60 dB at 24 dB/s after the 1.5 s hold: 4 s.
    expect(settled(silence(loud, 3.9))).toBe(false);
    expect(settled(silence(loud, 4.1))).toBe(true);
  });
});
