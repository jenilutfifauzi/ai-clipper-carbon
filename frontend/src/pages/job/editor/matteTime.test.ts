// Which frame of which Matte piece shows a time into a cut-out Segment (docs/adr/0015), on the cases
// the backend's tests read too (backend/tests/fixtures/matte_frames.json), so that the two can't drift.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/matte_frames.json";
import { matteAt, matteFrame, matteSeek, segmentMatte } from "./matteTime";
import type { SegmentRange } from "./segmentTime";

describe("a cut-out Segment's Matte", () => {
  for (const { name, fps, segment, offset, source, piece, frame } of cases.cases) {
    test(`${name}: shows the frame of the piece the shared cases say`, () => {
      expect(segmentMatte(segment as SegmentRange, offset, fps)).toEqual({ piece, frame });
      expect(matteFrame(source, fps)).toEqual({ piece, frame });
    });
  }

  test("is found only in the pieces the plan lists", () => {
    expect(matteAt(12, 30, [10, 20])).toEqual({ piece: 10, frame: 60 });
    expect(matteAt(32, 30, [10, 20])).toBeNull();
  });

  test("is sought in the middle of its frame, so that the frame shown is it", () => {
    expect(matteSeek(0, 30)).toBeCloseTo(1 / 60);
    expect(matteSeek(60, 30)).toBeCloseTo(2 + 1 / 60);
  });
});
