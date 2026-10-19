// .scratch/captions-advanced/issues/04-tracer-media-words-caption-media-segments.md: while a media
// Segment's Media Words are transcribed, the Advanced Edit marks it and asks for the plan again.
import { describe, expect, test } from "vitest";
import type { WordsStatus } from "../../../api";
import { PENDING_REFRESH_MS, pendingSpans, refreshWhilePending } from "./wordsStatus";

const played = [
  { start: 0, end: 1.5, source_start: 0, source_end: 1.5, media: "red" },
  { start: 1.5, end: 4, source_start: 10, source_end: 12.5 },
  { start: 4, end: 5, source_start: 0, source_end: 1, media: "red" },
];
const segments = [{ id: "i" }, { id: "e" }, { id: "o" }];

describe("pendingSpans", () => {
  test("is where each Segment whose Words are pending plays", () => {
    const status: Record<string, WordsStatus> = { i: "pending", e: "transcript", o: "pending" };
    expect(pendingSpans(played, segments, status)).toEqual([
      { id: "i", start: 0, end: 1.5 },
      { id: "o", start: 4, end: 5 },
    ]);
  });

  test("is empty once their Media Words are there, and without a plan yet", () => {
    expect(pendingSpans(played, segments, { i: "media", e: "clip", o: "media" })).toEqual([]);
    expect(pendingSpans(played, segments, undefined)).toEqual([]);
  });

  test("leaves out a Segment the plan doesn't know yet", () => {
    expect(pendingSpans(played, [{ id: "new" }, ...segments.slice(1)], { i: "pending" })).toEqual([]);
  });
});

describe("refreshWhilePending", () => {
  test("asks for the plan again after a while, only while anything is pending", () => {
    expect(refreshWhilePending({ i: "pending", e: "clip" })).toBe(PENDING_REFRESH_MS);
    expect(refreshWhilePending({ i: "media", e: "clip" })).toBeNull();
    expect(refreshWhilePending(undefined)).toBeNull();
  });
});
