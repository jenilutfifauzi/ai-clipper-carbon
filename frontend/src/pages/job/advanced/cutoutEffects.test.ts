// .scratch/video-effects/issues/06-chroma-key-and-luma-key.md: Chroma key and Luma key (ADR 0014), an
// Overlay's only: added to the Overlays of a mixed Pick alone and not offered without one, their
// colour set from the Inspector or the eyedropper (the Overlay's media at a point, through its
// Grade), and imitated by the preview.
import { describe, expect, test } from "vitest";
import type { AdjustmentLayer, ClipSegment, Overlay, Picture, VideoEffect, VideoEffectKind } from "../../../api";
import { videoLibraryOf } from "../../../videoEffects";
import catalogue from "../../../../../backend/tests/fixtures/video_effects.json";
import { NO_CROP } from "../editor/cropGestures";
import { hexOf, mediaPointOf } from "../editor/eyedropper";
import { gradedColour, NEUTRAL_GRADE } from "../editor/grading";
import { chroma, effectPrimitives, hexRgb, scaledEffects, type Primitive } from "../editor/videoEffects";
import { addVideoEffect, isKey, keysPicked, setVideoEffectColour, sharedVideoStack } from "./actions";
import type { AdvancedEdits } from "./edits";
import { picked } from "./pick";

const kinds = catalogue as VideoEffectKind[];
const kindOf = (id: string) => kinds.find((kind) => kind.id === id)!;
const chromaKey: VideoEffect = { id: "chroma-key", params: { color: "#00B140", similarity: 30, softness: 10, spill: 50 }, enabled: true };
const lumaKey: VideoEffect = { id: "luma-key", params: { threshold: 10, softness: 10, invert: 0 }, enabled: true };

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

function edits(overlays: Overlay[], segments: ClipSegment[], layers: AdjustmentLayer[] = []): AdvancedEdits {
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
    adjustment_layers: layers,
  };
}

describe("a key is an Overlay's only", () => {
  const layer = { id: "l", start: 0, secs: 2, grade: NEUTRAL_GRADE } as AdjustmentLayer;
  const state = edits([overlay("a"), overlay("b")], [{ id: "s1", start: 100, end: 110 }], [layer]);
  const mixed = picked({ kind: "segment", id: "s1" }, { kind: "overlay", id: "a" }, { kind: "adjustment", id: "l" }, { kind: "overlay", id: "b" });

  test("Add effect on a mixed Pick of Segments, Overlays and an Adjustment Layer adds a key to the Overlays only", () => {
    const keyed = addVideoEffect({ edits: state, pick: mixed }, kindOf("chroma-key"))!.edits;
    expect(keyed.overlays.map((each) => each.video_effects)).toEqual([[chromaKey], [chromaKey]]);
    expect(keyed.segments).toBe(state.segments);
    expect(keyed.adjustment_layers).toBe(state.adjustment_layers);
    // Their stacks differ now: Mixed.
    expect(sharedVideoStack({ edits: keyed, pick: mixed })).toBe("mixed");
    // Another effect still goes on every one of them.
    const blurred = addVideoEffect({ edits: keyed, pick: mixed }, kindOf("gaussian-blur"))!.edits;
    expect(blurred.segments[0].video_effects?.map((entry) => entry.id)).toEqual(["gaussian-blur"]);
    expect(blurred.overlays[0].video_effects?.map((entry) => entry.id)).toEqual(["chroma-key", "gaussian-blur"]);
    // Without an Overlay picked, a key goes nowhere.
    const segmentOnly = { edits: state, pick: picked({ kind: "segment", id: "s1" }, { kind: "adjustment", id: "l" }) };
    expect(addVideoEffect(segmentOnly, kindOf("luma-key"))).toBeNull();
    expect(keysPicked(segmentOnly)).toBe(false);
    expect(keysPicked({ edits: state, pick: mixed })).toBe(true);
  });

  test("the library offers the keys only with an Overlay picked", () => {
    expect(kinds.filter(isKey).map((kind) => kind.id)).toEqual(["chroma-key", "luma-key"]);
    expect(videoLibraryOf(kinds, "").at(-1)).toEqual({ category: "Cutout", effects: [kindOf("chroma-key"), kindOf("luma-key")] });
    expect(videoLibraryOf(kinds, "", false).map(({ category }) => category)).not.toContain("Cutout");
    expect(videoLibraryOf(kinds, "key", false)).toEqual([]);
  });

  test("the key colour is set on every picked stack in capitals, a code that isn't one refused", () => {
    const keyed = edits([overlay("a", { video_effects: [chromaKey] }), overlay("b", { video_effects: [chromaKey] })], []);
    const both = picked({ kind: "overlay", id: "a" }, { kind: "overlay", id: "b" });
    const set = setVideoEffectColour({ edits: keyed, pick: both }, 0, "color", "#1030e0")!.edits;
    expect(set.overlays.map((each) => each.video_effects![0].params)).toEqual([0, 1].map(() => ({ ...chromaKey.params, color: "#1030E0" })));
    expect(setVideoEffectColour({ edits: keyed, pick: both }, 0, "color", "blue")).toBeNull();
    expect(setVideoEffectColour({ edits: keyed, pick: both }, 0, "color", "#00b140")).toBeNull();
    // Scaling a stack keeps its colour.
    expect(scaledEffects([chromaKey], 2, kinds)).toEqual([chromaKey]);
  });
});

