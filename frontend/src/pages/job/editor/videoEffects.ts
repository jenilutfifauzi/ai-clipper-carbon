import type { CSSProperties } from "react";
import { isColourSetting, type BlendMode, type Picture, type RenderPlan, type Transform, type VideoEffect, type VideoEffectKind } from "../../../api";
import { NEUTRAL_GRADE } from "./grading";
import { FRAME } from "./picture";

/*
 * The preview's Video Effects (ADR 0014): the planner's size rule, so that a slider drag shows before
 * the Preview Plan of the change comes, and each effect's SVG filter imitation, drawn on the element
 * that carries the Grade's filter (GradeFilters.tsx), after it. The imitations are written here only:
 * unlike the Grade's fold, the render has no shared fixture with them; Compare render shows the exact
 * pixels.
 */

/** How many times its fitted size an Overlay is drawn, for its effects' sizes: the larger of scale × stretch on each axis (backend's overlay_scale). */
export const overlayScale = (transform: Pick<Transform, "scale" | "stretch_x" | "stretch_y">): number =>
  transform.scale * Math.max(transform.stretch_x ?? 1, transform.stretch_y ?? 1);

/**
 * The enabled entries of `stack`, their size settings (in px, at the fitted size, as `kinds` says)
 * times `scale`, to the thousandth, and every setting a missing one takes at its default: what the
 * planner gives the plan (backend's scaled_effects). An effect not in `kinds` is left out.
 */
export function scaledEffects(stack: VideoEffect[] | undefined, scale: number, kinds: VideoEffectKind[]): VideoEffect[] {
  return (stack ?? []).flatMap((entry) => {
    const kind = kinds.find((other) => other.id === entry.id);
    if (!entry.enabled || !kind) return [];
    const params = Object.fromEntries(
      kind.settings.map((setting) => {
        const value = entry.params[setting.key] ?? setting.default;
        const size = !isColourSetting(setting) && setting.unit === "px" && typeof value === "number";
        return [setting.key, size ? Math.round(value * scale * 1000) / 1000 : value];
      }),
    );
    return [{ id: entry.id, params, enabled: true }];
  });
}

/**
 * `plan` with its Segments', Overlays' and Adjustment Layers' Video Effects as the draft's `segments`,
 * `overlays` and `layers` give them now (by id), a Segment's and a layer's at the frame's size (scale
 * 1) and an Overlay's scaled by its scale, so that a slider dragged shows at once, before the Preview
 * Plan of the change comes. `plan` itself when none differs, or while the catalogue (`kinds`) isn't
 * loaded.
 */
export function draftVideoEffects(
  plan: RenderPlan,
  segments: { id: string; video_effects?: VideoEffect[] }[],
  overlays: { id: string; transform: Transform; video_effects?: VideoEffect[] }[],
  kinds: VideoEffectKind[] | null,
  layers: { id: string; video_effects?: VideoEffect[] }[] = [],
): RenderPlan {
  if (!kinds) return plan;
  const segmentStacks = new Map(segments.map((segment) => [segment.id, scaledEffects(segment.video_effects, 1, kinds)]));
  const overlayStacks = new Map(overlays.map((overlay) => [overlay.id, scaledEffects(overlay.video_effects, overlayScale(overlay.transform), kinds)]));
  const layerStacks = new Map(layers.map((layer) => [layer.id, scaledEffects(layer.video_effects, 1, kinds)]));
  const redrawn = <T extends { id: string; video_effects?: VideoEffect[] }>(events: T[], stacks: Map<string, VideoEffect[]>): T[] => {
    const differs = (event: T) => stacks.has(event.id) && JSON.stringify(stacks.get(event.id)) !== JSON.stringify(event.video_effects ?? []);
    return events.some(differs) ? events.map((event) => (differs(event) ? { ...event, video_effects: stacks.get(event.id) } : event)) : events;
  };
  const shownSegments = redrawn(plan.segments, segmentStacks);
  const shownOverlays = redrawn(plan.overlays, overlayStacks);
  const adjustments = plan.adjustment_layers ?? [];
  const shownLayers = redrawn(adjustments, layerStacks);
  if (shownSegments === plan.segments && shownOverlays === plan.overlays && shownLayers === adjustments) return plan;
  return { ...plan, segments: shownSegments, overlays: shownOverlays, ...(shownLayers !== adjustments && { adjustment_layers: shownLayers }) };
}

