// .scratch/color-adjust/issues/04-candidate-grade.md: the Candidate's own Grade (ADR 0013), set by the
// Advanced Edit's Inspector with nothing picked as one step of undo and by the clip editor's Color
// section, kept through a save and reload, and drawn by the preview from the draft before its plan
// comes, a Clip of one range's too.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Candidate, ClipSegment, Grade, Overlay, RenderPlan } from "../../../api";
import { ClipColor } from "../editor/ClipColor";
import { candidateDraft } from "../editor/draft";
import { adjusted, draftGrades, gradeFilter, NEUTRAL_GRADE } from "../editor/grading";
import { collidedParts } from "../editor/merge";
import { regrade } from "./actions";
import { editsOf, type AdvancedEdits } from "./edits";
import { picked } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const WARM: Grade = adjusted(NEUTRAL_GRADE, { temperature: 8500, contrast: 20 });
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });

// A Candidate as the backend gives it: one range, uncut, its Grade `grade`.
function candidate(grade: Grade = NEUTRAL_GRADE): Candidate {
  return {
    id: "c1",
    start: 100,
    end: 112,
    hook_text: "Hook",
    hook_kicker: "",
    layout: "auto",
    framing: null,
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    hook_start: 0,
    hook_secs: 3,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [],
    overlays: [],
    transitions: [],
    grade,
    revision: 1,
  } as unknown as Candidate;
}

describe("the Inspector with nothing picked", () => {
  test("a dial change edits the Candidate's Grade, not its Segments' or Overlays', as one undo step", () => {
    const before: AdvancedEdits = {
      ...editsOf(candidate(WARM)),
      segments: [segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 204)],
      overlays: [{ id: "o1", grade: WARM } as Overlay],
    };
    const dialled = regrade({ edits: before, pick: null }, { exposure: 0.5 })!;
    expect(dialled.edits.grade).toEqual({ ...WARM, adjust: { ...WARM.adjust, exposure: 0.5 } });
    expect(dialled.edits.segments).toBe(before.segments);
    expect(dialled.edits.overlays).toBe(before.overlays);
    expect(dialled.pick).toBeNull();

    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, dialled.edits, false);
    expect(undone(history)!.value).toBe(before);

    // Reset makes it neutral; with a Segment picked, the Segment's is graded and the Candidate's stays.
    expect(regrade({ edits: before, pick: null }, "reset")!.edits.grade).toEqual(NEUTRAL_GRADE);
    const onSegment = regrade({ edits: before, pick: picked({ kind: "segment", id: "s2" }) }, { tint: 10 })!;
    expect(onSegment.edits.grade).toBe(before.grade);
    expect(onSegment.edits.segments[1].grade?.adjust.tint).toBe(10);
  });

  test("a Candidate saved before its Grade edits from a neutral one", () => {
    const old = { ...candidate(), grade: undefined };
    expect(editsOf(old).grade).toEqual(NEUTRAL_GRADE);
  });
});

describe("the clip editor's Color section", () => {
  test("edits the same Grade, which a save and reload keep", () => {
    const saved = candidate();
    // A dial moved: the Grade it saves, as the backend then gives the Candidate back.
    const change = { grade: adjusted(saved.grade, { exposure: 0.5, saturation: -40 }) };
    const reloaded = { ...saved, ...change, revision: 2 };
    expect(candidateDraft(reloaded).grade).toEqual(change.grade);
    // The Advanced Edit opens with it as its Candidate's Grade.
    expect(editsOf(reloaded).grade).toEqual(change.grade);
    // And the section shows it: Exposure +0.50 EV, Saturation −40, Reset on.
    const markup = renderToStaticMarkup(<ClipColor grade={reloaded.grade!} onGrade={() => {}} />);
    expect(markup).toContain("+0.50 EV");
    expect(markup).toContain("-40");
    expect(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset/s.test(markup)).toBe(false);
    // A change of it is named Color among a merge's Collisions.
    expect(collidedParts([{ field: "grade" }])).toBe("Color");
  });
});

describe("the preview", () => {
  // A Clip of one range: no Segment in its plan.
  const plan = { segments: [], overlays: [], grade: NEUTRAL_GRADE } as unknown as RenderPlan;

  test("draws the Candidate's Grade from the draft at once, a Clip of one range's too", () => {
    const shown = draftGrades(plan, [], [], WARM);
    expect(shown.grade).toEqual(WARM);
    expect(gradeFilter(shown.grade)).toBeDefined();
    // As planned already, or not given: the same plan.
    const planned = { ...plan, grade: WARM };
    expect(draftGrades(planned, [], [], WARM)).toBe(planned);
    expect(draftGrades(plan, [], [])).toBe(plan);
  });
});
