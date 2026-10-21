// .scratch/video-effects/issues/01-gaussian-blur-on-an-overlay.md, 02-effects-on-segments.md,
// 03-effects-on-adjustment-layers-and-keyed-pictures.md and 05-light-and-time-effects.md: an Overlay's,
// a Segment's and an Adjustment Layer's stack of Video Effects (ADR 0014), edited from the Inspector on a Pick of
// one picture or several, each change one step of undo; carried by Split, Duplicate, the Clipboard and
// the Revision merge; and drawn by the preview.
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { isColourSetting, type AdjustmentEvent, type AdjustmentLayer, type AudioEffectSetting, type ClipSegment, type Overlay, type OverlayEvent, type RenderPlan, type SegmentPlan, type VideoEffect, type VideoEffectKind } from "../../../api";
import { adjustmentFilters } from "../editor/adjustments";
import { EffectFilters, EffectsClock, GradeFilter } from "../editor/GradeFilters";
import { NEUTRAL_GRADE } from "../editor/grading";
import { PORTRAIT } from "../editor/canvas";
import { videoLibraryOf } from "../../../videoEffects";
import { NO_CROP } from "../editor/cropGestures";
import { mergeEdits } from "../editor/merge";
import { Playback, playedFrom } from "../editor/playback";
import {
  bloomStrength,
  displacementMap,
  draftVideoEffects,
  effectPrimitives,
  effectsFilterId,
  fisheyeOffset,
  IMITATIONS,
  overlayScale,
  pictureBox,
  scaledEffects,
} from "../editor/videoEffects";
import catalogue from "../../../../../backend/tests/fixtures/video_effects.json";
import {
  addVideoEffect,
  duplicate,
  moveVideoEffect,
  removeAllVideoEffects,
  removeVideoEffect,
  setVideoEffectEnabled,
  setVideoEffectSetting,
  sharedVideoStack,
  split,
  type PickContext,
} from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const blurKind: VideoEffectKind = {
  id: "gaussian-blur",
  kind: "video",
  name: "Gaussian blur",
  category: "Blur",
  order: 10,
  description: "A soft, even blur.",
  settings: [{ key: "radius", label: "Radius", min: 1, max: 50, default: 10, step: 1, unit: "px", intensity: true }],
};
// A second effect, for the order of a stack (the catalogue has one so far).
const grainKind: VideoEffectKind = {
  id: "film-grain",
  kind: "video",
  name: "Film grain",
  category: "Stylize",
  order: 20,
  description: "Grain that moves.",
  settings: [{ key: "amount", label: "Amount", min: 2, max: 40, default: 12, step: 1, unit: "", intensity: true }],
};
const blur: VideoEffect = { id: "gaussian-blur", params: { radius: 10 }, enabled: true };
const grain: VideoEffect = { id: "film-grain", params: { amount: 12 }, enabled: true };

const overlay = (id: string, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "clip",
  start: 0,
  secs: 8,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});

