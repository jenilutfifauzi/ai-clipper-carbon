// Seam E (.scratch/navigation-playback/spec.md): where the Loop Region starts Play and where it
// wraps to, as worked examples of times in and times out.
import { describe, expect, test } from "vitest";
import { loopStart, wrapTarget } from "./loop";

describe("the Loop Region", () => {
  test("Play starts at the playhead inside the Region, and at In outside it", () => {
    const region = { in: 2, out: 4 };
    expect(loopStart(3, region)).toBe(3);
    expect(loopStart(2, region)).toBe(2);
    // At Out it would wrap at once: from In.
    expect(loopStart(4, region)).toBe(2);
    expect(loopStart(6, region)).toBe(2);
    expect(loopStart(1, region)).toBe(2);
  });

  // Two Source Segments: 0–5 s of the Clip from 100 s of the Source, 5–9 s from 200 s; then 9–12 s
  // of a media video from 10 s into it.
  const segments = [
    { start: 0, end: 5, source_start: 100 },
    { start: 5, end: 9, source_start: 200 },
    { start: 9, end: 12, source_start: 10, media: "intro" },
  ];

  test("the wrap goes to In: its Segment and its time in the Source", () => {
    expect(wrapTarget({ in: 2, out: 4 }, segments)).toEqual({ index: 0, time: 2, source: 102 });
    expect(wrapTarget({ in: 6, out: 8 }, segments)).toEqual({ index: 1, time: 6, source: 201 });
  });

  test("In at a join wraps to the start of the Segment after it", () => {
    expect(wrapTarget({ in: 5, out: 7 }, segments)).toEqual({ index: 1, time: 5, source: 200 });
  });

  test("In in a media Segment has no time in the Source: the decks don't wait there", () => {
    expect(wrapTarget({ in: 10, out: 11 }, segments)).toEqual({ index: 2, time: 10, source: null });
  });
});
