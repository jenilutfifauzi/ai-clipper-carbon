// Which frame of which Matte piece shows a time into a cut-out Segment (docs/adr/0015), on the cases
// the backend's tests read too (backend/tests/fixtures/matte_frames.json), so that the two can't drift.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/matte_frames.json";
import type { MatteCopy, MattePiece } from "../../../api";
import { copyClock, copyFrame, itemPieces, matteAt, matteCopyOf, matteFrame, matteSeek, segmentMatte, SOURCE_CLOCK } from "./matteTime";
import type { SegmentRange } from "./segmentTime";

describe("a cut-out Segment's Matte", () => {
  for (const { name, fps, segment, offset, source, piece, frame, pieces } of cases.cases) {
    test(`${name}: shows the frame of the piece the shared cases say`, () => {
      expect(segmentMatte(segment as SegmentRange, offset, fps)).toEqual({ piece, frame });
      expect(matteFrame(source, fps)).toEqual({ piece, frame });
      // One of the pieces the plan lists for the Segment.
      expect(matteAt(source, fps, pieces)).toEqual({ piece, frame });
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

describe("a cut-out Segment played from a Retimed copy follows it", () => {
  const copy: MatteCopy = { start: 8, end: 16, url: "/media/j/mattes/person-v/reversed-full-6000-16000.mp4", at: 0 };

  test("held on the Source until its copy is made", () => {
    expect(copyClock({ start: 8, end: 16, reverse: true }, { start: 8, end: 16, reverse: true }, null, copy)).toBe(SOURCE_CLOCK);
  });

  test("at a Speed a browser won't play, the Source time its retimed copy shows, at its Speed", () => {
    // The copy of 6..16 s at 8x: 2 s into the copy at its start, 1 s further is 8 s of the Source on.
    const clock = copyClock({ start: 8, end: 16, speed: 8 }, { start: 6, end: 16, reverse: false, speed: 8 }, 0.25, null)!;
    expect(clock.at(1.25)).toBeCloseTo(16);
    expect([clock.rate, clock.copy]).toEqual([8, null]);
  });

  test("in Reverse, its reversed Matte copy, from where it shows the range, alike", () => {
    const wider = { ...copy, at: 2 };
    const clock = copyClock({ start: 8, end: 14, reverse: true }, { start: 8, end: 14, reverse: true }, 0.5, wider)!;
    expect(clock.at(0.5)).toBeCloseTo(2);
    expect(clock.at(1.5)).toBeCloseTo(3);
    expect([clock.rate, clock.copy]).toEqual([1, wider.url]);
    expect(copyFrame(clock.at(1.5), 30)).toEqual({ piece: 0, frame: 90 });
    // Retimed at 8x as well: 8 s of the Matte copy a second.
    expect(copyClock({ start: 8, end: 16, reverse: true, speed: 8 }, { start: 8, end: 16, reverse: true, speed: 8 }, 0, copy)!.at(0.5)).toBeCloseTo(4);
    // Nothing to cut it by until the plan lists its copy.
    expect(copyClock({ start: 8, end: 14, reverse: true }, { start: 8, end: 14, reverse: true }, 0.5, null)).toBeNull();
  });

  test("its reversed Matte copy is the plan's for its range", () => {
    expect(matteCopyOf([copy], { start: 8, end: 16, reverse: true })).toBe(copy);
    expect(matteCopyOf([copy], { start: 8, end: 15, reverse: true })).toBeNull();
  });
});

describe("a Media Library item's Matte (background-removal 06)", () => {
  const source: MattePiece = { start: 0, url: "/media/j/mattes/person-v-0.mp4" };
  const video: MattePiece = { start: 0, url: "/api/media/v/mattes/person-v-0.mp4", media: "v" };
  const image: MattePiece = { start: 0, url: "/api/media/i/mattes/person-v.png", media: "i" };

  test("is read in its own pieces, apart from the Source's", () => {
    expect(itemPieces([source, video, image])).toEqual([source]);
    expect(itemPieces([source, video, image], "v")).toEqual([video]);
    expect(itemPieces(undefined, "i")).toEqual([]);
  });

  test("its reversed copy is the plan's for its item and range", () => {
    const own: MatteCopy = { start: 1, end: 3, url: "/api/media/v/mattes/person-v/reversed-full-1000-3000.mp4", at: 0, media: "v" };
    const sourceCopy: MatteCopy = { ...own, url: "/media/j/mattes/x.mp4", media: null };
    expect(matteCopyOf([sourceCopy, own], { start: 1, end: 3, reverse: true }, "v")).toBe(own);
    expect(matteCopyOf([sourceCopy, own], { start: 1, end: 3, reverse: true })).toBe(sourceCopy);
    expect(matteCopyOf([own], { start: 1, end: 3, reverse: true }, "w")).toBeNull();
  });
});