function edits(overlays: Overlay[], segments: ClipSegment[] = [{ id: "s1", start: 100, end: 110 }]): AdvancedEdits {
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

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

const stacks = (state: AdvancedEdits) => state.overlays.map((each) => each.video_effects);
const one = picked({ kind: "overlay", id: "a" });
const both = picked({ kind: "overlay", id: "a" }, { kind: "overlay", id: "b" });

describe("the Inspector's Video Effects actions", () => {
  test("Add effect appends the effect at its defaults to every picked Overlay, skipping one that has it", () => {
    const state = edits([overlay("a", { video_effects: [grain] }), overlay("b", { video_effects: [blur] }), overlay("c")]);
    const outcome = addVideoEffect({ edits: state, pick: picked({ kind: "overlay", id: "a" }, { kind: "overlay", id: "b" }, { kind: "overlay", id: "c" }) }, blurKind)!;
    expect(stacks(outcome.edits)).toEqual([[grain, blur], [blur], [blur]]);
    // Already in every picked stack: nothing to add.
    expect(addVideoEffect({ edits: outcome.edits, pick: one }, blurKind)).toBeNull();
    expect(addVideoEffect({ edits: state, pick: null }, blurKind)).toBeNull();
  });

  test("on a Pick of one, the stack is shown; of several, when their stacks are equal, else Mixed", () => {
    const twins = edits([overlay("a", { video_effects: [blur] }), overlay("b", { video_effects: [{ ...blur, params: { ...blur.params } }] })]);
    expect(sharedVideoStack({ edits: twins, pick: one })).toEqual([blur]);
    expect(sharedVideoStack({ edits: twins, pick: both })).toEqual([blur]);
    const differ = edits([overlay("a", { video_effects: [blur] }), overlay("b")]);
    expect(sharedVideoStack({ edits: differ, pick: both })).toBe("mixed");
    expect(sharedVideoStack({ edits: differ, pick: picked({ kind: "segment", id: "s1" }) })).toEqual([]);
    expect(sharedVideoStack({ edits: differ, pick: picked({ kind: "text", id: "t" }) })).toBeNull();
  });

  // Two Overlays with the same stack.
  const twins = () => edits([overlay("a", { video_effects: [blur, grain] }), overlay("b", { video_effects: [blur, grain] })]);

  test.each([
    ["one", one],
    ["several", both],
  ])("move, switch off, set a setting and remove act by index on a Pick of %s", (_, pick) => {
    const changed = (state: AdvancedEdits) => stacks(state).slice(0, pick === one ? 1 : 2);
    const down = moveVideoEffect({ edits: twins(), pick }, 0, 1)!;
    expect(changed(down.edits).every((stack) => JSON.stringify(stack) === JSON.stringify([grain, blur]))).toBe(true);
    expect(moveVideoEffect({ edits: twins(), pick }, 0, -1)).toBeNull();
    expect(moveVideoEffect({ edits: twins(), pick }, 1, 1)).toBeNull();

    const off = setVideoEffectEnabled({ edits: twins(), pick }, 0, false)!;
    expect(changed(off.edits).every((stack) => stack![0].enabled === false && stack![1] === grain)).toBe(true);

    const radius = blurKind.settings[0] as AudioEffectSetting;
    const set = setVideoEffectSetting({ edits: twins(), pick }, 0, radius, 24.4)!;
    expect(changed(set.edits).map((stack) => stack![0].params.radius)).toEqual(pick === one ? [24] : [24, 24]);
    // Within its range.
    expect(setVideoEffectSetting({ edits: twins(), pick }, 0, radius, 90)!.edits.overlays[0].video_effects![0].params.radius).toBe(50);

    const removed = removeVideoEffect({ edits: twins(), pick }, 0)!;
    expect(changed(removed.edits).every((stack) => JSON.stringify(stack) === JSON.stringify([grain]))).toBe(true);
    const emptied = removeVideoEffect({ edits: removed.edits, pick }, 0)!;
    expect("video_effects" in emptied.edits.overlays[0]).toBe(false);
  });

  test("an entry's actions do nothing while the picked stacks differ; Remove all empties them anyway", () => {
    const differ = edits([overlay("a", { video_effects: [blur, grain] }), overlay("b", { video_effects: [grain] })]);
    expect(moveVideoEffect({ edits: differ, pick: both }, 0, 1)).toBeNull();
    expect(setVideoEffectEnabled({ edits: differ, pick: both }, 0, false)).toBeNull();
    expect(removeVideoEffect({ edits: differ, pick: both }, 0)).toBeNull();
    const cleared = removeAllVideoEffects({ edits: differ, pick: both })!;
    expect(stacks(cleared.edits)).toEqual([undefined, undefined]);
    expect(removeAllVideoEffects({ edits: cleared.edits, pick: both })).toBeNull();
  });
});

describe("the stack goes with its Overlay", () => {
  test("Split gives it to both parts, Duplicate to the copy, and copy and paste carry it", () => {
    const state = edits([overlay("a", { video_effects: [blur] })]);
    expect(stacks(split(scene(state, one), 4)!.edits)).toEqual([[blur], [blur]]);
    expect(stacks(duplicate(scene(state, one))!.edits)).toEqual([[blur], [blur]]);
    const copied = copy(scene(state, one), { job: "j1", candidate: "c1" })!;
    const pasted = paste(scene(edits([])), copied, 0, { job: "j1", candidate: "c2" }).edits;
    expect(stacks(pasted)).toEqual([[blur]]);
  });

  test("the Revision merge takes a stack edited on the other side, and mine on a collision", () => {
    const base = { overlays: [overlay("a"), overlay("b")] };
    const mine = { overlays: [overlay("a", { video_effects: [blur] }), overlay("b")] };
    const theirs = { overlays: [overlay("a"), overlay("b", { video_effects: [grain] })] };
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { overlays: [mine.overlays[0], theirs.overlays[1]] }, collisions: [] });
    const other = { overlays: [overlay("a", { video_effects: [grain] }), overlay("b")] };
    expect(mergeEdits(base, mine, other)).toEqual({ merged: mine, collisions: [{ field: "overlays", item: "a" }] });
  });
});

