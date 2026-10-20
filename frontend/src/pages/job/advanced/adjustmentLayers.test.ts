// .scratch/color-adjust/issues/07-adjustment-layers.md: an Adjustment Layer goes wherever a Shape goes
// on the Timeline (the Magnetic timeline, Ripple delete, Split all, duplicate and the Clipboard), its
// Adjust Track locks, and a Filters card dropped on the Timeline makes one, as worked examples of the
// edits before and after; and the preview mixes its Grade by strength times its fade ramp.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AdjustmentEvent, AdjustmentLayer, Grade, RenderPlan } from "../../../api";
import { NEUTRAL_GRADE } from "../editor/grading";
import { adjustmentFilters, adjustmentWeight } from "../editor/adjustments";
import { playedFrom } from "../editor/playback";
import { AdjustedStack } from "../editor/PreviewAdjustments";
import { addAdjustmentLayer, duplicate, pickAll, regrade, relook, remove, rippleRemove, setAdjustment, split, splitAt, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, unlockedPick, type Pick } from "./pick";
import { shownPlan, UNTOUCHED } from "./trackState";

const WARM: Grade = { ...NEUTRAL_GRADE, adjust: { ...NEUTRAL_GRADE.adjust, temperature: 9000 } };

// An Adjustment Layer from `start` for `secs`, warm.
function layer(id: string, start: number, secs: number, changes: Partial<AdjustmentLayer> = {}): AdjustmentLayer {
  return { id, start, secs, grade: WARM, strength: 100, fade_in: 0, fade_out: 0, ...changes };
}

const segment = (id: string, start: number, end: number) => ({ id, start, end });

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
    music: [],
    source_volume: 1,
    // Played back to back: s1 from 0 to 10 s, s2 from 10 to 15 s and s3 from 15 to 25 s.
    segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)],
    overlays: [],
    transitions: [],
    adjustment_layers: [],
    ...changes,
  };
}

// The scene of `state` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const ref = (id: string) => ({ kind: "adjust", id }) as const;
const seg = (id: string) => ({ kind: "segment", id }) as const;

describe("the Magnetic timeline", () => {
  test("removing a Segment moves the Adjustment Layers after it up, cuts those across it and removes those inside", () => {
    const before = edits({
      adjustment_layers: [layer("before", 2, 3), layer("after", 16, 2), layer("across", 8, 6, { fade_in: 3, fade_out: 1 }), layer("inside", 11, 2)],
    });

    const outcome = remove(scene(before, picked(seg("s2")), { magnetic: true }));

    // The one across the cut keeps its first 2 s, its fades held to half of that.
    expect(outcome?.edits.adjustment_layers).toEqual([
      layer("before", 2, 3),
      layer("after", 11, 2),
      layer("across", 8, 2, { fade_in: 1, fade_out: 1 }),
    ]);
    expect(outcome?.notice).toBe("1 Adjustment Layer inside the cut was removed.");
  });

  test("off, removing a Segment leaves them where they are", () => {
    const before = edits({ adjustment_layers: [layer("after", 16, 2)] });

    expect(remove(scene(before, picked(seg("s2"))))?.edits.adjustment_layers).toEqual(before.adjustment_layers);
  });

  test("a Segment put in moves those after it later", () => {
    const before = edits({ adjustment_layers: [layer("after", 16, 2)] });

    expect(duplicate(scene(before, picked(seg("s2")), { magnetic: true }))?.edits.adjustment_layers).toEqual([layer("after", 21, 2)]);
  });

  test("a Candidate from before them is left without any", () => {
    const { adjustment_layers: _, ...old } = edits();

    expect(remove(scene(old as AdvancedEdits, picked(seg("s2")), { magnetic: true }))?.edits.segments).toHaveLength(2);
  });
});

describe("Ripple delete", () => {
  test("of an Adjustment Layer closes the Adjust Track behind it", () => {
    const before = edits({ adjustment_layers: [layer("gone", 2, 3), layer("over it", 4, 3), layer("next", 6, 1)] });

    expect(rippleRemove(scene(before, picked(ref("gone"))))?.edits.adjustment_layers).toEqual([layer("over it", 4, 3), layer("next", 3, 1)]);
  });
});

