// The edit history's merge rule (.scratch/timeline-visuals/spec.md, "Undo: one gesture is one step"):
// whether a change joins the last step of the history, as worked examples of groups and times.
import { describe, expect, test } from "vitest";
import { adopted, merges, redone, undone, type Steps } from "./useEditHistory";

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

// .scratch/agent-mode/issues/08 (ADR 0028): a Revision the Agent saved for this tab's turn is taken as
// an undo step of its own.
describe("adopted", () => {
  const mine: Steps<string> = { past: ["original"], value: "mine", future: [] };

  test("undo returns the value before it and redo brings it back", () => {
    const taken = adopted(mine, "agent's");
    expect(taken.value).toBe("agent's");
    const back = undone(taken);
    expect(back?.value).toBe("mine");
    expect(redone(back!)?.value).toBe("agent's");
  });

  test("it is a step of its own: a second undo reaches the owner's edits before it", () => {
    const twice = adopted(adopted(mine, "agent one"), "agent two");
    expect(undone(undone(twice)!)?.value).toBe("mine");
    expect(undone(undone(undone(twice)!)!)?.value).toBe("original");
  });

  test("it drops what was left to redo, as any new step", () => {
    const afterUndo = undone(mine)!;
    expect(afterUndo.future).toEqual(["mine"]);
    expect(adopted(afterUndo, "agent's").future).toEqual([]);
  });
});