describe("the preview", () => {
  test("the library lists by category, by order, searched by name or description", () => {
    expect(videoLibraryOf([grainKind, blurKind], "").map(({ category, effects }) => [category, effects.map((effect) => effect.id)])).toEqual([
      ["Blur", ["gaussian-blur"]],
      ["Stylize", ["film-grain"]],
    ]);
    expect(videoLibraryOf([grainKind, blurKind], " SOFT").map(({ category }) => category)).toEqual(["Blur"]);
  });

  test("sizes are times the larger of scale x stretch, an entry switched off left out, as the planner does", () => {
    expect(overlayScale({ scale: 0.5, stretch_x: 3, stretch_y: 1 })).toBe(1.5);
    expect(scaledEffects([{ ...blur, params: {} }, { ...grain, enabled: false }], 1.5, [blurKind, grainKind])).toEqual([{ ...blur, params: { radius: 15 } }]);
  });

  const picture = { width: 540, height: 304, item_size: [320, 180], crop: { x: 0, y: 0, width: 320, height: 180 } } as OverlayEvent["picture"];
  const event = (video_effects?: VideoEffect[]) => ({ id: "a", picture, video_effects }) as OverlayEvent;

  test("a stack dragged shows at once: the plan's Overlay takes the draft's, scaled", () => {
    const plan = { segments: [] as SegmentPlan[], overlays: [event([{ ...blur, params: { radius: 5 } }])] } as RenderPlan;
    const drawn = draftVideoEffects(plan, [], [overlay("a", { video_effects: [{ ...blur, params: { radius: 30 } }] })], [blurKind]);
    expect(drawn.overlays[0].video_effects).toEqual([{ ...blur, params: { radius: 15 } }]);
    // As planned already, or while the catalogue loads: the plan itself.
    expect(draftVideoEffects(drawn, [], [overlay("a", { video_effects: [{ ...blur, params: { radius: 30 } }] })], [blurKind])).toBe(drawn);
    expect(draftVideoEffects(plan, [], [overlay("a")], null)).toBe(plan);
  });

  test("Gaussian blur is an feGaussianBlur of its radius over the element's box, one filter per stack and size", () => {
    const box = pictureBox(picture);
    expect(effectPrimitives([{ ...blur, params: { radius: 27 } }], box)).toEqual([{ element: "feGaussianBlur", attributes: { stdDeviation: "0.05 0.088816" } }]);
    expect(effectsFilterId([{ ...blur, enabled: false }], box)).toBeNull();
    expect(effectsFilterId([blur], box)).not.toBe(effectsFilterId([{ ...blur, params: { radius: 11 } }], box));
  });

  test("every catalogue effect has an imitation, at its defaults, minimums and maximums", () => {
    const box = pictureBox(picture);
    // The backend's catalogue, as its tests check it.
    for (const kind of catalogue as VideoEffectKind[]) {
      expect(IMITATIONS[kind.id], kind.id).toBeDefined();
      for (const corner of ["default", "min", "max"] as const) {
        // A colour has no range: its default.
        const params = Object.fromEntries(kind.settings.map((setting) => [setting.key, isColourSetting(setting) ? setting.default : setting[corner]]));
        const primitives = effectPrimitives([{ id: kind.id, params, enabled: true }], box);
        expect(primitives.length, `${kind.id} ${corner}`).toBeGreaterThan(0);
        const values = primitives.flatMap(function all(primitive): string[] {
          return [...Object.values(primitive.attributes), ...(primitive.children ?? []).flatMap(all)];
        });
        expect(values.filter((value) => /NaN|Infinity/.test(value)), `${kind.id} ${corner}`).toEqual([]);
      }
    }
    // An id stays short whatever its primitives (a map's data URL).
    expect(effectsFilterId([{ id: "fisheye", params: { strength: 50 }, enabled: true }], box)!.length).toBeLessThan(80);
  });

  // .scratch/video-effects/issues/04-blur-distort-and-stylize-effects.md
  test("Posterize is a discrete table rounding each channel to its levels", () => {
    const [transfer] = effectPrimitives([{ id: "posterize", params: { levels: 3 }, enabled: true }], pictureBox(picture));
    expect(transfer.element).toBe("feComponentTransfer");
    // Below a quarter, 0; to three quarters, a half; then 1: as round(value x 2) / 2.
    expect(transfer.children!.map((func) => [func.element, func.attributes.tableValues])).toEqual([
      ["feFuncR", "0 0.5 0.5 1"],
      ["feFuncG", "0 0.5 0.5 1"],
      ["feFuncB", "0 0.5 0.5 1"],
    ]);
  });

  test("Motion blur along an axis is a Gaussian along it, and at a slant samples along its line", () => {
    const frame = { width: 1080, height: 1920 };
    expect(effectPrimitives([{ id: "motion-blur", params: { length: 18, angle: 0 }, enabled: true }], frame)).toEqual([
      { element: "feGaussianBlur", attributes: { stdDeviation: "0.016667 0" } },
    ]);
    const slanted = effectPrimitives([{ id: "motion-blur", params: { length: 20, angle: 45 }, enabled: true }], frame);
    const taps = slanted.filter((primitive) => primitive.attributes.result === "vfx-motion-tap");
    // Up to the right, 10 px apart along the line.
    expect(taps).toHaveLength(9);
    expect(Number(taps[8].attributes.dx) * 1080).toBeCloseTo(40 * Math.SQRT1_2, 2);
    expect(Number(taps[8].attributes.dy) * 1920).toBeCloseTo(-40 * Math.SQRT1_2, 2);
  });

  test("Fisheye's map moves the middle's points outward and keeps the corners, as the render's two stages", () => {
    const frame = { width: 1080, height: 1920 };
    const offset = fisheyeOffset(100, frame);
    // At a corner, nothing; near the middle, the point shown is nearer the middle (its picture moves out).
    expect(offset(0, 0).map((value) => Math.abs(value))).toEqual([0, 0]);
    const [du, dv] = offset(0.6, 0.55);
    expect(du).toBeLessThan(0);
    expect(dv).toBeLessThan(0);
    // Two stages of s = 0.3: the middle magnified 1 / 0.49.
    expect(offset(0.6, 0.5)[0]).toBeCloseTo(0.1 * (0.49 - 1), 2);
    const [image, map] = effectPrimitives([{ id: "fisheye", params: { strength: 100 }, enabled: true }], frame).slice(1);
    expect(image.element).toBe("feImage");
    expect(image.attributes.href).toMatch(/^data:image\/bmp;base64,Qk/);
    expect(map).toMatchObject({ element: "feDisplacementMap", attributes: { xChannelSelector: "R", yChannelSelector: "G" } });
  });

  test("a displacement map is a BMP of its offsets about a half", () => {
    const url = displacementMap(() => [0.25, -0.5], 1);
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (char) => char.charCodeAt(0));
    expect(bytes.length).toBe(54 + 64 * 64 * 3);
    // Blue, green, red: no blue, green 0.5 - 0.5, red 0.5 + 0.25.
    expect([...bytes.slice(54, 57)]).toEqual([0, 0, 191]);
  });
});

