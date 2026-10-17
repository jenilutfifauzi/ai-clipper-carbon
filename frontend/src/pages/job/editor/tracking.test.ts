// .scratch/text-advanced/issues/13-hook-and-caption-tracking-and-line-height.md: the preview measures
// and places tracked hook and caption lines as the planner and the renderer do.
import { describe, expect, test } from "vitest";
import { trackedWidth, trackedX, wordSpan } from "./tracking";

// Every character 10 px wide.
const width = (text: string) => [...text].length * 10;

describe("tracking", () => {
  test("widens a line by its tracking after every character but the last", () => {
    expect(trackedWidth("HALO", width, 6)).toBe(40 + 3 * 6);
    expect(trackedWidth("HALO", width, -2)).toBe(40 - 3 * 2);
    expect(trackedWidth("HALO", width, 0)).toBe(40);
    expect(trackedWidth("", width, 6)).toBe(0);
  });

  test("moves a centred line half its tracking right, as libass and the browser add it after the last character too", () => {
    expect(trackedX(540, 12)).toBe(546);
    expect(trackedX(540, 0)).toBe(540);
  });

  test("puts a word's highlight box after the tracked words before it", () => {
    // "HALO SEMUA APA": SEMUA starts after "HALO " (5 characters, each followed by tracking).
    expect(wordSpan(["HALO", "SEMUA", "APA"], 1, width, 4)).toEqual({ before: 50 + 5 * 4, word: 50 + 4 * 4, line: 140 + 13 * 4 });
    expect(wordSpan(["HALO", "SEMUA", "APA"], 0, width, 4).before).toBe(0);
    expect(wordSpan(["HALO", "SEMUA"], 1, width, 0)).toEqual({ before: 50, word: 50, line: 100 });
  });
});
