// Seam H (.scratch/transform-crop/spec.md): the Smart Guides (GLOSSARY.md) a picture snaps to while
// it is moved or scaled on the stage, worked out from numbers alone: the targets at the playhead,
// and the snap of the picture's bounds (its box after rotation) with the lines that mark it.
import type { Box, Picture, RenderPlan, Transform } from "../../../api";
import { SCALE_RANGE } from "./picture";
import { boundsOf, placed, type Size } from "./pictureGestures";

// How near, in CSS pixels on screen, an edge or middle comes to a guide before it snaps to it.
export const SNAP_CSS_PX = 6;
// The platforms' safe area's top and bottom (planner.py's SAFE_AREA, y 232–1536 and x 0–950).
export const SAFE_TOP = 232;
export const SAFE_BOTTOM = 1536;
// The fixed guides: the frame's middle, and the safe area's top, bottom and right edges.
export const GUIDES_X = { middle: 540, end: 950 };
export const GUIDES_Y = { start: SAFE_TOP, middle: 960, end: SAFE_BOTTOM };

/**
 * Lines down and across the frame, by the x of each down it and the y of each across: the Smart
 * Guides to draw for a snap, or the targets a picture can snap to.
 */
export interface SmartGuides {
  x: number[];
  y: number[];
}

/** How a snap is measured: frame pixels to a CSS pixel on screen now, and whether Alt is held. */
export interface SnapReach {
  unit: number;
  alt?: boolean;
}

/** A Transform snapped, and the Smart Guides that mark it. */
export interface Snapped {
  transform: Transform;
  guides: SmartGuides;
}

// An edge this near a target, in frame pixels, is on it.
const ON = 1e-6;

const lines = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
const across = (box: Box) => [box.x, box.x + box.width / 2, box.x + box.width];
const down = (box: Box) => [box.y, box.y + box.height / 2, box.y + box.height];

/**
 * The pictures shown at the playhead (`time`), by their ids on the stage: the picture of the plan's
 * Scene `scene` ("picture:<n>"; none for an automatic Scene's, or with `scene` null, as while the
 * Video Track is hidden), then the Overlays showing ("overlay:<id>").
 */
export function picturesAt(plan: RenderPlan, time: number, scene: number | null): { id: string; picture: Picture }[] {
  const behind = scene === null ? null : plan.scenes[scene]?.picture;
  const overlays = plan.overlays.filter((event) => event.start <= time && time < event.end);
  return [
    ...(behind ? [{ id: `picture:${scene}`, picture: behind }] : []),
    ...overlays.map((event) => ({ id: `overlay:${event.id}`, picture: event.picture })),
  ];
}

/**
 * What a picture dragged on the stage snaps to: the frame's edges and centre, the fixed guides, and
 * the edges and centres of the other pictures shown at the playhead by their `bounds` (all but the
 * `dragged` one). Text is not a target.
 */
export function guideTargets(frame: Size, pictures: { id: string; bounds: Box }[], dragged: string): SmartGuides {
  const others = pictures.filter((picture) => picture.id !== dragged).map((picture) => picture.bounds);
  const whole = { x: 0, y: 0, ...frame };
  return {
    x: lines([...across(whole), ...Object.values(GUIDES_X), ...others.flatMap(across)]),
    y: lines([...down(whole), ...Object.values(GUIDES_Y), ...others.flatMap(down)]),
  };
}

// The targets that `edges` are on.
const met = (edges: number[], targets: number[]) => targets.filter((target) => edges.some((edge) => Math.abs(target - edge) < ON));

// How far `edges` must move for the nearest of them to meet the nearest target within `reach`.
function nearest(edges: number[], targets: number[], reach: number): number | null {
  let best: number | null = null;
  for (const edge of edges)
    for (const target of targets) {
      const by = target - edge;
      if (Math.abs(by) <= reach && (best === null || Math.abs(by) < Math.abs(best))) best = by;
    }
  return best;
}

/**
 * A picture being moved, snapped: its bounds' nearest edge or centre on each axis moved onto the
 * nearest target within 6 CSS pixels, unless Alt is held. With the lines of every target its bounds
 * then meet.
 */
export function snapMoved(transform: Transform, fitted: Size, targets: SmartGuides, { unit, alt }: SnapReach): Snapped {
  if (alt) return { transform, guides: { x: [], y: [] } };
  const bounds = boundsOf(placed(transform, fitted));
  const reach = SNAP_CSS_PX * unit;
  // The frame's edges are targets, so a snap never takes the centre off it.
  const dx = nearest(across(bounds), targets.x, reach);
  const dy = nearest(down(bounds), targets.y, reach);
  const snapped = { ...bounds, x: bounds.x + (dx ?? 0), y: bounds.y + (dy ?? 0) };
  return {
    transform: { ...transform, x: transform.x + (dx ?? 0), y: transform.y + (dy ?? 0) },
    guides: { x: dx === null ? [] : met(across(snapped), targets.x), y: dy === null ? [] : met(down(snapped), targets.y) },
  };
}

/**
 * A picture being scaled from a corner about its centre, snapped: scaled on so that the edge of its
 * bounds nearest a target beyond it, within 6 CSS pixels, meets it (unless Alt is held). With the
 * lines of every target its bounds' edges then meet.
 */
export function snapScaled(transform: Transform, fitted: Size, targets: SmartGuides, { unit, alt }: SnapReach): Snapped {
  const none = { transform, guides: { x: [], y: [] } };
  if (alt) return none;
  const reach = SNAP_CSS_PX * unit;
  const bounds = boundsOf(placed(transform, fitted));
  // Each axis's centre, half the bounds across it, and its targets.
  const axes = [
    { centre: transform.x, half: bounds.width / 2, on: targets.x },
    { centre: transform.y, half: bounds.height / 2, on: targets.y },
  ];
  let best: { by: number; scale: number } | null = null;
  for (const { centre, half, on } of axes) {
    if (half <= 0) continue;
    for (const side of [-1, 1])
      for (const target of on) {
        const wanted = (target - centre) * side;
        const by = Math.abs(wanted - half);
        const scale = (transform.scale * wanted) / half;
        if (wanted > 0 && by <= reach && scale >= SCALE_RANGE[0] && scale <= SCALE_RANGE[1] && (!best || by < best.by)) best = { by, scale };
      }
  }
  if (!best) return none;
  const next = { ...transform, scale: best.scale };
  const snapped = boundsOf(placed(next, fitted));
  return {
    transform: next,
    guides: {
      x: met([snapped.x, snapped.x + snapped.width], targets.x),
      y: met([snapped.y, snapped.y + snapped.height], targets.y),
    },
  };
}
