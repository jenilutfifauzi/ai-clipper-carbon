import type { OverlayEvent, Picture, RenderPlan, Transform, VideoEffect, VideoEffectKind } from "../../../api";

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
 * `plan` with its Overlays' Video Effects as the draft's `overlays` give them now (by id), scaled by
 * each one's scale, so that a slider dragged shows at once, before the Preview Plan of the change
 * comes. `plan` itself when none differs, or while the catalogue (`kinds`) isn't loaded.
 */
export function draftVideoEffects(
  plan: RenderPlan,
  overlays: { id: string; transform: Transform; video_effects?: VideoEffect[] }[],
  kinds: VideoEffectKind[] | null,
): RenderPlan {
  if (!kinds) return plan;
  const drafted = new Map(overlays.map((overlay) => [overlay.id, scaledEffects(overlay.video_effects, overlayScale(overlay.transform), kinds)]));
  const differs = (event: OverlayEvent) => drafted.has(event.id) && JSON.stringify(drafted.get(event.id)) !== JSON.stringify(event.video_effects ?? []);
  if (!plan.overlays.some(differs)) return plan;
  return { ...plan, overlays: plan.overlays.map((event) => (differs(event) ? { ...event, video_effects: drafted.get(event.id) } : event)) };
}

/** An SVG filter primitive: its element's name and attributes. */
export interface Primitive {
  element: "feGaussianBlur";
  attributes: Record<string, string>;
}

// The size, in output pixels, of the element an effect's filter is on: an Overlay's whole item as
// drawn (its crop cuts it after), which the filter's units are fractions of.
export type Box = { width: number; height: number };

const number = (value: number) => String(Math.round(value * 1e6) / 1e6);

/**
 * Each effect's imitation, by id, from its planned settings (sizes as drawn, in output pixels) and the
 * element's `box`, in the filter's units (fractions of the element's box, primitiveUnits
 * objectBoundingBox), so that it holds at any size of the stage.
 */
export const IMITATIONS: Record<string, (params: Record<string, number>, box: Box) => Primitive[]> = {
  // Exact but for the picture's edges, which ffmpeg extends and an SVG blur fades out.
  "gaussian-blur": ({ radius }, box) => [{ element: "feGaussianBlur", attributes: { stdDeviation: `${number(radius / box.width)} ${number(radius / box.height)}` } }],
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
  const primitives = effectPrimitives(effects ?? [], box);
  if (!primitives.length) return null;
  const parts = primitives.flatMap(({ element, attributes }) => [element, ...Object.values(attributes)]);
  return `vfx-${parts.join("-").replace(/[^0-9a-z]/gi, "_")}`;
}

/** The CSS `filter` that imitates `effects` on an element of `box`, or undefined when they draw nothing. */
export function effectsFilter(effects: VideoEffect[] | undefined, box: Box): string | undefined {
  const id = effectsFilterId(effects, box);
  return id ? `url(#${id})` : undefined;
}
