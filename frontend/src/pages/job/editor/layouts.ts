import type { RenderPlan } from "../../../api";

/**
 * Whether the plan's Source is portrait (taller than wide), as the planner's `reframes` says: it
 * is shown as it was shot, Track, Split and Blur alike, except in a Scene framed by hand (Manual).
 */
export function portraitSource(plan: Pick<RenderPlan, "source_width" | "source_height"> | null): boolean {
  return !!plan && plan.source_height > plan.source_width;
}

/**
 * The Layout choices worth offering: all of them, or for a portrait Source only the ones that
 * change something there, Auto (named "As shot") and Manual, beside the clip's own when offered.
 */
export function offeredLayouts<T extends { value: string; label: string }>(options: readonly T[], portrait: boolean): T[] {
  if (!portrait) return [...options];
  return options
    .filter((option) => option.value === "default" || option.value === "auto" || option.value === "manual")
    .map((option) => (option.value === "auto" ? { ...option, label: "As shot" } : option));
}

/**
 * The choice to show as made for a saved Layout (or the clip's, "default"): on a portrait Source,
 * Track, Split and Blur all show it as shot, so they show as Auto ("As shot"), which is offered.
 */
export function shownLayout<T extends string>(layout: T, portrait: boolean): T | "auto" {
  return portrait && (layout === "track" || layout === "split" || layout === "blur") ? "auto" : layout;
}
