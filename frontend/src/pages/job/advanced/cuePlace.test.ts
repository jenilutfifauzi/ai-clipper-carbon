// .scratch/captions-advanced/issues/08-cue-place-and-size.md: a picked Cue's Grips on the preview
// write its Cue Edit's place and scale; the picked captions' write the Style Override, as before.
import { describe, expect, test } from "vitest";
import type { Cue, CueEdit, CueKey, RenderPlan } from "../../../api";
import { cueStageId } from "../editor/cues";
import { resetCueTiming, type CueScene } from "./cueEdits";
import { placeCue, placedCaptions, resetCuePosition } from "./cuePlace";
import type { AdvancedEdits } from "./edits";
import { stageIdsOf, stageItem, type Pick } from "./pick";

const cue = (start: number, end: number, at: number): Cue => ({
  start,
  end,
  lines: [[{ text: "HALO", start, end }]],
  plain: ["halo"],
  area: { x: 130, y: 1296, width: 820, height: 200 },
  size: 110,
  key: { at, media: null },
  edited: false,
  joinable: false,
});

// "halo semua" from 1.0 to 2.3 s and "apa kabar" from 3.0 to 3.9 s of a Clip from 100 s, captioned at size 110.
const PLAN = {
  start: 100,
  end: 105,
  captions: [cue(1.0, 2.3, 101.2), cue(3.0, 3.9, 103.1)],
  segments: [],
  transitions: [],
  unused_cue_edits: [],
  caption_style: { size: 110 },
} as unknown as RenderPlan;
const SECOND: CueKey = { at: 103.1, media: null };
const CUE: Pick = { kind: "cue", key: SECOND };

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    style_overrides: { caption: { size: 110 }, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    ...changes,
  } as AdvancedEdits;
}

const edit = (at: number, changes: Partial<CueEdit> = {}): CueEdit => ({ at, media: null, shift: 0, start_delta: 0, end_delta: 0, ...changes });
const scene = (state: AdvancedEdits, locked: CueScene["locked"] = []): CueScene => ({ edits: state, plan: PLAN, locked });

describe("a picked Cue's Grips", () => {
  test("a move writes its Cue Edit's x and y, keeping its timing; the other Cues and the style stay", () => {
    const state = edits({ cue_edits: [edit(101.2, { shift: 0.1 }), edit(103.1, { end_delta: 0.3 })] });
    const moved = placedCaptions(scene(state), CUE, { x: 300, y: 700, size: null })!;
    expect(moved.edits.cue_edits).toEqual([edit(101.2, { shift: 0.1 }), edit(103.1, { end_delta: 0.3, x: 300, y: 700 })]);
    expect(moved.edits.style_overrides).toBe(state.style_overrides);
    expect(moved.pick).toEqual(CUE);
    // On a Cue without one, a Cue Edit at its key.
    expect(placedCaptions(scene(edits()), CUE, { x: 300, y: 700, size: null })!.edits.cue_edits).toEqual([edit(103.1, { x: 300, y: 700 })]);
  });

  test("a corner writes its scale over the Caption Style's size, within its bounds", () => {
    const sized = placedCaptions(scene(edits()), CUE, { x: 540, y: 1396, size: 165 })!;
    expect(sized.edits.cue_edits).toEqual([edit(103.1, { x: 540, y: 1396, scale: 1.5 })]);
    expect(placedCaptions(scene(edits()), CUE, { x: 540, y: 1396, size: 9000 })!.edits.cue_edits[0].scale).toBe(4);
    expect(placedCaptions(scene(edits()), CUE, { x: 540, y: 1396, size: 1 })!.edits.cue_edits[0].scale).toBe(0.25);
  });

  test("on the picked captions they write the Style Override, as before, and no Cue Edit", () => {
    const state = edits({ cue_edits: [edit(103.1, { x: 300 })] });
    const moved = placedCaptions(scene(state), { kind: "captions" }, { x: 540, y: 900, size: 120 })!;
    expect(moved.edits.style_overrides.caption).toEqual({ size: 120, position: "custom", x: 540, y: 900 });
    expect(moved.edits.cue_edits).toBe(state.cue_edits);
    expect(moved.pick).toEqual({ kind: "captions" });
  });

  test("a locked Captions Track refuses them", () => {
    expect(placedCaptions(scene(edits(), ["captions"]), CUE, { x: 300, y: 700, size: null })).toBeNull();
    expect(placedCaptions(scene(edits(), ["captions"]), { kind: "captions" }, { x: 300, y: 700, size: null })).toBeNull();
  });

  test("a picked Cue is on the stage by its key, and picked from there", () => {
    expect(stageIdsOf(CUE)).toEqual([cueStageId(SECOND)]);
    expect(stageItem(cueStageId(SECOND))).toEqual(CUE);
    const onMedia: CueKey = { at: 2.5, media: "ab".repeat(16) };
    expect(stageItem(cueStageId(onMedia))).toEqual({ kind: "cue", key: onMedia });
  });
});

describe("the inspector's place and scale", () => {
  test("each field changes only its own, kept in its bounds", () => {
    const state = edits({ cue_edits: [edit(103.1, { x: 300, y: 700 })] });
    expect(placeCue(scene(state), SECOND, { scale: 2 })!.edits.cue_edits).toEqual([edit(103.1, { x: 300, y: 700, scale: 2 })]);
    expect(placeCue(scene(edits()), SECOND, { y: 2500 })!.edits.cue_edits).toEqual([edit(103.1, { y: 1920 })]);
    expect(placeCue(scene(edits()), { at: 50, media: null }, { y: 900 })).toBeNull();
  });
});

describe("Reset position", () => {
  test("clears its place and scale, keeping its timing, and drops a Cue Edit with nothing left", () => {
    const state = edits({ cue_edits: [edit(103.1, { end_delta: 0.3, x: 300, y: 700, scale: 1.5 })] });
    const reset = resetCuePosition(scene(state), SECOND)!;
    expect(reset.edits.cue_edits).toEqual([edit(103.1, { end_delta: 0.3, x: null, y: null, scale: null })]);
    expect(reset.pick).toEqual(CUE);
    const placedOnly = edits({ cue_edits: [edit(103.1, { x: 300, y: 700 })] });
    expect(resetCuePosition(scene(placedOnly), SECOND)!.edits.cue_edits).toEqual([]);
    // Nothing to reset, or the Track locked.
    expect(resetCuePosition(scene(edits({ cue_edits: [edit(103.1, { shift: 0.2 })] })), SECOND)).toBeNull();
    expect(resetCuePosition(scene(state, ["captions"]), SECOND)).toBeNull();
  });

  test("Reset timing keeps a Cue Edit that still places its Cue", () => {
    const state = edits({ cue_edits: [edit(103.1, { shift: 0.4, scale: 1.5 })] });
    expect(resetCueTiming(scene(state), SECOND)!.edits.cue_edits).toEqual([edit(103.1, { scale: 1.5 })]);
  });
});
