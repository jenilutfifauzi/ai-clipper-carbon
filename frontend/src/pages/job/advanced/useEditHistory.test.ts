// The edit history's merge rule (.scratch/timeline-visuals/spec.md, "Undo: one gesture is one step"):
// whether a change joins the last step of the history, as worked examples of groups and times.
import { describe, expect, test } from "vitest";
import { merges } from "./useEditHistory";

describe("merges", () => {
  test("a gesture group merges across a 2-second pause", () => {
    expect(merges({ group: "drag:7", at: 1000 }, "drag:7", 3000)).toBe(true);
    expect(merges({ group: "drag:7", at: 1000 }, "drag:7", 61_000)).toBe(true);
  });

  test("a slider group merges within 1500 ms and splits after", () => {
    expect(merges({ group: "music:m1:volume", at: 1000 }, "music:m1:volume", 2400)).toBe(true);
    expect(merges({ group: "music:m1:volume", at: 1000 }, "music:m1:volume", 2600)).toBe(false);
  });

  test("arrow-key moves keep the 1500 ms window", () => {
    expect(merges({ group: "key:move", at: 1000 }, "key:move", 2000)).toBe(true);
    expect(merges({ group: "key:move", at: 1000 }, "key:move", 3000)).toBe(false);
  });

  test("two different groups never merge", () => {
    expect(merges({ group: "drag:7", at: 1000 }, "drag:8", 1010)).toBe(false);
    expect(merges({ group: "music:m1:volume", at: 1000 }, "music:m1:fade_in", 1010)).toBe(false);
    expect(merges({ group: "drag:7", at: 1000 }, "key:move", 1010)).toBe(false);
  });

  test("no group never merges", () => {
    expect(merges({ group: "drag:7", at: 1000 }, undefined, 1010)).toBe(false);
    expect(merges(null, undefined, 1010)).toBe(false);
  });

  test("nothing to merge into after an undo, a redo or a change without a group", () => {
    expect(merges(null, "drag:7", 1010)).toBe(false);
  });
});
