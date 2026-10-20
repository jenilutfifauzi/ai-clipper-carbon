// .scratch/color-adjust/issues/03-overlay-grade.md: an Overlay's Grade (ADR 0013), set by the
// Inspector's Color section on a Pick of Segments and Overlays together as one step of undo, kept by
// duplicate and paste, and drawn by the preview on its picture alone (its border and shadow not),
// from the draft before its plan comes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ClipSegment, Grade, Overlay, OverlayEvent, Picture, RenderPlan } from "../../../api";
import { adjusted, draftGrades, gradeFilter, NEUTRAL_GRADE } from "../editor/grading";
import { PicturePanel } from "../editor/PicturePanel";
import { playedFrom } from "../editor/playback";
import { duplicate, regrade, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const WARM: Grade = adjusted(NEUTRAL_GRADE, { temperature: 8500, contrast: 20 });
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const overlay = (id: string, start: number, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "logo",
  start,
  secs: 2,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.3, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});
const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;

function edits(segments: ClipSegment[], overlays: Overlay[]): AdvancedEdits {
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
    overlays,
    transitions: [],
  };
}

// The scene of `state`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

describe("the Color section on a Pick of Segments and Overlays", () => {
  test("a dial grades them all, keeping each one's other dials, as one undo step", () => {
    const before = edits([segment("s1", 100, 106), segment("s2", 200, 204)], [overlay("o1", 1, { grade: WARM }), overlay("o2", 2)]);
    const pick = picked(seg("s1"), over("o1"));
    const dialled = regrade({ edits: before, pick }, { exposure: 0.5 })!;
    expect(dialled.edits.segments.map((s) => s.grade?.adjust.exposure)).toEqual([0.5, undefined]);
    expect(dialled.edits.overlays[0].grade?.adjust).toEqual({ ...WARM.adjust, exposure: 0.5 });
    expect(dialled.edits.overlays[1].grade).toBeUndefined();
    expect(dialled.pick).toBe(pick);

    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, dialled.edits, false);
    expect(undone(history)!.value).toBe(before);
  });

  test("reset makes a picked Overlay's Grade neutral; one picked alone is graded alone", () => {
    const before = edits([segment("s1", 100, 106, { grade: WARM })], [overlay("o1", 1, { grade: WARM })]);
    const reset = regrade({ edits: before, pick: picked(over("o1")) }, "reset")!;
    expect(reset.edits.overlays[0].grade).toEqual(NEUTRAL_GRADE);
    expect(reset.edits.segments).toBe(before.segments);
  });
});

describe("an Overlay's copies keep its Grade", () => {
  const before = edits([segment("s1", 100, 106)], [overlay("o1", 1, { grade: WARM })]);

  test("duplicate", () => {
    const copies = duplicate(scene(before, picked(over("o1"))))!.edits.overlays;
    expect(copies.map((o) => o.grade)).toEqual([WARM, WARM]);
  });

  test("copy and paste", () => {
    const here = { job: "j1", candidate: "c1" };
    const held = copy(scene(before, picked(over("o1"))), here)!;
    const pasted = paste(scene(before, null), held, 4, here).edits.overlays;
    expect(pasted).toHaveLength(2);
    expect(pasted.map((o) => o.grade)).toEqual([WARM, WARM]);
  });
});

describe("the preview", () => {
  const picture: Picture = {
    crop: { x: 0, y: 0, width: 200, height: 100 },
    item_size: [200, 100],
    width: 400,
    height: 200,
    centre: [540, 400],
    rotation: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1,
    bounds: { x: 340, y: 300, width: 400, height: 200 },
    radius: 20,
    border: { width: 6, colour: "#4080C0" },
    shadow: { blur: 10, x: 4, y: 4, colour: "#000000", opacity: 0.5 },
  };

  test("draws the Overlays in the draft's Grades at once, before the plan of the change comes", () => {
    const event = (id: string, grade?: Grade) => ({ id, media: "logo", picture, start: 0, end: 1, offset: 0, image: true, grade }) as OverlayEvent;
    const plan = { segments: [], overlays: [event("o1"), event("o2", WARM)] } as unknown as RenderPlan;
    const shown = draftGrades(plan, [], [overlay("o1", 0, { grade: WARM }), overlay("o2", 0, { grade: WARM })]);
    expect(shown.overlays.map((o) => o.grade)).toEqual([WARM, WARM]);
    expect(draftGrades(plan, [], [overlay("o1", 0), overlay("o2", 0, { grade: WARM })])).toBe(plan);
  });

  test("grades the picture alone: its border and shadow are outside its filter, its vignette over it", () => {
    const grade = adjusted(WARM, { vignette: 30 });
    const markup = renderToStaticMarkup(<PicturePanel picture={picture} frame={{ width: 1080, height: 1920 }} media={<img alt="" />} grade={grade} />);
    const filter = gradeFilter(grade)!;
    // The shadow's filter on the outer layer, the Grade's only on the media's.
    const filters = [...markup.matchAll(/filter:([^;"]+)/g)].map(([, value]) => value);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatch(/^drop-shadow/);
    expect(filters[1]).toBe(filter);
    expect(markup.indexOf(filter)).toBeLessThan(markup.indexOf("<img"));
    // After the media: its vignette, then its border, which no filter of the Grade covers.
    const media = markup.indexOf("</div>", markup.indexOf("<img"));
    expect(markup.indexOf("data-vignette")).toBeGreaterThan(media);
    expect(markup.indexOf("border:")).toBeGreaterThan(markup.indexOf("data-vignette"));
    // Ungraded: no Grade filter nor vignette.
    const plain = renderToStaticMarkup(<PicturePanel picture={picture} frame={{ width: 1080, height: 1920 }} media={<img alt="" />} />);
    expect(plain).not.toContain("url(#grade-");
    expect(plain).not.toContain("data-vignette");
  });
});
