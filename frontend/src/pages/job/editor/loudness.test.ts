// How loud a sound is heard in the preview, on the cases the backend's tests read too
// (backend/tests/fixtures/gain_vectors.json), so that the preview's gain and the render's can't
// drift; and the curve a keyed sound's gain node follows from the playhead.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/gain_vectors.json";
import type { AudioEvent, Ease } from "../../../api";
import { fadesWithin } from "../advanced/edits";
import { EASE_IN, LINEAR } from "./keyframes";
import { CURVE_RATE, loudness, loudnessCurve } from "./loudness";

describe("a sound", () => {
  for (const { name, sound, at } of cases.sounds) {
    test(`${name}: is as loud as the shared cases say`, () => {
      // Its fades fitted to it as the planner fits a Music Clip's.
      const fades = fadesWithin({ fade_in: sound.fade_in ?? 0, fade_out: sound.fade_out ?? 0 }, sound.end - sound.start);
      const gain = (sound.keys ?? []).map(({ at, value, ease }) => ({ at, value, ease: (ease ?? LINEAR) as Ease }));
      const event: AudioEvent = { id: "m", media: "song", start: sound.start, end: sound.end, offset: 0, volume: sound.volume, gain, ...fades };
      for (const [time, expected] of at) expect(Math.abs(loudness(event, time) - expected), `at ${time}`).toBeLessThan(cases.tolerance);
    });
  }
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