/** The id of the Adjustment Layer `auditionedPlan` draws an Effects card's effect with. */
export const AUDITION_LAYER = "audition";

/**
 * `plan` with `effect` (planned: enabled, sizes the frame's) over its whole frame, Main Track and
 * Overlays: an Adjustment Layer of a neutral Grade over the whole Clip, applied after the others. It
 * is how an Effects card under the mouse tries its effect with nothing picked, never saved.
 */
export function auditionedPlan(plan: RenderPlan, effect: VideoEffect): RenderPlan {
  const layer = { id: AUDITION_LAYER, start: 0, end: Number.MAX_SAFE_INTEGER, grade: NEUTRAL_GRADE, strength: 100, fade_in: 0, fade_out: 0, video_effects: [effect] };
  return { ...plan, adjustment_layers: [...(plan.adjustment_layers ?? []), layer] };
}

/**
 * The CSS `mix-blend-mode` an Overlay's Blend Mode (ADR 0014) is drawn with on its outer element, as
 * the render blends it: Add is `plus-lighter`. Undefined for Normal (or none).
 */
export function mixBlendMode(blend: BlendMode | undefined): CSSProperties["mixBlendMode"] {
  if (!blend || blend === "normal") return undefined;
  return blend === "add" ? "plus-lighter" : blend;
}

/** An SVG filter primitive: its element's name, its attributes and its own child elements (an feComponentTransfer's functions). */
export interface Primitive {
  element:
    | "feGaussianBlur"
    | "feOffset"
    | "feComposite"
    | "feFlood"
    | "feTile"
    | "feMorphology"
    | "feImage"
    | "feDisplacementMap"
    | "feColorMatrix"
    | "feComponentTransfer"
    | "feFuncR"
    | "feFuncG"
    | "feFuncB"
    | "feFuncA"
    | "feBlend"
    | "feTurbulence";
  attributes: Record<string, string>;
  children?: Primitive[];
  // For an effect that changes with time (Bloom pulse, Film grain): the attributes it changes, at
  // `time` seconds into its item (from its start on the Timeline, as the render counts it), which
  // the preview writes on Playback's frame (GradeFilters' TimedPrimitive). `attributes` hold them at 0.
  timed?: (time: number) => Record<string, string>;
}

// The size, in output pixels, of the element an effect's filter is on: an Overlay's whole item as
// drawn (its crop cuts it after), which the filter's units are fractions of.
export type Box = { width: number; height: number };

const number = (value: number) => String(Math.round(value * 1e6) / 1e6);

// The previous primitive's result, named `name` for an imitation that reads it more than once. Each
// effect is in a stack once, so its names, `vfx-<effect>-…`, are the filter's alone.
const kept = (name: string): Primitive => ({ element: "feOffset", attributes: { dx: "0", dy: "0", result: name } });

// `a` and `b` (premultiplied) added, `a` times `ka` and `b` times `kb`.
const added = (a: string, b: string, ka: number, kb: number, result?: string): Primitive => ({
  element: "feComposite",
  attributes: { in: a, in2: b, operator: "arithmetic", k1: "0", k2: number(ka), k3: number(kb), k4: "0", ...(result && { result }) },
});

// How many map pixels across and down a displacement map has: its offsets are smooth, and the
// browser's scaling of the image fills in between.
const MAP_SIZE = 64;

/**
 * A displacement map for feDisplacementMap as a data URL (a 24-bit BMP, which needs no canvas): at
 * each point (u, v) of the element (fractions of its box, from the top left) its red and green are
 * 0.5 plus `offset`'s (du, dv), the fraction of the box to sample from, over `scale`.
 */
