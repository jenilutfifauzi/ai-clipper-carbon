// .scratch/color-adjust/issues/01-segment-grade-adjust-dials.md: a Segment's Grade (ADR 0013), set by
// the Inspector's Color section on the Pick's Segments as one step of undo, kept by Split, duplicate,
// paste and Freeze frame, and drawn by the preview from the draft before its plan comes.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Grade, RenderPlan, SegmentPlan } from "../../../api";
import { adjusted, draftGrades, NEUTRAL_GRADE } from "../editor/grading";
import { playedFrom } from "../editor/playback";
import { duplicate, freezeFrame, regrade, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const WARM: Grade = adjusted(NEUTRAL_GRADE, { temperature: 8500, contrast: 20 });
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const seg = (id: string) => ({ kind: "segment", id }) as const;

function edits(segments: ClipSegment[]): AdvancedEdits {
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
    music: [],
    source_volume: 1,
    segments,
    overlays: [],
    transitions: [],
  };
}

// The scene of `state`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

describe("the Color section's dials", () => {
  test("a dial set on a Pick of several Segments grades them all, keeping each one's other dials, as one undo step", () => {
    const before = edits([segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 204), segment("s3", 300, 302)]);
    const pick = picked(seg("s1"), seg("s2"));
    const dialled = regrade({ edits: before, pick }, { exposure: 0.5 })!;
    const [first, second, third] = dialled.edits.segments;
    expect(first.grade?.adjust).toEqual({ ...WARM.adjust, exposure: 0.5 });
    expect(second.grade?.adjust).toEqual({ ...NEUTRAL_GRADE.adjust, exposure: 0.5 });
    expect(third.grade).toBeUndefined();
    expect(dialled.pick).toBe(pick);

    // One step of the history: one undo brings back both Segments' Grades.
    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, dialled.edits, false);
    expect(undone(history)!.value).toBe(before);
  });

  test("reset makes the picked Segments' Grades neutral; nothing picked leaves them (the Candidate's is graded, color-adjust/04)", () => {
    const before = edits([segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 204, { grade: WARM })]);
    const reset = regrade({ edits: before, pick: picked(seg("s2")) }, "reset")!;
    expect(reset.edits.segments.map((s) => s.grade)).toEqual([WARM, NEUTRAL_GRADE]);
    expect(regrade({ edits: before, pick: null }, { tint: 10 })!.edits.segments).toBe(before.segments);
  });
});

describe("a Segment's copies keep its Grade", () => {
  const before = edits([segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 204)]);

  test("Split's two parts", () => {
    const parts = split(scene(before, picked(seg("s1"))), 3)!.edits.segments;
    expect(parts.map((s) => [s.id, s.grade])).toEqual([["s1", WARM], ["n1", WARM], ["s2", undefined]]);
  });

  test("duplicate", () => {
    const copies = duplicate(scene(before, picked(seg("s1"))))!.edits.segments;
    expect(copies.map((s) => [s.id, s.grade])).toEqual([["s1", WARM], ["n1", WARM], ["s2", undefined]]);
  });

  test("copy and paste", () => {
    const here = { job: "j1", candidate: "c1" };
    const held = copy(scene(before, picked(seg("s1"))), here)!;
    const pasted = paste(scene(before, null), held, 10, here).edits.segments;
    expect(pasted.find((s) => s.id === "n1")?.grade).toEqual(WARM);
  });

  test("Freeze frame's head, held frame and tail", () => {
    const frozen = freezeFrame(scene(before), 3)!.edits.segments;
    expect(frozen.map((s) => [s.id, s.hold ?? null, s.grade])).toEqual([
      ["s1", null, WARM],
      ["n2", 1, WARM],
      ["n1", null, WARM],
      ["s2", null, undefined],
    ]);
  });
});

describe("the preview", () => {
  const planned = (id: string, grade?: Grade): SegmentPlan =>
    ({ id, start: 0, end: 1, source_start: 0, source_end: 1, media: null, volume: 1, silent: false, scenes: 1, gain: [], fade_in: 0, fade_out: 0, grade }) as SegmentPlan;
  const plan = { segments: [planned("s1"), planned("s2", WARM)], overlays: [] } as unknown as RenderPlan;

  test("draws the Segments in the draft's Grades at once, before the plan of the change comes", () => {
    const shown = draftGrades(plan, [segment("s1", 0, 1, { grade: WARM }), segment("s2", 0, 1, { grade: WARM })]);
    expect(shown.segments.map((s) => s.grade)).toEqual([WARM, WARM]);
    // As planned already: the same plan.
    expect(draftGrades(plan, [segment("s1", 0, 1), segment("s2", 0, 1, { grade: WARM })])).toBe(plan);
  });

  test("draws a sharpen or vignette dragged at once, and reset takes them back (color-adjust/02)", () => {
    const effects = adjusted(WARM, { sharpen: 40, vignette: 25 });
    const shown = draftGrades(plan, [segment("s1", 0, 1), segment("s2", 0, 1, { grade: effects })]);
    expect(shown.segments[1].grade).toEqual(effects);
    const before = edits([segment("s1", 0, 1, { grade: effects })]);
    expect(regrade({ edits: before, pick: picked(seg("s1")) }, "reset")!.edits.segments[0].grade).toEqual(NEUTRAL_GRADE);
    expect(regrade({ edits: before, pick: picked(seg("s1")) }, { sharpen: 0 })!.edits.segments[0].grade?.adjust).toEqual({ ...effects.adjust, sharpen: 0 });
  });
});