describe("select all, split and Split all", () => {
  const before = edits({
    segments: [segment("s1", 100, 110)],
    adjustment_layers: [layer("under", 3, 4, { fade_in: 1, fade_out: 2 }), layer("away", 8, 1)],
  });

  test("select all picks them too", () => {
    expect(pickAll(before)).toEqual(picked(seg("s1"), ref("under"), ref("away")));
  });

  test("with nothing picked, cuts the one under the playhead, the grade going on across the cut", () => {
    const outcome = splitAt(scene(before, null), 5);

    expect(outcome?.edits.adjustment_layers).toEqual([
      layer("under", 3, 2, { fade_in: 1, fade_out: 0 }),
      layer("n2", 5, 2, { fade_in: 0, fade_out: 1 }),
      layer("away", 8, 1),
    ]);
    expect(outcome?.pick).toEqual(picked(seg("n1"), ref("n2")));
  });

  test("a split keeps the Grade and strength", () => {
    const strong = edits({ adjustment_layers: [layer("a", 0, 4, { strength: 40 })] });

    const [, second] = split(scene(strong, picked(ref("a"))), 1)!.edits.adjustment_layers!;
    expect(second).toEqual(layer("n1", 1, 3, { strength: 40 }));
  });
});

describe("duplicate and the Clipboard", () => {
  test("one duplicated goes right after itself, picked", () => {
    const before = edits({ adjustment_layers: [layer("a", 2, 3)] });

    expect(duplicate(scene(before, picked(ref("a"))))).toEqual({
      edits: { ...before, adjustment_layers: [layer("a", 2, 3), layer("n1", 5, 3)] },
      pick: picked(ref("n1")),
    });
  });

  test("copied with a Shape, they paste at the playhead keeping their times relative to each other", () => {
    const shape = { id: "sh", start: 4, secs: 1 } as AdvancedEdits["shapes"][number];
    const before = edits({ adjustment_layers: [layer("a", 2, 3, { strength: 30 })], shapes: [shape] });
    const clipboard = copy(scene(before, picked(ref("a"), { kind: "shape", id: "sh" })), { job: "j", candidate: "one" })!;

    const outcome = paste(scene(edits(), null), clipboard, 10, { job: "k", candidate: "two" });

    expect(outcome.edits.adjustment_layers).toEqual([layer("n2", 10, 3, { strength: 30 })]);
    expect(outcome.edits.shapes).toEqual([{ ...shape, id: "n1", start: 12 }]);
  });

  test("pasted near the Clip's end, one is cut short there, its fades held to half of it", () => {
    const clipboard = copy(scene(edits({ adjustment_layers: [layer("a", 0, 4, { fade_in: 2, fade_out: 2 })] }), picked(ref("a"))), { job: "j", candidate: "one" })!;

    expect(paste(scene(edits(), null), clipboard, 24, { job: "j", candidate: "one" }).edits.adjustment_layers).toEqual([
      layer("n1", 24, 1, { fade_in: 0.5, fade_out: 0.5 }),
    ]);
  });
});

describe("a locked Adjust Track", () => {
  const before = edits({ adjustment_layers: [layer("a", 2, 3)] });

  test("its layers can't be picked", () => {
    expect(unlockedPick(picked(ref("a"), seg("s1")), ["adjust"])).toEqual(picked(seg("s1")));
  });

  test("Split all leaves its layers whole", () => {
    expect(splitAt(scene(before, null, { locked: ["adjust"] }), 3)?.edits.adjustment_layers).toEqual(before.adjustment_layers);
  });

  test("a paste leaves them out, and says so", () => {
    const clipboard = copy(scene(before, picked(ref("a"))), { job: "j", candidate: "one" })!;

    const outcome = paste(scene(before, null, { locked: ["adjust"] }), clipboard, 8, { job: "j", candidate: "one" });

    expect(outcome.edits.adjustment_layers).toEqual(before.adjustment_layers);
    expect(outcome.notice).toBe("1 Adjustment Layer left out: their Tracks are locked.");
  });

  test("a card dropped on the Timeline makes none", () => {
    expect(addAdjustmentLayer(scene(before, null, { locked: ["adjust"] }), "film-kodak", 4)).toBeNull();
  });
});

