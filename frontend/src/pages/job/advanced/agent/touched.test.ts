// .scratch/agent-mode/issues/09-presence-timeline.md (ADR 0029): what a Revision changed, as the diff of
// the edits before and after it, by item id per kind; changes with no id as named flags.
import { describe, expect, test } from "vitest";
import type { MusicClip, TextLayer } from "../../../../api";
import { NEUTRAL_GRADE } from "../../editor/grading";
import type { AdvancedEdits } from "../edits";
import { touchedItems, touchedTarget } from "./touched";

const segment = (id: string, start: number, end: number) => ({ id, start, end });
const text = (id: string, start: number) => ({ id, start, secs: 2, text: "Hi" }) as TextLayer;
const song = (id: string, start: number) => ({ id, start, secs: 5 }) as MusicClip;

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [song("m1", 0)],
    source_volume: 1,
    // Played back to back: s1 from 0 to 10 s, s2 from 10 to 15 s.
    segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
    overlays: [],
    transitions: [],
    grade: NEUTRAL_GRADE,
    adjustment_layers: [],
    ...changes,
  };
}

describe("touchedItems", () => {
  test("equal edits touch nothing, even as copies", () => {
    expect(touchedItems(edits(), structuredClone(edits()))).toEqual({ items: [], flags: [] });
  });

  test("an added Text Layer, a trimmed Segment and a removed Music Clip come back as such", () => {
    const before = edits();
    const after = edits({ text_layers: [text("t1", 4)], segments: [segment("s1", 100, 108), segment("s2", 200, 205)], music: [] });
    expect(touchedItems(before, after).items).toEqual([
      { kind: "segments", id: "s1", how: "changed" },
      { kind: "text_layers", id: "t1", how: "added" },
      { kind: "music", id: "m1", how: "removed" },
    ]);
  });

  test("a changed grade, hook and cue edits come back as flags, with no item", () => {
    const after = edits({
      grade: { ...NEUTRAL_GRADE, adjust: { ...NEUTRAL_GRADE.adjust, temperature: 9000 } },
      hook_text: "New hook",
      cue_edits: [{ key: "c1", start: 1, end: 2 }] as unknown as AdvancedEdits["cue_edits"],
    });
    expect(touchedItems(edits(), after)).toEqual({ items: [], flags: ["hook", "cues", "grade"] });
  });

  test("a Transition is named by the Segment it follows", () => {
    const after = edits({ transitions: [{ after: "s1", kind: "fade", secs: 0.5 }] as AdvancedEdits["transitions"] });
    expect(touchedItems(edits(), after).items).toEqual([{ kind: "transitions", id: "s1", how: "added" }]);
  });
});

describe("touchedTarget", () => {
  test("is the first touched item, at its Timeline time", () => {
    const before = edits();
    const after = edits({ segments: [segment("s1", 100, 110), segment("s2", 201, 205)], text_layers: [text("t1", 4)] });
    expect(touchedTarget(touchedItems(before, after), before, after)).toEqual({ kind: "segments", id: "s2", time: 10 });
  });

  test("a removed item is where it was", () => {
    const before = edits({ text_layers: [text("t1", 7)] });
    expect(touchedTarget(touchedItems(before, edits()), before, edits())).toEqual({ kind: "text_layers", id: "t1", time: 7 });
  });

  test("the hook is at its start; other flags have no place", () => {
    const after = edits({ hook_start: 2, hook_text: "x" });
    expect(touchedTarget(touchedItems(edits(), after), edits(), after)).toEqual({ kind: "hook", id: "hook", time: 2 });
    const graded = edits({ layout: "split" as AdvancedEdits["layout"] });
    expect(touchedTarget(touchedItems(edits(), graded), edits(), graded)).toBeNull();
  });
});
