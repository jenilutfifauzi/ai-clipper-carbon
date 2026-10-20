// .scratch/captions-advanced/issues/02-caption-style-in-the-advanced-edit.md: the Caption Style panel
// and the Preset bar in the Advanced Edit's inspector write the Candidate's Style Preset and Style
// Overrides through its edits, each change one step of undo; a locked Captions Track refuses them.
import { describe, expect, test } from "vitest";
import type { CaptionStyle, HookStyle, StylePreset, WatermarkStyle } from "../../../api";
import { LINE_LIMITS } from "../editor/lineLimits";
import { mergeEdits } from "../editor/merge";
import { styleControls, type StyleDraft } from "../editor/useStyleDraft";
import { restyleCaptions } from "./actions";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { merges, redone, stepped, undone, type Steps } from "./useEditHistory";

const caption = { font: "montserrat-extrabold", size: 80, colour: "#FFFFFF", active_colour: "#FFE14D", position: "auto", y: 1300, x: null } as unknown as CaptionStyle;
const preset = (id: string, size: number): StylePreset => ({
  id,
  name: id,
  caption: { ...caption, size },
  hook: {} as HookStyle,
  watermark: {} as WatermarkStyle,
  join_transition: null,
  builtin: true,
});
const PRESETS = [preset("default", 80), preset("bold", 120)];

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [], cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [{ id: "s1", start: 100, end: 110 }],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

/**
 * The Advanced Edit's history with the panel wired to it as the workspace wires it: each change the
 * controls make goes through restyleCaptions and becomes a step (or joins the last, by its group).
 */
function workspace(start: AdvancedEdits, locked: ("captions" | "text")[] = []) {
  let steps: Steps<AdvancedEdits> = { past: [], value: start, future: [] };
  let last: { group: string; at: number } | null = null;
  let now = 0;
  const pick: Pick = { kind: "captions" };
  return {
    get edits() {
      return steps.value;
    },
    get steps() {
      return steps.past.length;
    },
    controls() {
      const draft: StyleDraft = { preset_id: steps.value.preset_id, style_overrides: steps.value.style_overrides };
      return styleControls(PRESETS, draft, (next, group) => {
        const outcome = restyleCaptions({ edits: steps.value, pick, locked }, next);
        if (!outcome) return;
        const merge = merges(last, group, now);
        last = group === undefined ? null : { group, at: now };
        steps = stepped(steps, outcome.edits, merge);
      }, () => {});
    },
    wait(ms: number) {
      now += ms;
    },
    undo() {
      last = null;
      steps = undone(steps) ?? steps;
    },
    redo() {
      last = null;
      steps = redone(steps) ?? steps;
    },
  };
}

describe("the Caption Style in the Advanced Edit", () => {
  test("a field set in the panel writes the captions' Style Override, and undo takes it back", () => {
    const space = workspace(edits());
    space.controls().set("caption", "colour", "#FF0000");
    expect(space.edits.style_overrides.caption).toEqual({ colour: "#FF0000" });
    expect(space.steps).toBe(1);
    space.undo();
    expect(space.edits.style_overrides.caption).toEqual({});
    space.redo();
    expect(space.edits.style_overrides.caption).toEqual({ colour: "#FF0000" });
  });

  test("a slider dragged is one step; another field, or a later drag, is another", () => {
    const space = workspace(edits());
    for (const size of [90, 100, 110]) {
      space.controls().set("caption", "size", size);
      space.wait(100);
    }
    expect(space.edits.style_overrides.caption).toEqual({ size: 110 });
    expect(space.steps).toBe(1);
    space.controls().set("caption", "colour", "#00FF00");
    expect(space.steps).toBe(2);
    space.wait(2000);
    space.controls().set("caption", "size", 60);
    expect(space.steps).toBe(3);
    space.undo();
    space.undo();
    expect(space.edits.style_overrides.caption).toEqual({ size: 110 });
  });

  test("Sentence fills the line limits in one undoable step", () => {
    const space = workspace(edits());
    space.controls().setMany("caption", LINE_LIMITS.sentence);
    expect(space.controls().caption).toMatchObject(LINE_LIMITS.sentence);
    expect(space.steps).toBe(1);
    space.undo();
    expect(space.edits.style_overrides.caption).toEqual({});
  });

  test("a value equal to the Preset's removes the override", () => {
    const space = workspace(edits({ style_overrides: { caption: { size: 100 }, hook: {}, watermark: {} } }));
    space.controls().set("caption", "size", 80);
    expect(space.edits.style_overrides.caption).toEqual({});
  });

  test("picking a Preset sets preset_id and clears the overrides, in one undoable step", () => {
    const before = edits({ style_overrides: { caption: { colour: "#FF0000", position: "custom", y: 900 }, hook: {}, watermark: {} } });
    const space = workspace(before);
    space.controls().pick("bold");
    expect(space.edits.preset_id).toBe("bold");
    expect(space.edits.style_overrides).toEqual({ caption: {}, hook: {}, watermark: {} });
    expect(space.controls().caption.size).toBe(120);
    space.undo();
    expect(space.edits).toEqual(before);
  });

  test("a Preset saved moves the Candidate onto it", () => {
    const space = workspace(edits({ style_overrides: { caption: { size: 150 }, hook: {}, watermark: {} } }));
    const mine = { ...preset("mine", 150), builtin: false };
    space.controls().saved(mine, [...PRESETS, mine]);
    expect(space.edits.preset_id).toBe("mine");
    expect(space.edits.style_overrides.caption).toEqual({});
  });

  test("the rest of the edits are kept", () => {
    const space = workspace(edits({ hook_text: "Kept", word_edits: [{ at: 101, text: "hi" }] as AdvancedEdits["word_edits"] }));
    space.controls().set("caption", "uppercase", true);
    expect(space.edits.hook_text).toBe("Kept");
    expect(space.edits.word_edits).toEqual([{ at: 101, text: "hi" }]);
  });

  test("merged onto another editor's Revision: their change to another Style Override field survives, and mine", () => {
    const base = edits({ style_overrides: { caption: { size: 100 }, hook: {}, watermark: {} } });
    const space = workspace(base);
    space.controls().set("caption", "colour", "#FF0000");
    const theirs = edits({ style_overrides: { caption: { size: 100, uppercase: true }, hook: { size: 70 }, watermark: {} } });
    const { merged, collisions } = mergeEdits(base, space.edits, theirs);
    expect(merged.style_overrides).toEqual({ caption: { size: 100, colour: "#FF0000", uppercase: true }, hook: { size: 70 }, watermark: {} });
    expect(collisions).toEqual([]);
  });

  test("a locked Captions Track refuses every change", () => {
    const space = workspace(edits(), ["captions"]);
    space.controls().set("caption", "size", 120);
    space.controls().pick("bold");
    expect(space.edits).toEqual(edits());
    expect(space.steps).toBe(0);
    expect(restyleCaptions({ edits: edits(), pick: picked(), locked: ["text"] }, { preset_id: "bold", style_overrides: edits().style_overrides })?.edits.preset_id).toBe("bold");
  });
});