// .scratch/video-effects/issues/02-effects-on-segments.md
describe("a Segment's stack", () => {
  const segment = (id: string, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start: 100, end: 110, ...changes });
  const segmentStacks = (state: AdvancedEdits) => state.segments.map((each) => each.video_effects);
  const mixed = picked({ kind: "segment", id: "s1" }, { kind: "overlay", id: "a" });

  test("Split gives it to both halves", () => {
    const state = edits([], [segment("s1", { video_effects: [blur] })]);
    const halves = split(scene(state, picked({ kind: "segment", id: "s1" })), 4)!.edits;
    expect(segmentStacks(halves)).toEqual([[blur], [blur]]);
  });

  test("a mixed Pick of Segments and Overlays takes an action on all of them while their stacks are equal", () => {
    const state = edits([overlay("a", { video_effects: [blur] }), overlay("b")], [segment("s1", { video_effects: [blur] })]);
    expect(sharedVideoStack({ edits: state, pick: mixed })).toEqual([blur]);
    const radius = blurKind.settings[0] as AudioEffectSetting;
    const set = setVideoEffectSetting({ edits: state, pick: mixed }, 0, radius, 30)!.edits;
    expect([...segmentStacks(set), ...stacks(set)]).toEqual([[{ ...blur, params: { radius: 30 } }], [{ ...blur, params: { radius: 30 } }], undefined]);
    // The Overlays not picked are as they were, the same list when none of them changed.
    const added = addVideoEffect({ edits: state, pick: picked({ kind: "segment", id: "s1" }) }, grainKind)!.edits;
    expect(segmentStacks(added)).toEqual([[blur, grain]]);
    expect(added.overlays).toBe(state.overlays);
    // Unequal, an entry's actions do nothing; Add effect still adds to both.
    const differ = edits([overlay("a")], [segment("s1", { video_effects: [blur] })]);
    expect(sharedVideoStack({ edits: differ, pick: mixed })).toBe("mixed");
    expect(removeVideoEffect({ edits: differ, pick: mixed }, 0)).toBeNull();
    const both = addVideoEffect({ edits: differ, pick: mixed }, blurKind)!.edits;
    expect([...segmentStacks(both), ...stacks(both)]).toEqual([[blur], [blur]]);
  });

  test("a stack dragged shows at once on its Segment, at the frame's size", () => {
    const plan = { segments: [{ id: "s1" } as SegmentPlan], overlays: [] as OverlayEvent[] } as RenderPlan;
    const drawn = draftVideoEffects(plan, [segment("s1", { video_effects: [{ ...blur, params: { radius: 30 } }] })], [], [blurKind]);
    expect(drawn.segments[0].video_effects).toEqual([{ ...blur, params: { radius: 30 } }]);
    expect(draftVideoEffects(plan, [segment("s1")], [], [blurKind])).toBe(plan);
  });
});

