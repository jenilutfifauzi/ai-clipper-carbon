// How loud a sound is heard in the preview, on the cases the backend's tests read too
// (backend/tests/fixtures/gain_vectors.json), so that the preview's gain and the render's can't
// drift; and the curve a keyed sound's gain node follows from the playhead.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/gain_vectors.json";
import type { AudioEvent, Ease, SegmentPlan } from "../../../api";
import { fadesWithin } from "../advanced/edits";
import { EASE_IN, LINEAR } from "./keyframes";
import { CURVE_RATE, loudness, loudnessCurve, segmentSound, type Heard } from "./loudness";

describe("a sound", () => {
  for (const { name, sound, at, ...of } of cases.sounds) {
    test(`${name}: is as loud as the shared cases say`, () => {
      // Its fades fitted to it as the planner fits a Music Clip's and a Segment's.
      const fades = fadesWithin({ fade_in: sound.fade_in ?? 0, fade_out: sound.fade_out ?? 0 }, sound.end - sound.start);
      const keys: { at: number; value: number; ease?: number[] }[] = sound.keys ?? [];
      const gain = keys.map(({ at, value, ease }) => ({ at, value, ease: (ease ?? LINEAR) as Ease }));
      const event: Heard =
        "item" in of && of.item === "segment"
          ? segmentSound(segment({ start: sound.start, end: sound.end, volume: sound.volume, gain, ...fades }), 1)
          : { id: "m", media: "song", start: sound.start, end: sound.end, offset: 0, volume: sound.volume, gain, ...fades };
      for (const [time, expected] of at) expect(Math.abs(loudness(event, time) - expected), `at ${time}`).toBeLessThan(cases.tolerance);
    });
  }
});

// A Segment of a video as planned, with `fields`.
const segment = (fields: Partial<SegmentPlan>): SegmentPlan => ({
  start: 0,
  end: 1,
  source_start: 0,
  source_end: 1,
  media: "video",
  volume: 1,
  silent: false,
  scenes: 1,
  gain: [],
  id: "v",
  fade_in: 0,
  fade_out: 0,
  ...fields,
});

describe("a Segment's sound", () => {
  test("is a Source Segment's under the Clip's own volume, a video's at its own", () => {
    const source = segmentSound(segment({ media: null, start: 2, end: 6, volume: 0.5, fade_in: 1 }), 1.5);
    expect(loudness(source, 2.5)).toBeCloseTo(0.375, 6);
    expect(loudness(source, 4)).toBeCloseTo(0.75, 6);
    expect(loudness(segmentSound(segment({ start: 2, end: 6, volume: 0.5 }), 1.5), 4)).toBeCloseTo(0.5, 6);
  });

  test("taken away by a Transition, falls with its crossfade, which multiplies its own fade out", () => {
    // Faded out over its last second, which a Transition overlaps.
    const faded = segment({ start: 0, end: 2, fade_out: 1 });
    const taken = segmentSound(faded, 1, { start: 1, end: 2 });
    for (const [time, expected] of [[0.5, 1], [1, 1], [1.25, 0.75 * 0.75], [1.5, 0.25], [2, 0]]) expect(loudness(taken, time)).toBeCloseTo(expected, 6);
    // Unfaded, the crossfade alone.
    expect(loudness(segmentSound({ ...faded, fade_out: 0 }, 1, { start: 1, end: 2 }), 1.5)).toBeCloseTo(0.5, 6);
  });
});

describe("a keyed sound", () => {
  // Heard from 3 to 7 s into the Clip, fading in over 0.5 s and out over 1 s, dipped from 100% 1 s
  // into it to 25% 2 s into it, eased in (the shared cases' "keyed and faded").
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

  test("follows a curve sampled 100 times a second from the playhead to its end", () => {
    const curve = loudnessCurve(dipped, 4.2);
    expect(CURVE_RATE).toBe(100);
    expect(curve.length).toBe(281);
    for (const [i, time] of [[0, 4.2], [30, 4.5], [280, 7]]) expect(curve[i]).toBeCloseTo(loudness(dipped, time), 6);
    // At its very end, two values still.
    expect(loudnessCurve(dipped, 7).length).toBe(2);
    // Its last value, just past its end, is its loudness at its end.
    expect(loudnessCurve({ ...dipped, fade_out: 0 }, 4.205).at(-1)).toBe(0.25);
  });
});