export function displacementMap(offset: (u: number, v: number) => [number, number], scale: number): string {
  const row = MAP_SIZE * 3;
  const bytes = new Uint8Array(54 + row * MAP_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, MAP_SIZE, true);
  view.setInt32(22, MAP_SIZE, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round((0.5 + value / scale) * 255)));
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const [du, dv] = offset((x + 0.5) / MAP_SIZE, (y + 0.5) / MAP_SIZE);
      // Rows from the bottom; each pixel blue, green, red.
      const at = 54 + (MAP_SIZE - 1 - y) * row + x * 3;
      bytes.set([0, channel(dv), channel(du)], at);
    }
  }
  return `data:image/bmp;base64,${btoa(String.fromCharCode(...bytes))}`;
}

// The largest of `offset`'s over displacementMap's points, both ways, doubled: the scale its map needs.
function mapScale(offset: (u: number, v: number) => [number, number]): number {
  let most = 0;
  for (let y = 0; y < MAP_SIZE; y++)
    for (let x = 0; x < MAP_SIZE; x++) most = Math.max(most, ...offset((x + 0.5) / MAP_SIZE, (y + 0.5) / MAP_SIZE).map(Math.abs));
  return Math.max(2 * most, 1e-3);
}

/**
 * `input` with each point (u, v) of the element showing the one `times` × `offset(u, v)` from it, the
 * offsets (across, down) in fractions of the element's box. As Chrome draws it: an feDisplacementMap's
 * scale, in a box's units, counts in the box's width both ways, so the map's offsets down are
 * counted in widths too.
 */
function displaced(input: string, offset: (u: number, v: number) => [number, number], box: Box, times: number, result?: string): Primitive[] {
  const inWidths = (u: number, v: number): [number, number] => {
    const [du, dv] = offset(u, v);
    return [du, (dv * box.height) / box.width];
  };
  const scale = mapScale(inWidths);
  return [
    { element: "feImage", attributes: { href: displacementMap(inWidths, scale), x: "0", y: "0", width: "1", height: "1", preserveAspectRatio: "none", result: `${input}-map` } },
    {
      element: "feDisplacementMap",
      attributes: { in: input, in2: `${input}-map`, scale: number(scale * times), xChannelSelector: "R", yChannelSelector: "G", ...(result && { result }) },
    },
  ];
}

// The spread of Glow's and Bloom pulse's light, a Gaussian's sigma in output pixels at the fitted size (backend's GLOW_SIGMA, BLOOM_SIGMA).
const GLOW_SIGMA = 16;
const BLOOM_SIGMA = 12;
// How many new grain patterns the preview draws each second while playing.
const GRAIN_RATE = 30;

// A Gaussian of `sigma` output pixels at the fitted size, grown with the element's box as the
// render's grows with the picture's drawn size (its scale: the larger of its sides over the frame's).
const lightBlur = (sigma: number, box: Box, result: string): Primitive => {
  const drawn = sigma * Math.max(box.width / FRAME.width, box.height / FRAME.height);
  return { element: "feGaussianBlur", attributes: { stdDeviation: `${number(drawn / box.width)} ${number(drawn / box.height)}`, result } };
};

// `light` screened over `input`, and the result mixed over `input` by `strength` (0..1): the
// render's screen of the light times the strength (screen(a, s b) = a + s (screen(a, b) - a)).
const screenedBy = (input: string, light: string, strength: number): Primitive[] => [
  { element: "feBlend", attributes: { in: input, in2: light, mode: "screen", result: `${light}-screen` } },
  added(`${light}-screen`, input, strength, 1 - strength),
];

/** Bloom pulse's strength (0..1) at `time` seconds into its item: `amount` × (0.6 + 0.4 sin(time × `speed`)), as the render's. */
export const bloomStrength = (amount: number, speed: number, time: number): number =>
  Math.max(0, (amount / 100) * (0.6 + 0.4 * Math.sin(time * speed)));