describe("a Filters card dropped on the Timeline", () => {
  test("makes an Adjustment Layer with its Look at the drop time, 3 s long, picked", () => {
    const outcome = addAdjustmentLayer(scene(edits(), null), "film-kodak", 7.25);

    expect(outcome).toEqual({
      edits: edits({ adjustment_layers: [layer("n1", 7.25, 3, { grade: { ...NEUTRAL_GRADE, look: "film-kodak" } })] }),
      pick: picked(ref("n1")),
    });
  });

  test("near the Clip's end, it lasts to the end", () => {
    expect(addAdjustmentLayer(scene(edits(), null), "film-kodak", 23.5)?.edits.adjustment_layers).toMatchObject([{ start: 23.5, secs: 1.5 }]);
  });
});

describe("the Inspector", () => {
  const before = edits({ adjustment_layers: [layer("a", 2, 3)], overlays: [] });

  test("the Color section's dials and Look change a picked layer's Grade", () => {
    const pick = picked(ref("a"));
    const cooled = regrade(scene(before, pick), { temperature: 5000 })!;
    expect(cooled.edits.adjustment_layers![0].grade.adjust.temperature).toBe(5000);
    expect(relook(scene(before, pick), { look: "film-kodak", intensity: 60 })!.edits.adjustment_layers![0].grade).toMatchObject({ look: "film-kodak", intensity: 60 });
  });

  test("strength and fades are set within their ranges, each fade at most half its length", () => {
    const pick = picked(ref("a"));
    expect(setAdjustment(scene(before, pick), "a", { strength: 140, fade_in: 2, fade_out: 0.5 })!.edits.adjustment_layers).toEqual([
      layer("a", 2, 3, { strength: 100, fade_in: 1.5, fade_out: 0.5 }),
    ]);
  });
});

// An Adjustment Layer as planned, warm, from `start` to `end`.
const event = (id: string, start: number, end: number, changes: Partial<AdjustmentEvent> = {}): AdjustmentEvent => ({
  id,
  start,
  end,
  grade: WARM,
  strength: 100,
  fade_in: 0,
  fade_out: 0,
  ...changes,
});

describe("the preview", () => {
  test("its weight is strength times its fade ramp, within its span only", () => {
    const fading = event("a", 2, 6, { strength: 50, fade_in: 1, fade_out: 2 });
    expect(adjustmentWeight(fading, 1.9)).toBe(0);
    expect(adjustmentWeight(fading, 2.5)).toBeCloseTo(0.25);
    expect(adjustmentWeight(fading, 3.5)).toBeCloseTo(0.5);
    expect(adjustmentWeight(fading, 5)).toBeCloseTo(0.25);
    expect(adjustmentWeight(fading, 6)).toBe(0);
  });

  test("the layers at a time are mixed in list order; a neutral one or one at strength 0 adds no filter", () => {
    const plan = {
      adjustments: [event("a", 0, 4), event("b", 1, 3, { strength: 50 }), event("off", 0, 4, { strength: 0 }), event("plain", 0, 4, { grade: NEUTRAL_GRADE })],
    } as RenderPlan;
    expect(adjustmentFilters(plan, 2).map(({ id, weight }) => [id, weight])).toEqual([
      ["a", 1],
      ["b", 0.5],
    ]);
    expect(adjustmentFilters(plan, 3.5).map(({ id }) => id)).toEqual(["a"]);
  });

  test("hiding the Adjust Track drops them from the preview", () => {
    const plan = { adjustments: [event("a", 0, 4)], texts: [], shapes: [], overlays: [], captions: [], hook: null } as unknown as RenderPlan;
    expect(shownPlan(plan, { ...UNTOUCHED, hidden: ["adjust"] }).adjustments).toEqual([]);
  });
});

describe("the preview's wrapper", () => {
  const plan = { adjustments: [event("a", 2, 6, { strength: 50, fade_in: 1 })] } as RenderPlan;
  const drawn = (time: number) => renderToStaticMarkup(createElement(AdjustedStack, { filters: adjustmentFilters(plan, time), children: createElement("video") }));

  test("mid-fade, filters the Main Track and Overlays' wrapper, mixing the graded picture back by strength times fade", () => {
    const markup = drawn(2.5);
    expect(markup).toMatch(/<div data-adjusted="true" class="absolute inset-0" style="filter:url\(#adjust-a-grade-[^)]*\)"><video><\/video><\/div>/);
    expect(markup).toContain('operator="arithmetic" k1="0" k2="0.25" k3="0.75" k4="0"');
  });

  test("outside its span, the wrapper is there unfiltered, so that its videos stay", () => {
    expect(drawn(7)).toBe('<div data-adjusted="true" class="absolute inset-0"><video></video></div>');
  });
});
