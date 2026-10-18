// Seam H (.scratch/transform-crop/spec.md): the picture behind every Overlay as the stage picks it,
// worked out from numbers alone. A click there picks the Segment under the playhead: a video's,
// whose Grips set its Framing, or a Source Segment, whose Grips set its Scene's Framing where that
// is kept when the Scene is Manual, and which is only outlined when it is automatic. A gesture's
// Transform goes back into the edits once, and until the plan comes the picture is drawn from it
// (docs/adr/0001-backend-plans-frontend-draws.md, 0007).
import type { Candidate, Crop, Framing, Picture, RenderPlan, Transform } from "../../../api";
import { cropCommitted, tidyCrop, wholePicture, type CropEntry } from "./cropGestures";
import { framingSource, withSceneFraming } from "./manual";
import { clamp, fittedSize } from "./picture";
import { firstSceneOf } from "./ScenesTrack";
import { boundsOf, gripsOf, placed, type Grip, type Placed, type Point, type Size } from "./pictureGestures";

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
  const first = firstSceneOf(plan, segment);
  if (planned && (scene < first || scene >= first + planned.scenes)) return null;
  const kept = framingSource(edits, plan, scene);
  return kept ? { kind: "manual", segment: own.id, scene, transform: kept.framing.transform } : { kind: "auto", segment: own.id, scene };
}

// The edits with `source`'s Framing changed by `change`: as they are for an automatic Scene's.
function withPictureFraming<T extends PictureEdits>(edits: T, plan: RenderPlan, source: PictureSource, change: Partial<Framing>): T {
  if (source.kind === "auto") return edits;
  if (source.kind === "media") {
    const segments = edits.segments.map((segment) =>
      segment.id === source.segment && segment.framing ? { ...segment, framing: { ...segment.framing, ...change } } : segment,
    );
    return { ...edits, segments };
  }
  const kept = framingSource(edits, plan, source.scene);
  const next = kept && withSceneFraming(edits, plan, source.scene, { ...kept.framing, ...change });
  return next ? { ...edits, ...next } : edits;
}

/** The edits with `source`'s Transform set to `transform`: as they are for an automatic Scene's. */
export function withPictureTransform<T extends PictureEdits>(edits: T, plan: RenderPlan, source: PictureSource, transform: Transform): T {
  return withPictureFraming(edits, plan, source, { transform });
}

/** The Crop of `source`, kept beside its Transform: null for an automatic Scene's, which has none. */
export function pictureCrop(edits: PictureEdits, plan: RenderPlan, source: PictureSource): Crop | null {
  if (source.kind === "auto") return null;
  if (source.kind === "media") return edits.segments.find((segment) => segment.id === source.segment)?.framing?.crop ?? null;
  return framingSource(edits, plan, source.scene)?.framing.crop ?? null;
}

/**
 * The edits with `source`'s Crop set to `crop` and its Transform to `transform`, together (Crop
 * mode's commit, one step of undo): as they are for an automatic Scene's.
 */