// The highlights' weight at a luma of `level` (0..1): past 0.55, smoothed and to the 2.4th power, as the render's.
const highlight = (level: number) => {
  const knee = Math.max(0, Math.min((level - 0.55) / 0.45, 1));
  return (knee * knee * (3 - 2 * knee)) ** 2.4;
};

/** Each picture point's offset under the render's Fisheye of `strength` (%), as a fraction of a box `width` x `height`: its two stages of (1 - s) + s r². */
export function fisheyeOffset(strength: number, box: Box): (u: number, v: number) => [number, number] {
  const s = (strength / 100) * 0.3;
  const stage = (r: number) => r * (1 - s + s * r * r);
  const corner = Math.hypot(box.width, box.height) / 2;
  return (u, v) => {
    const r = Math.hypot((u - 0.5) * box.width, (v - 0.5) * box.height) / corner;
    const grown = r > 0 ? stage(stage(r)) / r - 1 : (1 - s) ** 2 - 1;
    return [(u - 0.5) * grown, (v - 0.5) * grown];
  };
}

/** A display colour's chroma, BT.709's Cb and Cr (-0.5 to 0.5), as the render's key measures it (backend's chroma). */
export const chroma = (red: number, green: number, blue: number): [number, number] => [
  -0.1146 * red - 0.3854 * green + 0.5 * blue,
  0.5 * red - 0.4542 * green - 0.0458 * blue,
];

/** A `#RRGGBB` colour's red, green and blue, 0 to 1. */
export const hexRgb = (colour: string): [number, number, number] => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255) as [number, number, number];

// 0 below `edge`, 1 past `edge` + `width`, smooth between (the render's smoothstep).
const smoothstep = (edge: number, width: number, value: number) => {
  const t = Math.max(0, Math.min((value - edge) / width, 1));
  return t * t * (3 - 2 * t);
};

// How many points a key's tables have: the browser fills in between them linearly.
const KEY_TABLE = 65;
const table = (f: (x: number) => number) => Array.from({ length: KEY_TABLE }, (_, i) => number(f(i / (KEY_TABLE - 1)))).join(" ");
// A colour matrix's rows of `rows` (each five numbers: red, green, blue, alpha and a constant).
const matrix = (rows: number[][]) => rows.map((row) => row.map(number).join(" ")).join(" ");

// `input` with the alpha of `keep` (whose alpha is the key's) times its own: its colours `colours`'s.
const keyedBy = (input: string, keep: string, colours: string): Primitive[] => [
  { element: "feComposite", attributes: { in: keep, in2: input, operator: "in", result: `${keep}-mask` } },
  { element: "feComposite", attributes: { in: colours, in2: `${keep}-mask`, operator: "in" } },
];

/**
 * Each effect's imitation, by id, from its planned settings (sizes as drawn, in output pixels; a
 * colour setting's `#RRGGBB` in `colours`) and the element's `box`, in the filter's units (fractions
 * of the element's box, primitiveUnits objectBoundingBox), so that it holds at any size of the stage.
 */
