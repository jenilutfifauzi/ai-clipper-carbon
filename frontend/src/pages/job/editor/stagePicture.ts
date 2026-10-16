// Seam H (.scratch/transform-crop/spec.md): the picture behind every Overlay as the stage picks it,
// worked out from numbers alone. A click there picks the Segment under the playhead: a video's,
// whose Grips set its Framing, or a Source Segment, whose Grips set its Scene's Framing where that
// is kept when the Scene is Manual, and which is only outlined when it is automatic. A gesture's
// Transform goes back into the edits once, and until the plan comes the picture is drawn from it
// (docs/adr/0001-backend-plans-frontend-draws.md, 0007).
import type { Candidate, Picture, RenderPlan, Transform } from "../../../api";
import { framingSource, withSceneFraming } from "./manual";
import { boundsOf, fittedSize, gripsOf, placed, type Grip, type Placed, type Point, type Size } from "./pictureGestures";

// What of a Candidate places the pictures of its Main Track.
export type PictureEdits = Pick<Candidate, "segments" | "layout" | "framing" | "layout_overrides">;

/**
 * The picture under the playhead, by the Segment it is of (its id): a video's, by its Framing's
 * Transform; a Manual Scene's (the plan's Scene `scene`), by its Framing's where that is kept; or an
 * automatic Scene's, which has none to set here.
 */
export type PictureSource =
  | { kind: "media"; segment: string; transform: Transform }
  | { kind: "manual"; segment: string; scene: number; transform: Transform }
  | { kind: "auto"; segment: string; scene: number };

/** The plan's Segment that its Scene `scene` is one of: the first of a Clip of one range. */
export function segmentOfScene(plan: RenderPlan, scene: number): number {
  let first = 0;
  for (const [index, segment] of plan.segments.entries()) {
    first += segment.scenes;
    if (scene < first) return index;
  }
  return Math.max(plan.segments.length - 1, 0);
}

/**
 * The picture of the plan's Segment `segment` and Scene `scene` (those under the playhead); null
 * while the plan isn't of the edits' Main Track yet, or past its end.
 */
export function pictureSource(edits: PictureEdits, plan: RenderPlan, segment: number, scene: number): PictureSource | null {
  const own = edits.segments[segment];
  const planned = plan.segments.length ? plan.segments[segment] : segment === 0 ? null : undefined;
  if (!own || planned === undefined || (plan.segments.length || 1) !== edits.segments.length) return null;
  if ((planned?.media ?? null) !== (own.media ?? null) || !plan.scenes[scene]) return null;
  if (own.media) return own.framing ? { kind: "media", segment: own.id, transform: own.framing.transform } : null;
  const first = plan.segments.slice(0, segment).reduce((count, other) => count + other.scenes, 0);
  if (planned && (scene < first || scene >= first + planned.scenes)) return null;
  const kept = framingSource(edits, plan, scene);
  return kept ? { kind: "manual", segment: own.id, scene, transform: kept.framing.transform } : { kind: "auto", segment: own.id, scene };
}

/** The edits with `source`'s Transform set to `transform`: as they are for an automatic Scene's. */
export function withPictureTransform<T extends PictureEdits>(edits: T, plan: RenderPlan, source: PictureSource, transform: Transform): T {
  if (source.kind === "auto") return edits;
  if (source.kind === "media") {
    const segments = edits.segments.map((segment) =>
      segment.id === source.segment && segment.framing ? { ...segment, framing: { ...segment.framing, transform } } : segment,
    );
    return { ...edits, segments };
  }
  const kept = framingSource(edits, plan, source.scene);
  const next = kept && withSceneFraming(edits, plan, source.scene, { ...kept.framing, transform });
  return next ? { ...edits, ...next } : edits;
}

const places = (value: number, digits: number) => Number(value.toFixed(digits));

/** A Transform as a gesture saves it: its centre to the pixel, its scale and stretch to four places, its turn to a hundredth of a degree. */
export function tidyTransform(transform: Transform): Transform {
  return {
    ...transform,
    x: Math.round(transform.x),
    y: Math.round(transform.y),
    scale: places(transform.scale, 4),
    stretch_x: places(transform.stretch_x, 4),
    stretch_y: places(transform.stretch_y, 4),
    rotation: places(transform.rotation, 2) + 0,
  };
}

/** The size a picture of the plan is fitted at (scale 1, before stretch): its crop's, as the planner fits it. */
export const fittedOf = (picture: Picture, frame: Size): Size => fittedSize({ width: picture.crop.width, height: picture.crop.height }, frame);

/**
 * A Picture of the plan as drawn by `transform` instead, while a Grip holds it: at its centre, as
 * large as its crop's fitted size makes it, turned and flipped as it says, its bounds turned with it.
 * Its crop and decoration are the plan's.
 */
export function heldPicture(picture: Picture, transform: Transform, frame: Size): Picture {
  const drawn = placed(transform, fittedOf(picture, frame));
  return {
    ...picture,
    centre: [transform.x, transform.y],
    width: drawn.width,
    height: drawn.height,
    rotation: transform.rotation,
    flip_h: transform.flip_h,
    flip_v: transform.flip_v,
    opacity: transform.opacity,
    bounds: boundsOf(drawn),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Where `picture`'s Grips are drawn on a `frame`: each where it sits on the picture as turned
 * (`gripsOf`, the rotate handle `reach` above it), but one that isn't `inset` frame pixels inside the
 * frame (the rotate handle's, `inset` + `reach` the others') is pulled in towards the centre, along
 * the line to it. What a Grip does goes by the pointer's distance and angle from the centre, and on
 * the picture's own axis for an edge, the same anywhere on that line, so a picture larger than the
 * frame (a Manual Scene's cover) still scales, stretches and turns from Grips that can be reached.
 */
export function gripsOnFrame(picture: Placed, frame: Size, reach: number, inset: number): Record<Grip, Point> {
  const grips = gripsOf(picture, reach);
  const pulled = (point: Point, margin: number): Point => {
    const [left, right, top, bottom] = [margin, frame.width - margin, margin, frame.height - margin];
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return point;
    const from = { x: clamp(picture.x, left, right), y: clamp(picture.y, top, bottom) };
    const [dx, dy] = [point.x - from.x, point.y - from.y];
    // The share of the way to the Grip that stays inside on both axes.
    const share = (to: number, start: number, by: number, low: number, high: number) =>
      to < low ? (low - start) / by : to > high ? (high - start) / by : 1;
    const t = Math.min(share(point.x, from.x, dx, left, right), share(point.y, from.y, dy, top, bottom));
    return { x: from.x + t * dx, y: from.y + t * dy };
  };
  const entries = Object.entries(grips) as [Grip, Point][];
  return Object.fromEntries(entries.map(([grip, point]) => [grip, pulled(point, grip === "rotate" ? inset : inset + reach)])) as Record<Grip, Point>;
}

// Each Grip's way out from the picture's centre, in degrees clockwise from across, unturned.
const OUTWARD: Record<Exclude<Grip, "rotate">, number> = {
  right: 0,
  "bottom-right": 45,
  bottom: 90,
  "bottom-left": 135,
  left: 180,
  "top-left": 225,
  top: 270,
  "top-right": 315,
};
const RESIZE = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The pointer over `grip` on a picture turned `rotation` degrees: the resize arrow nearest its way out. */
export function gripCursor(grip: Grip, rotation: number): string {
  if (grip === "rotate") return "grab";
  const eighths = Math.round((OUTWARD[grip] + rotation) / 45);
  return RESIZE[((eighths % 4) + 4) % 4];
}