describe("an Adjustment Layer's stack", () => {
  const layer = (id: string, changes: Partial<AdjustmentLayer> = {}): AdjustmentLayer => ({
    id, start: 1, secs: 2, grade: NEUTRAL_GRADE, strength: 100, fade_in: 0, fade_out: 0, ...changes,
  });
  const layerStacks = (state: AdvancedEdits) => (state.adjustment_layers ?? []).map((each) => each.video_effects);

  test("the Inspector's actions take a picked layer, with an Overlay in a mixed Pick", () => {
    const state = { ...edits([overlay("a")]), adjustment_layers: [layer("l1"), layer("l2")] };
    const added = addVideoEffect({ edits: state, pick: picked({ kind: "adjustment", id: "l1" }) }, blurKind)!.edits;
    expect(layerStacks(added)).toEqual([[blur], undefined]);
    expect(added.overlays).toBe(state.overlays);
    const mixed = picked({ kind: "adjustment", id: "l1" }, { kind: "overlay", id: "a" });
    const both = addVideoEffect({ edits: added, pick: mixed }, blurKind)!.edits;
    expect([...layerStacks(both), ...stacks(both)]).toEqual([[blur], undefined, [blur]]);
    expect(sharedVideoStack({ edits: both, pick: mixed })).toEqual([blur]);
    expect(layerStacks(removeAllVideoEffects({ edits: both, pick: mixed })!.edits)).toEqual([undefined, undefined]);
  });

  const event = (changes: Partial<AdjustmentEvent> = {}): AdjustmentEvent => ({
    id: "l1", start: 1, end: 3, grade: NEUTRAL_GRADE, strength: 100, fade_in: 0, fade_out: 0, video_effects: [blur], ...changes,
  });
  const planOf = (...layers: AdjustmentEvent[]) => ({ segments: [], overlays: [], adjustment_layers: layers }) as unknown as RenderPlan;

  test("a neutral layer with effects shows over its span, mixed by its strength and fades", () => {
    expect(adjustmentFilters(planOf(event()), 0.5)).toEqual([]);
    const [shown] = adjustmentFilters(planOf(event({ strength: 50 })), 2);
    expect(shown).toMatchObject({ id: "l1", effects: [blur], weight: 0.5 });
    expect(shown.filterId).toBeTruthy();
    expect(adjustmentFilters(planOf(event({ fade_in: 1 })), 1.25)[0].weight).toBe(0.25);
    // Neither a neutral Grade nor an effect drawn: nothing.
    expect(adjustmentFilters(planOf(event({ video_effects: [] })), 2)).toEqual([]);

    // Its filter blurs over the frame's box, then mixes the blurred picture over the picture as it was.
    const markup = renderToStaticMarkup(
      createElement("svg", null, createElement(GradeFilter, { id: "f", grade: shown.grade, mix: shown.weight, effects: shown.effects, box: PORTRAIT })),
    );
    expect(markup).toContain('primitiveUnits="objectBoundingBox"');
    expect(markup.indexOf("feGaussianBlur")).toBeLessThan(markup.indexOf("feComposite"));
    expect(markup).toContain('k2="0.5"');
  });

  test("a stack dragged shows at once on its layer, at the frame's size", () => {
    const plan = planOf(event({ video_effects: [] }));
    const drawn = draftVideoEffects(plan, [], [], [blurKind], [layer("l1", { video_effects: [{ ...blur, params: { radius: 30 } }] })]);
    expect(drawn.adjustment_layers![0].video_effects).toEqual([{ ...blur, params: { radius: 30 } }]);
    expect(draftVideoEffects(plan, [], [], [blurKind], [layer("l1")])).toBe(plan);
  });
});