export const IMITATIONS: Record<string, (params: Record<string, number>, box: Box, colours: Record<string, string>) => Primitive[]> = {
  // Exact but for the picture's edges, which ffmpeg extends and an SVG blur fades out.
  "gaussian-blur": ({ radius }, box) => [{ element: "feGaussianBlur", attributes: { stdDeviation: `${number(radius / box.width)} ${number(radius / box.height)}` } }],
  // Along an axis, the render's Gaussian along the line exactly. Otherwise near: nine samples along
  // the line, half a sigma apart and weighted as a Gaussian, then softened between them.
  "motion-blur": ({ length, angle }, box) => {
    const radians = (angle * Math.PI) / 180;
    const [across, down] = [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))];
    const blur = (sigma: number): Primitive => ({
      element: "feGaussianBlur",
      attributes: { stdDeviation: `${number((sigma * across) / box.width)} ${number((sigma * down) / box.height)}` },
    });
    if (angle % 90 === 0) return [blur(length)];
    const taps = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
    const weights = taps.map((tap) => Math.exp(-(tap * tap) / 8));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return [
      kept("vfx-motion"),
      ...taps.flatMap((tap, i): Primitive[] => [
        {
          element: "feOffset",
          attributes: {
            in: "vfx-motion",
            dx: number((tap * length * 0.5 * Math.cos(radians)) / box.width),
            dy: number((-tap * length * 0.5 * Math.sin(radians)) / box.height),
            result: "vfx-motion-tap",
          },
        },
        i === 0
          ? added("vfx-motion-tap", "vfx-motion-tap", weights[i] / total, 0, "vfx-motion-sum")
          : added("vfx-motion-sum", "vfx-motion-tap", 1, weights[i] / total, "vfx-motion-sum"),
      ]),
      blur(length / 4),
    ];
  },
  // Near: the render's blocks take their pixels' mean; here, the pixel at each block's middle.
  pixelate: ({ size }, box) => {
    const block = Math.max(1, Math.round(size));
    const dot = Math.max(1, block / 4);
    const across = (px: number) => number(px / box.width);
    const down = (px: number) => number(px / box.height);
    return [
      kept("vfx-pixelate"),
      { element: "feFlood", attributes: { x: across((block - dot) / 2), y: down((block - dot) / 2), width: across(dot), height: down(dot), floodColor: "#fff", result: "vfx-pixelate-dot" } },
      { element: "feOffset", attributes: { in: "vfx-pixelate-dot", dx: "0", dy: "0", x: "0", y: "0", width: across(block), height: down(block), result: "vfx-pixelate-cell" } },
      { element: "feTile", attributes: { in: "vfx-pixelate-cell", result: "vfx-pixelate-dots" } },
      { element: "feComposite", attributes: { in: "vfx-pixelate", in2: "vfx-pixelate-dots", operator: "in" } },
      { element: "feMorphology", attributes: { operator: "dilate", radius: `${across((block - dot) / 2)} ${down((block - dot) / 2)}` } },
    ];
  },
  // Near: red and blue sampled nearer to and further from the middle, green and the alpha kept.
  "chromatic-aberration": ({ shift }, box) => {
    const k = shift / (0.5 * box.width);
    // From the middle, as far as the point is.
    const outward = (u: number, v: number): [number, number] => [u - 0.5, v - 0.5];
    // One channel of `input` (the others 0, opaque: the alpha is the input's again at the end).
    const only = (channel: number, input: string, result: string): Primitive => ({
      element: "feColorMatrix",
      attributes: {
        in: input,
        type: "matrix",
        values: [0, 1, 2, 3].map((row) => [0, 1, 2, 3, 4].map((column) => Number(row === 3 ? column === 4 : row === channel && column === channel)).join(" ")).join(" "),
        result,
      },
    });
    return [
      kept("vfx-chromatic"),
      ...displaced("vfx-chromatic", outward, box, -k / (1 + k), "vfx-chromatic-red"),
      only(0, "vfx-chromatic-red", "vfx-chromatic-red"),
      only(1, "vfx-chromatic", "vfx-chromatic-green"),
      ...displaced("vfx-chromatic", outward, box, k / Math.max(1 - k, 0.01), "vfx-chromatic-blue"),
      // Past the picture's edges, its own blue (the render's takes the edge's).
      { element: "feComposite", attributes: { in: "vfx-chromatic-blue", in2: "vfx-chromatic", operator: "over", result: "vfx-chromatic-blue" } },
      only(2, "vfx-chromatic-blue", "vfx-chromatic-blue"),
      added("vfx-chromatic-red", "vfx-chromatic-green", 1, 1, "vfx-chromatic-sum"),
      added("vfx-chromatic-sum", "vfx-chromatic-blue", 1, 1, "vfx-chromatic-sum"),
      { element: "feComposite", attributes: { in: "vfx-chromatic-sum", in2: "vfx-chromatic", operator: "in" } },
    ];
  },
  // The render's mapping, sampled into a map.
  fisheye: ({ strength }, box) => {
    return [kept("vfx-fisheye"), ...displaced("vfx-fisheye", fisheyeOffset(strength, box), box, 1)];
  },
  // Near: the render blurs at a quarter of the picture's size; the box here is its whole item.
  glow: ({ amount }, box) => [kept("vfx-glow"), lightBlur(GLOW_SIGMA, box, "vfx-glow-light"), ...screenedBy("vfx-glow", "vfx-glow-light", amount / 100)],
  // Near: the highlights by a table of the luma, blurred and screened; its strength breathes with
  // the time shown (`timed`), still while paused.
  "bloom-pulse": ({ amount, speed }, box) => {
    const weights = Array.from({ length: 33 }, (_, i) => number(highlight(i / 32))).join(" ");
    const func = (element: "feFuncR" | "feFuncG" | "feFuncB"): Primitive => ({ element, attributes: { type: "table", tableValues: weights } });
    const luma = "0.2126 0.7152 0.0722 0 0";
    const [screen, mixed] = screenedBy("vfx-bloom", "vfx-bloom-light", bloomStrength(amount, speed, 0));
    const at = (time: number) => {
      const strength = bloomStrength(amount, speed, time);
      return { k2: number(strength), k3: number(1 - strength) };
    };
    return [
      kept("vfx-bloom"),
      { element: "feColorMatrix", attributes: { type: "matrix", values: `${luma} ${luma} ${luma} 0 0 0 1 0` } },
      { element: "feComponentTransfer", attributes: { result: "vfx-bloom-weight" }, children: [func("feFuncR"), func("feFuncG"), func("feFuncB")] },
      { element: "feComposite", attributes: { in: "vfx-bloom", in2: "vfx-bloom-weight", operator: "arithmetic", k1: "1", k2: "0", k3: "0", k4: "0" } },
      lightBlur(BLOOM_SIGMA, box, "vfx-bloom-light"),
      screen,
      { ...mixed, timed: at },
    ];
  },
  // Exact: each channel's value rounded to the nearest of `levels` steps.
  posterize: ({ levels }) => {
    const steps = Math.max(2, Math.round(levels));
    // Half-steps, so that each value's nearest step is the one it rounds to.
    const table = Array.from({ length: 2 * (steps - 1) }, (_, i) => number(Math.ceil(i / 2) / (steps - 1))).join(" ");
    const func = (element: "feFuncR" | "feFuncG" | "feFuncB"): Primitive => ({ element, attributes: { type: "discrete", tableValues: table } });
    return [{ element: "feComponentTransfer", attributes: {}, children: [func("feFuncR"), func("feFuncG"), func("feFuncB")] }];
  },
  // Near: grey noise of about the render's size, a fine turbulence (its frequency, in Chrome, per CSS
  // pixel of the element, whatever its units) reseeded GRAIN_RATE times a second of the time shown, so
  // that it moves while playing and is still while paused. The alpha kept.
  "film-grain": ({ amount }) => {
    const spread = (4 * amount) / 255;
    return [
      kept("vfx-grain"),
      {
        element: "feTurbulence",
        attributes: { type: "fractalNoise", baseFrequency: "0.8", numOctaves: "1", seed: "0", result: "vfx-grain-noise" },
        timed: (time) => ({ seed: String(Math.max(0, Math.floor(time * GRAIN_RATE))) }),
      },
      // Its red as grey, at an alpha of a half, which the sum below takes back out.
      { element: "feColorMatrix", attributes: { in: "vfx-grain-noise", type: "matrix", values: "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 0.5", result: "vfx-grain-grey" } },
      { element: "feComposite", attributes: { in: "vfx-grain", in2: "vfx-grain-grey", operator: "arithmetic", k1: "0", k2: "1", k3: number(2 * spread), k4: number(-spread) } },
      { element: "feComposite", attributes: { in2: "vfx-grain", operator: "in" } },
    ];
  },
  // Near: the render's key of the chroma's distance to the key colour's, by a colour matrix (each of
  // Cb and Cr's difference about a half), a table squaring each, their sum (twice it, as the alpha)
  // and a table from its root to the key's alpha; the spill taken out of the colours by the lean
  // towards the key's hue in a matrix, its parts added and taken away (the latter added to inverted
  // colours: a composite never goes below 0) on an opaque copy. The input's own alpha times the key's.
  "chroma-key": ({ similarity, softness, spill }, _box, { color }) => {
    const [keyCb, keyCr] = chroma(...hexRgb(color ?? "#00B140"));
    const cb = [-0.1146, -0.3854, 0.5];
    const cr = [0.5, -0.4542, -0.0458];
    const opaque = [0, 0, 0, 0, 1];
    const square = table((x) => (2 * x - 1) ** 2);
    const keep = table((x) => smoothstep(similarity / 100, Math.max(softness / 100, 0.001), Math.sqrt(x)));
    const reach = Math.hypot(keyCb, keyCr);
    const [towardsCb, towardsCr] = reach > 1e-4 ? [keyCb / reach, keyCr / reach] : [0, 0];
    // One of the key's hue in red, green and blue at the same luma; the lean, a row of the colours.
    const lean = [1.5748 * towardsCr, -0.1873 * towardsCb - 0.4681 * towardsCr, 1.8556 * towardsCb];
    const dot = [0, 1, 2].map((c) => towardsCb * cb[c] + towardsCr * cr[c]);
    const leaned = (sign: 1 | -1) => matrix([...lean.map((step) => [...dot.map((d) => (spill / 100) * Math.max(sign * step, 0) * d), 0, 0]), opaque]);
    const inverted = matrix([[-1, 0, 0, 0, 1], [0, -1, 0, 0, 1], [0, 0, -1, 0, 1], [0, 0, 0, 1, 0]]);
    const cleaned: Primitive[] =
      spill > 0 && reach > 1e-4
        ? [
            { element: "feColorMatrix", attributes: { in: "vfx-chroma", type: "matrix", values: leaned(-1), result: "vfx-chroma-up" } },
            { element: "feColorMatrix", attributes: { in: "vfx-chroma", type: "matrix", values: leaned(1), result: "vfx-chroma-down" } },
            added("vfx-chroma-base", "vfx-chroma-up", 1, 1, "vfx-chroma-raised"),
            { element: "feColorMatrix", attributes: { in: "vfx-chroma-raised", type: "matrix", values: inverted, result: "vfx-chroma-inverted" } },
            added("vfx-chroma-inverted", "vfx-chroma-down", 1, 1, "vfx-chroma-lowered"),
            { element: "feColorMatrix", attributes: { in: "vfx-chroma-lowered", type: "matrix", values: inverted, result: "vfx-chroma-clean" } },
          ]
        : [{ element: "feOffset", attributes: { in: "vfx-chroma-base", dx: "0", dy: "0", result: "vfx-chroma-clean" } }];
    return [
      kept("vfx-chroma"),
      {
        element: "feColorMatrix",
        attributes: {
          type: "matrix",
          values: matrix([[...cb.map((k) => k / 2), 0, 0.5 - keyCb / 2], [...cr.map((k) => k / 2), 0, 0.5 - keyCr / 2], [0, 0, 0, 0, 0], opaque]),
        },
      },
      { element: "feComponentTransfer", attributes: {}, children: [{ element: "feFuncR", attributes: { type: "table", tableValues: square } }, { element: "feFuncG", attributes: { type: "table", tableValues: square } }] },
      { element: "feColorMatrix", attributes: { type: "matrix", values: matrix([[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 2, 0, 0, 0]]) } },
      { element: "feComponentTransfer", attributes: { result: "vfx-chroma-keep" }, children: [{ element: "feFuncA", attributes: { type: "table", tableValues: keep } }] },
      { element: "feColorMatrix", attributes: { in: "vfx-chroma", type: "matrix", values: matrix([[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], opaque]), result: "vfx-chroma-base" } },
      ...cleaned,
      ...keyedBy("vfx-chroma", "vfx-chroma-keep", "vfx-chroma-clean"),
    ];
  },
  // The render's key of the luma (BT.709): the luma as the alpha by a colour matrix, then a table of
  // the key's alpha; the input's own alpha times it.
  "luma-key": ({ threshold, softness, invert }) => {
    const [edge, width] = [threshold / 100, Math.max(softness / 100, 0.001)];
    const keep = table((level) => (invert > 0.5 ? 1 - smoothstep(edge, width, level) : smoothstep(edge - width, width, level)));
    return [
      kept("vfx-luma"),
      { element: "feColorMatrix", attributes: { type: "matrix", values: matrix([[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0.2126, 0.7152, 0.0722, 0, 0]]) } },
      { element: "feComponentTransfer", attributes: { result: "vfx-luma-keep" }, children: [{ element: "feFuncA", attributes: { type: "table", tableValues: keep } }] },
      ...keyedBy("vfx-luma", "vfx-luma-keep", "vfx-luma"),
    ];
  },
};