// One pixel (0..1, red, green, blue, alpha) through the primitives up to `result` (a colour matrix
// or a table each, in turn: the start of an imitation, before its composites).
function through(primitives: Primitive[], result: string, pixel: number[]): number[] {
  let value = pixel;
  for (const primitive of primitives) {
    if (primitive.element === "feColorMatrix") {
      const values = primitive.attributes.values.split(" ").map(Number);
      value = [0, 1, 2, 3].map((row) => Math.min(1, Math.max(0, [0, 1, 2, 3].reduce((sum, c) => sum + values[row * 5 + c] * value[c], values[row * 5 + 4]))));
    } else if (primitive.element === "feComponentTransfer") {
      const funcs = ["feFuncR", "feFuncG", "feFuncB", "feFuncA"];
      value = value.map((channel, c) => {
        const func = primitive.children?.find((child) => child.element === funcs[c]);
        if (!func) return channel;
        const table = func.attributes.tableValues.split(" ").map(Number);
        const at = channel * (table.length - 1);
        const below = Math.min(Math.floor(at), table.length - 2);
        return table[below] + (table[below + 1] - table[below]) * (at - below);
      });
    }
    if (primitive.attributes.result === result) return value;
  }
  throw new Error(`no ${result}`);
}

describe("the preview's keys", () => {
  const box = { width: 540, height: 304 };
  const opaque = (hex: string) => [...hexRgb(hex), 1];

  test("Chroma key's alpha comes from the chroma's distance to the key colour's", () => {
    const keep = (hex: string, effect: VideoEffect = chromaKey) => through(effectPrimitives([effect], box), "vfx-chroma-keep", opaque(hex))[3];
    expect(keep("#00B140")).toBeCloseTo(0, 2);
    expect(keep("#D02020")).toBeCloseTo(1, 2);
    expect(keep("#808080")).toBeCloseTo(1, 2);
    // Within its similarity (30 % of the farthest apart), taken out; past it and its softness, kept.
    const [cb, cr] = chroma(...hexRgb("#00B140"));
    expect(Math.hypot(cb - chroma(...hexRgb("#30C060"))[0], cr - chroma(...hexRgb("#30C060"))[1]) / 0.7071).toBeLessThan(0.3);
    expect(keep("#30C060")).toBeCloseTo(0, 2);
    // Another key colour takes out its own.
    const blue = { ...chromaKey, params: { ...chromaKey.params, color: "#1030E0" } };
    expect(keep("#1030E0", blue)).toBeCloseTo(0, 2);
    expect(keep("#00B140", blue)).toBeCloseTo(1, 2);
  });

  test("Luma key's alpha comes from the luma, the dark taken out, or inverted the light", () => {
    const keep = (hex: string, params: Record<string, number> = {}) =>
      through(effectPrimitives([{ ...lumaKey, params: { ...lumaKey.params, ...params } }], box), "vfx-luma-keep", opaque(hex))[3];
    expect(keep("#000000")).toBeCloseTo(0, 2);
    expect(keep("#FFFFFF")).toBeCloseTo(1, 2);
    expect(keep("#FFFFFF", { invert: 1, threshold: 90 })).toBeCloseTo(0, 2);
    expect(keep("#000000", { invert: 1, threshold: 90 })).toBeCloseTo(1, 2);
    // At threshold 0, nothing is darker.
    expect(keep("#000000", { threshold: 0, softness: 0 })).toBeCloseTo(1, 2);
  });

  test("each key keeps the input's own alpha times its own, its spill only when it has some", () => {
    const [last] = effectPrimitives([chromaKey], box).slice(-1);
    expect(last).toEqual({ element: "feComposite", attributes: { in: "vfx-chroma-clean", in2: "vfx-chroma-keep-mask", operator: "in" } });
    const spilled = effectPrimitives([chromaKey], box).filter((primitive) => primitive.attributes.result?.startsWith("vfx-chroma-")).length;
    const unspilled = effectPrimitives([{ ...chromaKey, params: { ...chromaKey.params, spill: 0 } }], box).filter((primitive) =>
      primitive.attributes.result?.startsWith("vfx-chroma-"),
    ).length;
    expect(spilled).toBeGreaterThan(unspilled);
  });
});