// .scratch/video-effects/issues/05-light-and-time-effects.md
describe("Glow, Bloom pulse and Film grain in the preview", () => {
  const frame = { width: 1080, height: 1920 };
  const effect = (id: string, params: Record<string, number>): VideoEffect => ({ id, params, enabled: true });
  const pulse = effect("bloom-pulse", { amount: 80, speed: 2 });
  const fine = effect("film-grain", { amount: 12 });

  test("Glow blurs the picture by its spread, screens it over and mixes that by its amount", () => {
    const primitives = effectPrimitives([effect("glow", { amount: 45 })], frame);
    expect(primitives.find((primitive) => primitive.element === "feGaussianBlur")!.attributes.stdDeviation).toBe("0.014815 0.008333");
    expect(primitives.find((primitive) => primitive.element === "feBlend")!.attributes.mode).toBe("screen");
    expect(primitives.at(-1)!.attributes).toMatchObject({ operator: "arithmetic", k2: "0.45", k3: "0.55" });
    // A picture drawn at half the frame's size glows half as wide, in pixels.
    const half = effectPrimitives([effect("glow", { amount: 45 })], { width: 540, height: 960 });
    expect(half.find((primitive) => primitive.element === "feGaussianBlur")!.attributes.stdDeviation).toBe("0.014815 0.008333");
  });

  test("Bloom pulse's strength breathes as the render's, from its item's start", () => {
    expect(bloomStrength(80, 2, 0)).toBeCloseTo(0.48);
    expect(bloomStrength(80, 2, Math.PI / 4)).toBeCloseTo(0.8);
    expect(bloomStrength(80, 2, (3 * Math.PI) / 4)).toBeCloseTo(0.16);
    const [mixed] = effectPrimitives([pulse], frame).filter((primitive) => primitive.timed);
    expect(mixed.timed!(Math.PI / 4)).toEqual({ k2: "0.8", k3: "0.2" });
  });

  test("Film grain's turbulence is reseeded as the time shown moves, the same at the same time", () => {
    const [noise] = effectPrimitives([fine], frame).filter((primitive) => primitive.timed);
    expect(noise.element).toBe("feTurbulence");
    expect(noise.timed!(1)).not.toEqual(noise.timed!(1 + 1 / 30));
    expect(noise.timed!(1)).toEqual(noise.timed!(1));
  });

  test("a stack's primitives are built once per stack and box, and none to tell a stack that draws nothing", () => {
    const fisheye = vi.spyOn(IMITATIONS, "fisheye");
    const stack: VideoEffect[] = [{ id: "fisheye", params: { strength: 41 }, enabled: true }];
    expect(effectsFilterId([{ ...stack[0], enabled: false }, { id: "no-such-effect", params: {}, enabled: true }], frame)).toBeNull();
    expect(fisheye).not.toHaveBeenCalled();
    const id = effectsFilterId(stack, frame);
    expect(effectsFilterId(stack, frame)).toBe(id);
    expect(effectPrimitives(stack, frame)).toBe(effectPrimitives(stack, frame));
    expect(fisheye).toHaveBeenCalledTimes(1);
    effectPrimitives(stack, { width: 540, height: 960 });
    expect(fisheye).toHaveBeenCalledTimes(2);
    fisheye.mockRestore();
  });

  test("a stack that changes with time has a filter of its item's own, by its start", () => {
    expect(effectsFilterId([fine], frame, 1)).not.toBe(effectsFilterId([fine], frame, 2));
    expect(effectsFilterId([blur], frame, 1)).toBe(effectsFilterId([blur], frame, 2));
  });

  test("the filters are drawn at the time shown less their item's start, still while paused", () => {
    const playback = new Playback();
    playback.setSegments(playedFrom([{ start: 0, end: 10 }]));
    const drawn = (at: number, start: number) => {
      playback.seek(at);
      const filters = createElement(EffectFilters, { items: [{ effects: [fine, pulse], box: frame, start }] });
      return renderToStaticMarkup(createElement(EffectsClock, { playback, children: filters }));
    };
    const seed = (markup: string) => markup.match(/<feTurbulence[^>]*seed="(\d+)"/)![1];
    expect(seed(drawn(2, 0))).toBe("60");
    expect(seed(drawn(2, 0))).toBe(seed(drawn(2, 0)));
    expect(seed(drawn(2.5, 0))).not.toBe(seed(drawn(2, 0)));
    // An item starting 0.5 s later shows at 2.5 s what one from 0 shows at 2 s.
    expect(seed(drawn(2.5, 0.5))).toBe("60");
    expect(drawn(2.5, 0.5)).toContain(`k2="${String(Math.round(bloomStrength(80, 2, 2) * 1e6) / 1e6)}"`);
  });
});