/** The primitives `effects` (planned: enabled, sizes as drawn) are imitated by, in order; an effect without an imitation draws nothing. */
export const effectPrimitives = (effects: VideoEffect[], box: Box): Primitive[] =>
  effects.flatMap((effect) => {
    const imitation = effect.enabled ? IMITATIONS[effect.id] : undefined;
    if (!imitation) return [];
    const of = <T extends number | string>(kind: string) =>
      Object.fromEntries(Object.entries(effect.params).filter(([, value]) => typeof value === kind)) as Record<string, T>;
    return imitation(of<number>("number"), box, of<string>("string"));
  });

/** The size, in output pixels, of the element an Overlay's `picture` is drawn on: its whole item, scaled as its crop is. */
export const pictureBox = (picture: Picture): Box => ({
  width: (picture.width * picture.item_size[0]) / picture.crop.width,
  height: (picture.height * picture.item_size[1]) / picture.crop.height,
});

/** Whether `primitives` change with time (an effect's `timed` ones, a child's included). */
export const changesWithTime = (primitives: Primitive[]): boolean =>
  primitives.some((primitive) => !!primitive.timed || changesWithTime(primitive.children ?? []));

/**
 * The id of the SVG filter that imitates `effects` on an element of `box` (EffectFilters defines one
 * per distinct pair), or null when they draw nothing. One that changes with time is its item's own:
 * its time counts from the item's `start` on the Timeline.
 */