export function withPictureCrop<T extends PictureEdits>(edits: T, plan: RenderPlan, source: PictureSource, crop: Crop, transform: Transform): T {
  return withPictureFraming(edits, plan, source, { crop, transform });
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
 * Its crop and decoration are the plan's. A keyed one is held still, without its motion. One whose
 * size at scale 1 isn't its crop's fitted to the frame (a Text Layer's area) gives it as `fitted`.
 */
export function heldPicture(picture: Picture, transform: Transform, frame: Size, fitted: Size = fittedOf(picture, frame)): Picture {
  const drawn = placed(transform, fitted);
  const { motion: _, ...still } = picture;
  return {
    ...still,
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

/** A Picture of the plan as cut by `crop` instead, until its plan comes: each edge at the nearest pixel of its item, as the planner keeps it. */
export function croppedPicture(picture: Picture, crop: Crop): Picture {
  const [width, height] = picture.item_size;
  const [left, right] = [Math.round(width * crop.left), Math.round(width * (1 - crop.right))];
  const [top, bottom] = [Math.round(height * crop.top), Math.round(height * (1 - crop.bottom))];
  return { ...picture, crop: { x: left, y: top, width: right - left, height: bottom - top } };
}

/**
 * A Picture of the plan as Crop mode shows it: its whole item, uncropped, where `entry` lays it
 * under the kept part (`wholePicture`), plain (no corners, border or shadow), to be dimmed but there.
 */
export function wholeOnStage(picture: Picture, entry: CropEntry): Picture {
  const whole = wholePicture(entry);
  const { transform, item } = entry;
  return {
    ...picture,
    crop: { x: 0, y: 0, width: item.width, height: item.height },
    centre: [whole.x, whole.y],
    width: whole.width,
    height: whole.height,
    rotation: whole.rotation,
    flip_h: transform.flip_h,
    flip_v: transform.flip_v,
    opacity: transform.opacity,
    bounds: boundsOf(whole),
    radius: 0,
    border: null,
    shadow: null,
  };
}

/**
 * What Crop mode opened as `entry` keeps when it closes on `crop`: the Crop, its edges to four places
 * and tidied (a tenth kept), with the Transform that keeps the kept part where it was
 * (`cropCommitted`, tidied as a gesture's); nothing when it is the Crop it opened with.
 */
export function cropKept(entry: CropEntry, crop: Crop): { crop: Crop; transform: Transform } | null {
  const kept = tidyCrop({ left: places(crop.left, 4), top: places(crop.top, 4), right: places(crop.right, 4), bottom: places(crop.bottom, 4) });
  const same = (Object.keys(kept) as (keyof Crop)[]).every((edge) => kept[edge] === entry.crop[edge]);
  return same ? null : { crop: kept, transform: tidyTransform(cropCommitted(entry, kept)) };
}

/**
 * Where `picture`'s Grips are drawn on a `frame`: each where it sits on the picture as turned
 * (`gripsOf`, the rotate handle `reach` above it), but one that isn't `inset` frame pixels inside the
 * frame is pulled in towards the centre, along the line to it: the rotate handle to `inset` inside,
 * the others to `inset` + `reach`, so that they stay apart. What a Grip does goes by the pointer's distance and angle from the centre, and on
 * the picture's own axis for an edge, the same anywhere on that line, so a picture larger than the
 * frame (a Manual Scene's cover) still scales, stretches and turns from Grips that can be reached.
 */
export function gripsOnFrame(picture: Placed, frame: Size, reach: number, inset: number): Record<Grip, Point> {
  const grips = gripsOf(picture, reach);
  const inside = (point: Point) => point.x >= inset && point.x <= frame.width - inset && point.y >= inset && point.y <= frame.height - inset;
  const pulled = (point: Point, margin: number): Point => {
    if (inside(point)) return point;
    const [left, right, top, bottom] = [margin, frame.width - margin, margin, frame.height - margin];
    const from = { x: clamp(picture.x, [left, right]), y: clamp(picture.y, [top, bottom]) };
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

/**
 * Which Grips a picture has: all of them (the Advanced Edit's), only its corners (the clip
 * editor's), which scale it about its centre with no edge stretch or turn, its corners and the
 * rotate handle (a Text Layer's, never stretched), or the middles of its left and right edges and
 * the rotate handle (a line's or an arrow's: its two ends).
 */
export type GripSet = "all" | "corners" | "corners-rotate" | "ends";

const ALL_GRIPS: Grip[] = ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "rotate"];
const CORNERS = new Set<Grip>(["top-left", "top-right", "bottom-right", "bottom-left"]);

/** The Grips of `set`, clockwise from the top left, the rotate handle last. */
export const gripsIn = (set: GripSet): Grip[] =>
  set === "all"
    ? ALL_GRIPS
    : set === "ends"
      ? ALL_GRIPS.filter((grip) => grip === "right" || grip === "left" || grip === "rotate")
      : ALL_GRIPS.filter((grip) => CORNERS.has(grip) || (set === "corners-rotate" && grip === "rotate"));

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

/**
 * Whether a press on a picture with these keys held toggles it in the Pick: Shift, Cmd or Ctrl on
 * its body does. A press on a Grip always starts its gesture, whatever is held: the keys then only
 * change its snaps (Shift turns in steps of 15°, Alt snaps to nothing).
 */
export function pressTogglesPick(grip: Grip | "body", keys: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return grip === "body" && (keys.shiftKey || keys.metaKey || keys.ctrlKey);
}

/** The pointer over `grip` on a picture turned `rotation` degrees: the resize arrow nearest its way out. */
export function gripCursor(grip: Grip, rotation: number): string {
  if (grip === "rotate") return "grab";
  const eighths = Math.round((OUTWARD[grip] + rotation) / 45);
  return RESIZE[((eighths % 4) + 4) % 4];
}
