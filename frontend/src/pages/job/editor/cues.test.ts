// .scratch/captions-advanced/issues/01-cues-in-the-render-plan-prefactor.md: the plan's captions are
// Cues of lines, which the preview and the Timelines read as the renderer draws them.
import { describe, expect, test } from "vitest";
import type { Cue } from "../../../api";
import { cueLineMiddle, cueText, cueWordAt, cueWords } from "./cues";

const word = (text: string, start: number) => ({ text, start, end: start + 0.3 });

const cue = (lines: string[][]): Cue => ({
  start: 0,
  end: 2,
  lines: lines.map((line, row) => line.map((text, i) => word(text, row + i * 0.3))),
  plain: lines.map((line) => line.join(" ").toLowerCase()),
  area: { x: 40, y: 1296, width: 1000, height: 200 },
  size: 110,
  key: { at: 12.15, media: null },
  edited: false,
  joinable: false,
});

describe("a Cue", () => {
  test("reads as its Words, line after line, on one row", () => {
    const two = cue([["HALO", "SEMUA"], ["APA", "KABAR"]]);
    expect(cueWords(two).map((w) => w.text)).toEqual(["HALO", "SEMUA", "APA", "KABAR"]);
    expect(cueText(two)).toBe("HALO SEMUA APA KABAR");
    expect(cueText(cue([["HALO", "SEMUA"]]))).toBe("HALO SEMUA");
  });

  test("finds the line of a Word counted across its lines", () => {
    const two = cue([["HALO", "SEMUA"], ["APA"]]);
    expect([0, 1, 2].map((i) => cueWordAt(two, i))).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  test("sets its lines one font size apart about its area's middle, as libass does", () => {
    // One line: on the area's middle, as a caption line is today.
    expect(cueLineMiddle(cue([["HALO"]]), 0)).toBe(1396);
    const two = cue([["HALO"], ["SEMUA"]]);
    expect([cueLineMiddle(two, 0), cueLineMiddle(two, 1)]).toEqual([1396 - 55, 1396 + 55]);
  });
});
