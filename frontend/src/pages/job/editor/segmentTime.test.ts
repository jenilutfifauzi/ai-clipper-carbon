// The mapping between Timeline time and Source time per Segment (docs/adr/0009), on the cases the
// backend's tests read too (backend/tests/fixtures/segment_times.json), so that the two can't drift.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/segment_times.json";
import { offsetAt, overlayTime, playedSourceAt, playedTimeAt, playedUntil, segmentLength, sourceAt, trackLength, type SegmentRange } from "./segmentTime";

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(cases.tolerance);

describe("a Segment", () => {
  for (const { name, segment, length, at } of cases.segments) {
    const range = segment as SegmentRange;

    test(`${name}: its Timeline length is as the shared cases say`, () => close(segmentLength(range), length));

    test(`${name}: Timeline time maps to Source time and back`, () => {
      for (const [offset, source] of at) {
        close(sourceAt(range, offset), source);
        // A held Segment shows its one frame all along: it is placed at its start.
        close(offsetAt(range, source), range.hold != null ? 0 : offset);
      }
    });
  }

  test("as played, maps from its start on the Timeline", () => {
    const played = { start: 4, end: 6, source_start: 10, source_end: 14, speed: 2 };
    expect(playedSourceAt(played, 5)).toBe(12);
    expect(playedTimeAt(played, 12)).toBe(5);
  });

  test("cut short where a Transition starts keeps the range it shows until then", () => {
    const played = { start: 4, end: 6, source_start: 10, source_end: 14, speed: 2 };
    expect(playedUntil(played, 5)).toEqual({ ...played, end: 5, source_end: 12 });
    expect(playedUntil({ ...played, reverse: true }, 5)).toEqual({ ...played, reverse: true, end: 5, source_start: 12 });
    expect(playedUntil({ start: 4, end: 6, source_start: 10, source_end: 10, hold: 2 }, 5)).toEqual({ start: 4, end: 5, source_start: 10, source_end: 10, hold: 1 });
  });
});

describe("an Overlay", () => {
  for (const { name, overlay, range, ...cut } of cases.overlays) {
    test(`${name}: reads the range of its video the shared cases say`, () => {
      const time = overlayTime(overlay, "video" in cut ? cut.video : undefined, "shown" in cut ? cut.shown : undefined);
      close(time.start, range[0]);
      close(time.end, range[1]);
      expect([time.speed, time.reverse]).toEqual([overlay.speed ?? 1, overlay.reverse ?? false]);
    });
  }
});

describe("a Main Track", () => {
  for (const { name, segments, transitions, length } of cases.main_tracks) {
    test(`${name}: lasts its Segments less their Transitions' overlaps`, () => {
      const joins = segments.map((segment) => transitions.find((transition) => transition.after === segment.id)?.secs ?? null);
      close(trackLength(segments as SegmentRange[], joins), length);
    });
  }
});