export function effectsFilterId(effects: VideoEffect[] | undefined, box: Box, start = 0): string | null {
  const drawn = (effects ?? []).filter((effect) => effect.enabled && IMITATIONS[effect.id]);
  const primitives = effectPrimitives(drawn, box);
  if (!primitives.length) return null;
  // Its effects and the box, which the primitives follow from (a map's data URL is too long for an id).
  const parts = drawn.flatMap(({ id, params }) => [id, ...Object.entries(params).flat()]);
  const timed = changesWithTime(primitives) ? ["at", start] : [];
  return `vfx-${[...parts, box.width, box.height, ...timed].join("-").replace(/[^0-9a-z]/gi, "_")}`;
}

/** The CSS `filter` that imitates `effects` on an element of `box` (of an item from `start`), or undefined when they draw nothing. */
export function effectsFilter(effects: VideoEffect[] | undefined, box: Box, start = 0): string | undefined {
  const id = effectsFilterId(effects, box, start);
  return id ? `url(#${id})` : undefined;
}

/** The CSS `filter` that imitates a Segment's `effects` over its whole frame (1080x1920, scale 1), from its `start`, or undefined when they draw nothing. */
export const frameEffectsFilter = (effects: VideoEffect[] | undefined, start = 0): string | undefined => effectsFilter(effects, FRAME, start);
