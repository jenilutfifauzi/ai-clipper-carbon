import type { Candidate, Framing, Layout, LayoutOverride, RenderPlan } from "../../../api";
import { NO_CROP } from "./cropGestures";
import { canvasOf } from "./canvas";
import { BLURRED, identity } from "./picture";
import type { Size } from "./pictureGestures";
import { sceneAt, sceneOverride, sourceTime } from "./ScenesTrack";

/**
 * The Manual Layout as the editors set it (docs/adr/0007): a Scene framed by hand by its own Layout
 * Override, or every Scene without one by the Candidate's Framing. A Scene switched to Manual starts
 * from the Framing the plan gives it (`ScenePlan.framing`, that of its first frame), so nothing
 * jumps: the editors never work a Framing out themselves (ADR 0001).
 */

// What of a Candidate frames its Scenes.
export type LayoutEdits = Pick<Candidate, "layout" | "framing" | "layout_overrides">;

// The Framing a Scene starts from when the plan has none for it, and a new video Segment's: its
// picture fitted over its blur, centred on the Canvas `frame`.
export const fitted = (frame: Size): Framing => ({ transform: identity(frame), crop: NO_CROP, background: BLURRED });

/**
 * The plan's Scene under `time` (Timeline time) when it is one of the Main Track's Segment `index`,
 * which shows the Source; null for another Segment's, a video's, or while the plan isn't yet of a
 * Main Track of `count` Segments.
 */
export function sourceSceneAt(plan: RenderPlan, index: number, count: number, time: number): number | null {
  if (!plan.segments.length) return count === 1 && index === 0 ? sceneAt(plan, time) : null;
  const segment = plan.segments[index];
  if (plan.segments.length !== count || !segment || segment.media) return null;
  if (time < segment.start || time > segment.end) return null;
  return sceneAt(plan, Math.min(time, segment.end - 1e-3), index);
}

// Where Layout Overrides of Scene `index` go: the middle of it, on the Source's timeline, to the millisecond.
function sceneTime(plan: RenderPlan, index: number): number | null {
  const scene = plan.scenes[index];
  const middle = scene && sourceTime(plan, index, (scene.start + scene.end) / 2);
  return middle == null ? null : Math.round(middle * 1000) / 1000;
}

/**
 * The Layout Overrides with Scene `index`'s Layout set: "default" to follow the clip's (no override
 * of its own), or a Layout of its own. Manual copies the Framing that draws what the Scene shows.
 * Null for a Scene with no Source time (a video's).
 */
export function sceneLayoutOverrides(overrides: LayoutOverride[], plan: RenderPlan, index: number, layout: Layout | "default"): LayoutOverride[] | null {
  const at = sceneTime(plan, index);
  if (at === null) return null;
  const others = overrides.filter((override) => sceneOverride([override], plan, index) === null);
  if (layout === "default") return others;
  const own: LayoutOverride = layout === "manual" ? { at, layout, framing: plan.scenes[index].framing ?? fitted(canvasOf(plan)) } : { at, layout };
  return [...others, own].sort((a, b) => a.at - b.at);
}

/** "Reframe by hand" or "Only this Scene": Scene `index` made Manual with its own copy of what it shows. */
export function reframed(edits: LayoutEdits, plan: RenderPlan, index: number): LayoutEdits | null {
  const layout_overrides = sceneLayoutOverrides(edits.layout_overrides, plan, index, "manual");
  return layout_overrides && { ...edits, layout_overrides };
}

/**
 * The clip's Layout set, for every Scene without an override; Manual frames them all as Scene
 * `index` shows now.
 */
export function withClipLayout(edits: LayoutEdits, plan: RenderPlan, index: number, layout: Layout): LayoutEdits {
  if (layout !== "manual") return { ...edits, layout, framing: null };
  return { ...edits, layout, framing: plan.scenes[index]?.framing ?? edits.framing ?? fitted(canvasOf(plan)) };
}

/**
 * "Use for all Scenes": the clip made Manual with Scene `index`'s Framing, which it then follows,
 * its own override gone.
 */
export function forAllScenes(edits: LayoutEdits, plan: RenderPlan, index: number): LayoutEdits | null {
  const layout_overrides = sceneLayoutOverrides(edits.layout_overrides, plan, index, "default");
  if (!layout_overrides) return null;
  const framing = sceneOverride(edits.layout_overrides, plan, index)?.framing ?? plan.scenes[index].framing ?? fitted(canvasOf(plan));
  return { ...edits, layout: "manual", framing, layout_overrides };
}

/**
 * Where a Manual Scene's Framing comes from (what the Grips and the inspector edit): its own
 * override, or the clip's, which every Scene without an override shares; null when it isn't Manual.
 */
export function framingSource(edits: LayoutEdits, plan: RenderPlan, index: number): { framing: Framing; own: LayoutOverride | null } | null {
  const own = sceneOverride(edits.layout_overrides, plan, index);
  if (own) return own.layout === "manual" && own.framing ? { framing: own.framing, own } : null;
  return edits.layout === "manual" && edits.framing ? { framing: edits.framing, own: null } : null;
}

/** Scene `index`'s Framing set where it comes from (`framingSource`); null when it isn't Manual. */
export function withSceneFraming(edits: LayoutEdits, plan: RenderPlan, index: number, framing: Framing): LayoutEdits | null {
  const source = framingSource(edits, plan, index);
  if (!source) return null;
  if (!source.own) return { ...edits, framing };
  const own = source.own;
  return { ...edits, layout_overrides: edits.layout_overrides.map((override) => (override === own ? { ...own, framing } : override)) };
}
