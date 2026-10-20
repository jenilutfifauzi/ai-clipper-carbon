// One key for Word Edits, Cue Edits and Cues: a time on a timeline, to the millisecond (ADR 0020).
import { describe, expect, test } from "vitest";
import { byKey, keyText, sameKey, segmentHolds } from "./timelineKey";

describe("a timeline key", () => {
  test("is one time of one timeline, to the millisecond", () => {
    expect(sameKey({ at: 1.2341 }, { at: 1.2338, media: null })).toBe(true);
    expect(sameKey({ at: 1.234 }, { at: 1.235 })).toBe(false);
    expect(sameKey({ at: 1.234, media: "a" }, { at: 1.234 })).toBe(false);
    expect(keyText({ at: 1.2341 })).toBe(keyText({ at: 1.2338, media: null }));
    expect(keyText({ at: 1.5, media: "a" })).toBe("a@1.500");
  });

  test("orders as the backend saves them: the Source's first, then each item's, each in time order", () => {
    const keys = [{ at: 3, media: "b" }, { at: 2 }, { at: 1, media: "a" }, { at: 5, media: null }, { at: 0, media: "b" }];
    expect([...keys].sort(byKey)).toEqual([{ at: 2 }, { at: 5, media: null }, { at: 1, media: "a" }, { at: 0, media: "b" }, { at: 3, media: "b" }]);
  });

  test("is held by a Segment of its timeline whose range holds its time", () => {
    const segment = { start: 10, end: 20, media: "a" };
    expect(segmentHolds(segment, { at: 20, media: "a" })).toBe(true);
    expect(segmentHolds(segment, { at: 15 })).toBe(false);
    expect(segmentHolds({ start: 10, end: 20 }, { at: 15, media: null })).toBe(true);
  });
});
