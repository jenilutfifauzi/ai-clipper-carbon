import type { Picture, RenderPlan, Transform, VideoEffect, VideoEffectKind } from "../../../api";
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
        return [setting.key, setting.unit === "px" ? Math.round(value * scale * 1000) / 1000 : value];
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
    | "feFuncB";
  attributes: Record<string, string>;
  children?: Primitive[];
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

/**
 * Each effect's imitation, by id, from its planned settings (sizes as drawn, in output pixels) and the
 * element's `box`, in the filter's units (fractions of the element's box, primitiveUnits
 * objectBoundingBox), so that it holds at any size of the stage.
 */
export const IMITATIONS: Record<string, (params: Record<string, number>, box: Box) => Primitive[]> = {
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
  // Exact: each channel's value rounded to the nearest of `levels` steps.
  posterize: ({ levels }) => {
    const steps = Math.max(2, Math.round(levels));
    // Half-steps, so that each value's nearest step is the one it rounds to.
    const table = Array.from({ length: 2 * (steps - 1) }, (_, i) => number(Math.ceil(i / 2) / (steps - 1))).join(" ");
    const func = (element: "feFuncR" | "feFuncG" | "feFuncB"): Primitive => ({ element, attributes: { type: "discrete", tableValues: table } });
    return [{ element: "feComponentTransfer", attributes: {}, children: [func("feFuncR"), func("feFuncG"), func("feFuncB")] }];
  },
};

/** The primitives `effects` (planned: enabled, sizes as drawn) are imitated by, in order; an effect without an imitation draws nothing. */
export const effectPrimitives = (effects: VideoEffect[], box: Box): Primitive[] =>
  effects.flatMap((effect) => (effect.enabled ? (IMITATIONS[effect.id]?.(effect.params, box) ?? []) : []));

/** The size, in output pixels, of the element an Overlay's `picture` is drawn on: its whole item, scaled as its crop is. */
export const pictureBox = (picture: Picture): Box => ({
  width: (picture.width * picture.item_size[0]) / picture.crop.width,
  height: (picture.height * picture.item_size[1]) / picture.crop.height,
});

/** The id of the SVG filter that imitates `effects` on an element of `box` (EffectFilters defines one per distinct pair), or null when they draw nothing. */
export function effectsFilterId(effects: VideoEffect[] | undefined, box: Box): string | null {
  const drawn = (effects ?? []).filter((effect) => effect.enabled && IMITATIONS[effect.id]);
  if (!effectPrimitives(drawn, box).length) return null;
  // Its effects and the box, which the primitives follow from (a map's data URL is too long for an id).
  const parts = drawn.flatMap(({ id, params }) => [id, ...Object.entries(params).flat()]);
  return `vfx-${[...parts, box.width, box.height].join("-").replace(/[^0-9a-z]/gi, "_")}`;
}

/** The CSS `filter` that imitates `effects` on an element of `box`, or undefined when they draw nothing. */
export function effectsFilter(effects: VideoEffect[] | undefined, box: Box): string | undefined {
  const id = effectsFilterId(effects, box);
  return id ? `url(#${id})` : undefined;
}

/** The CSS `filter` that imitates a Segment's `effects` over its whole frame (1080x1920, scale 1), or undefined when they draw nothing. */
export const frameEffectsFilter = (effects: VideoEffect[] | undefined): string | undefined => effectsFilter(effects, FRAME);
