// .scratch/video-effects/issues/01-gaussian-blur-on-an-overlay.md and 02-effects-on-segments.md: an
// Overlay's and a Segment's stack of Video Effects (ADR 0014), edited from the Inspector on a Pick of
// one picture or several, each change one step of undo; carried by Split, Duplicate, the Clipboard and
// the Revision merge; and drawn by the preview.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Overlay, OverlayEvent, RenderPlan, SegmentPlan, VideoEffect, VideoEffectKind } from "../../../api";
import { videoLibraryOf } from "../../../videoEffects";
import { NO_CROP } from "../editor/cropGestures";
import { mergeEdits } from "../editor/merge";
import { playedFrom } from "../editor/playback";
import { draftVideoEffects, effectPrimitives, effectsFilterId, IMITATIONS, overlayScale, pictureBox, scaledEffects } from "../editor/videoEffects";
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

    const radius = blurKind.settings[0];
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

  test("every catalogue effect has an imitation", () => {
    for (const kind of [blurKind]) expect(IMITATIONS[kind.id], kind.id).toBeDefined();
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
    const radius = blurKind.settings[0];
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