describe("the eyedropper", () => {
  // 320x180 media, its left 40 px cropped off, drawn 560x360 about (540, 700).
  const picture = {
    crop: { x: 40, y: 0, width: 280, height: 180 },
    item_size: [320, 180],
    width: 560,
    height: 360,
    centre: [540, 700],
    rotation: 0,
    flip_h: false,
    flip_v: false,
  } as unknown as Picture;

  test("a point on the stage is the point of the media it shows, through the crop, flips and turn", () => {
    expect(mediaPointOf(picture, { x: 540, y: 700 })).toEqual({ x: 180, y: 90 });
    // Its drawn left edge is the crop's.
    const corner = mediaPointOf(picture, { x: 261, y: 521 })!;
    expect([corner.x, corner.y].map((value) => Math.round(value * 1000) / 1000)).toEqual([40.5, 0.5]);
    expect(mediaPointOf(picture, { x: 200, y: 700 })).toBeNull();
    const flipped = { ...picture, flip_h: true };
    expect(mediaPointOf(flipped, { x: 261, y: 700 })!.x).toBeCloseTo(319.5);
    // A quarter turn clockwise: what is right of the centre is the media's top.
    const turned = { ...picture, rotation: 90 };
    const top = mediaPointOf(turned, { x: 540 + 170, y: 700 })!;
    expect(top.x).toBeCloseTo(180);
    expect(top.y).toBeCloseTo(5);
  });

  test("the colour picked is the media's through the Overlay's Grade", () => {
    expect(hexOf(gradedColour(NEUTRAL_GRADE, hexRgb("#00B140")))).toBe("#00B140");
    const warm = { ...NEUTRAL_GRADE, adjust: { ...NEUTRAL_GRADE.adjust, temperature: 9500 } };
    const [red, , blue] = gradedColour(warm, [0.5, 0.5, 0.5]);
    expect(red).toBeGreaterThan(0.5);
    expect(blue).toBeLessThan(0.5);
    const bright = { ...NEUTRAL_GRADE, adjust: { ...NEUTRAL_GRADE.adjust, exposure: 1 } };
    expect(gradedColour(bright, [0.2, 0.2, 0.2])[0]).toBeGreaterThan(0.25);
  });
});
