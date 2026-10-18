// A keyed sound in the preview (.scratch/keyframes/issues/03-keyed-volume.md): how loud it is heard,
// as the renderer has it, and the curve its gain node follows from the playhead.
import { describe, expect, test } from "vitest";
import type { AudioEvent } from "../../../api";
import { EASE_IN, LINEAR } from "./keyframes";
import { CURVE_RATE, loudness, loudnessCurve } from "./loudness";

// Heard from 3 to 7 s into the Clip, fading in over 0.5 s and out over 1 s, dipped from 100% 1 s
// into it to 25% 2 s into it, eased in (backend/tests/test_keyed_volume.py's).
const dipped: AudioEvent = {
  id: "m",
  media: "song",
  start: 3,
  end: 7,
  offset: 0,
  volume: 0.5,
  fade_in: 0.5,
  fade_out: 1,
  gain: [
    { at: 1, value: 1, ease: LINEAR },
    { at: 2, value: 0.25, ease: EASE_IN },
  ],
};

describe("a keyed sound", () => {
  test("is as loud as its volume Keyframes, in its own seconds, times its fades", () => {
    expect(loudness(dipped, 3.25)).toBeCloseTo(0.5);
    expect(loudness(dipped, 4)).toBe(1);
    // Half way, eased in: 1 - 0.75 · 0.3153.
    expect(loudness(dipped, 4.5)).toBeCloseTo(0.7635, 3);
    expect(loudness(dipped, 5.5)).toBe(0.25);
    expect(loudness(dipped, 6.5)).toBeCloseTo(0.125);
    // Without Keyframes, its volume.
    expect(loudness({ ...dipped, gain: [] }, 4)).toBe(0.5);
  });

  test("follows a curve sampled 100 times a second from the playhead to its end", () => {
    const curve = loudnessCurve(dipped, 4.2);
    expect(CURVE_RATE).toBe(100);
    expect(curve.length).toBe(281);
    for (const [i, time] of [[0, 4.2], [30, 4.5], [280, 7]]) expect(curve[i]).toBeCloseTo(loudness(dipped, time), 6);
    // At its very end, two values still.
    expect(loudnessCurve(dipped, 7).length).toBe(2);
  });
});

// A Muted sound (.scratch/audio-mixing/issues/02-muted-agent-render-preview.md) keeps its volume
// and Keyframes, and isn't heard.
describe("a Muted sound", () => {
  test("is silent at every time, keyed or not, and follows a curve of silence", () => {
    for (const event of [dipped, { ...dipped, gain: [] }]) {
      const muted = { ...event, muted: true };
      for (let time = 2.5; time <= 7.5; time += 0.25) expect(loudness(muted, time)).toBe(0);
      expect(loudnessCurve(muted, 4).every((gain) => gain === 0)).toBe(true);
    }
    // Unmuted, it is heard as it was.
    expect(loudness({ ...dipped, muted: false }, 4)).toBe(1);
  });
});
