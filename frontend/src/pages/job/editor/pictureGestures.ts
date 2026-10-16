// Seam H (.scratch/transform-crop/spec.md): what the Grips (GLOSSARY.md) on a picked picture do to
// its Transform, worked out from numbers alone, without React or the DOM: the picture's drawn box
// and where its Grips sit on it, then moving, corner scale, edge stretch, rotation with its snaps,
// and a phone's pinch and twist. Points are in frame (output) pixels, y down; angles are degrees
// clockwise (docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md).
import type { Box } from "../../../api";

/**
 * Where and how a picture sits on the frame (GLOSSARY.md's Transform): its centre in output pixels,
 * kept on the frame; its scale over its fitted size; its stretch across and down; its rotation; its
 * flips and opacity. Shaped as the API's Transform, so either can be passed for the other.
 */
export interface PictureTransform {
  x: number;
  y: number;
  scale: number;
  stretch_x: number;
  stretch_y: number;
  rotation: number;
  flip_h: boolean;
  flip_v: boolean;
  opacity: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A picture as drawn: its centre, its width and height before it is turned, and its rotation. */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** A picture as it was when a gesture took hold of it: its Transform, its fitted size (at scale 1,
 * before stretch, in frame pixels) and the frame's size. */
export interface Grabbed {
  transform: PictureTransform;
  fitted: Size;
  frame: Size;
}

// The Grips, by where they sit on the picture's own (unturned) box.
export type Corner = "top-left" | "top-right" | "bottom-right" | "bottom-left";
export type Edge = "top" | "right" | "bottom" | "left";
export type Grip = Corner | Edge | "rotate";

/** The keys held through a gesture: Shift turns in 15° steps, Alt snaps to nothing. */
export interface GestureKeys {
  shift?: boolean;
  alt?: boolean;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
export const MIN_STRETCH = 0.1;
export const MAX_STRETCH = 10;
// Rotation snaps to a quarter turn this near it, in degrees, and turns in steps this large with Shift.
const ROTATION_SNAP = 3;
const ROTATION_STEP = 15;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const radians = (degrees: number) => (degrees * Math.PI) / 180;
// `-0` read as 0.
const unsigned = (value: number) => value + 0;

/** The largest size `size` fits in `frame` at, keeping its aspect: a picture's size at scale 1. */
export function fittedSize(size: Size, frame: Size): Size {
  const fit = Math.min(frame.width / size.width, frame.height / size.height);
  return { width: size.width * fit, height: size.height * fit };
}

/** Where a picture is drawn by `transform`, given its fitted size. */
export function placed(transform: PictureTransform, fitted: Size): Placed {
  return {
    x: transform.x,
    y: transform.y,
    width: fitted.width * transform.scale * transform.stretch_x,
    height: fitted.height * transform.scale * transform.stretch_y,
    rotation: transform.rotation,
  };
}

/** The point `along` the picture's own x axis and `down` its own y axis from its centre. */
export function pointOnPicture(picture: Placed, along: number, down: number): Point {
  const [sin, cos] = [Math.sin(radians(picture.rotation)), Math.cos(radians(picture.rotation))];
  return { x: picture.x + along * cos - down * sin, y: picture.y + along * sin + down * cos };
}

/** How far `point` is from the picture's centre along its own x axis and down its own y axis. */
export function offsetOnPicture(picture: Point & { rotation: number }, point: Point): { along: number; down: number } {
  const [sin, cos] = [Math.sin(radians(picture.rotation)), Math.cos(radians(picture.rotation))];
  const [dx, dy] = [point.x - picture.x, point.y - picture.y];
  return { along: dx * cos + dy * sin, down: -dx * sin + dy * cos };
}

/** The picture's four corners on the frame, turned with it: its own top-left first, then clockwise. */
export function cornersOf(picture: Placed): [Point, Point, Point, Point] {
  const [w, h] = [picture.width / 2, picture.height / 2];
  return [pointOnPicture(picture, -w, -h), pointOnPicture(picture, w, -h), pointOnPicture(picture, w, h), pointOnPicture(picture, -w, h)];
}

/** The picture's bounds: the frame-aligned box around it once it is turned. */
export function boundsOf(picture: Placed): Box {
  const corners = cornersOf(picture);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Where each Grip sits on the picture as turned: its corners, the middles of its edges, and the
 * rotate handle `reach` frame pixels above the middle of its own top edge.
 */
export function gripsOf(picture: Placed, reach: number): Record<Grip, Point> {
  const [w, h] = [picture.width / 2, picture.height / 2];
  return {
    "top-left": pointOnPicture(picture, -w, -h),
    top: pointOnPicture(picture, 0, -h),
    "top-right": pointOnPicture(picture, w, -h),
    right: pointOnPicture(picture, w, 0),
    "bottom-right": pointOnPicture(picture, w, h),
    bottom: pointOnPicture(picture, 0, h),
    "bottom-left": pointOnPicture(picture, -w, h),
    left: pointOnPicture(picture, -w, 0),
    rotate: pointOnPicture(picture, 0, -h - reach),
  };
}

// The centre at `point`, kept on the frame.
const centredAt = (transform: PictureTransform, point: Point, frame: Size): PictureTransform => ({
  ...transform,
  x: clamp(point.x, 0, frame.width),
  y: clamp(point.y, 0, frame.height),
});

/** The picture dragged by its body from `from` to `to`: its centre moved as far, kept on the frame. */
export function moved({ transform, frame }: Grabbed, from: Point, to: Point): PictureTransform {
  return centredAt(transform, { x: transform.x + to.x - from.x, y: transform.y + to.y - from.y }, frame);
}

/**
 * The picture scaled about its centre by a corner dragged from `from` to `to`: by how much further
 * from the centre the pointer is than where it was grabbed. Its stretch is kept.
 */
export function scaled({ transform }: Grabbed, from: Point, to: Point): PictureTransform {
  const reach = Math.max(Math.hypot(from.x - transform.x, from.y - transform.y), 1);
  const ratio = Math.hypot(to.x - transform.x, to.y - transform.y) / reach;
  return { ...transform, scale: clamp(transform.scale * ratio, MIN_SCALE, MAX_SCALE) };
}

/**
 * The picture stretched about its centre by `edge` dragged from `from` to `to`: across for the left
 * and right edges, down for the top and bottom, by how much further the pointer is from the centre
 * along the picture's own axis (so a turned picture stretches along its own sides).
 */
export function stretched({ transform }: Grabbed, edge: Edge, from: Point, to: Point): PictureTransform {
  const across = edge === "left" || edge === "right";
  const reach = (point: Point) => {
    const off = offsetOnPicture(transform, point);
    return Math.abs(across ? off.along : off.down);
  };
  const ratio = reach(to) / Math.max(reach(from), 1);
  const key = across ? "stretch_x" : "stretch_y";
  return { ...transform, [key]: clamp(transform[key] * ratio, MIN_STRETCH, MAX_STRETCH) };
}

/**
 * A rotation snapped as the rotate handle snaps it: to a quarter turn (0, 90, 180, 270 and so on)
 * within 3°; with Shift to the nearest 15°; with Alt not at all.
 */
export function snapRotation(degrees: number, keys: GestureKeys): number {
  if (keys.shift) return unsigned(Math.round(degrees / ROTATION_STEP) * ROTATION_STEP);
  if (keys.alt) return degrees;
  const quarter = Math.round(degrees / 90) * 90;
  return Math.abs(degrees - quarter) <= ROTATION_SNAP ? unsigned(quarter) : degrees;
}

// The angle turned from `from` to `to`, in degrees, the short way round (−180 to 180).
function turn(from: number, to: number): number {
  const degrees = ((to - from) * 180) / Math.PI;
  return degrees - 360 * Math.round(degrees / 360);
}

// `rotation` turned by `degrees` and snapped, kept within one turn either way (−360 to 360).
function turnedBy(rotation: number, degrees: number, keys: GestureKeys): number {
  const next = snapRotation(rotation + degrees, keys);
  return next > 360 ? next - 360 : next < -360 ? next + 360 : next;
}

/**
 * The picture turned about its centre by the rotate handle dragged from `from` to `to`: by the
 * pointer's angle about the centre less its angle when grabbed, snapped (`snapRotation`).
 */
export function rotated({ transform }: Grabbed, from: Point, to: Point, keys: GestureKeys): PictureTransform {
  const angle = (point: Point) => Math.atan2(point.y - transform.y, point.x - transform.x);
  return { ...transform, rotation: turnedBy(transform.rotation, turn(angle(from), angle(to)), keys) };
}

/** The picture after `grip` (or its body) is dragged from `from` to `to`. */
export function dragged(grab: Grabbed, grip: Grip | "body", from: Point, to: Point, keys: GestureKeys): PictureTransform {
  if (grip === "body") return moved(grab, from, to);
  if (grip === "rotate") return rotated(grab, from, to, keys);
  if (grip === "top" || grip === "right" || grip === "bottom" || grip === "left") return stretched(grab, grip, from, to);
  return scaled(grab, from, to);
}

/**
 * The picture under two fingers that went from `from` to `to`: scaled by how much further apart they
 * are, turned by how far the line between them turned (snapped as the rotate handle is), and moved
 * as far as their middle moved.
 */
export function pinched(grab: Grabbed, from: [Point, Point], to: [Point, Point], keys: GestureKeys): PictureTransform {
  const { transform } = grab;
  const apart = ([a, b]: [Point, Point]) => Math.hypot(b.x - a.x, b.y - a.y);
  const angle = ([a, b]: [Point, Point]) => Math.atan2(b.y - a.y, b.x - a.x);
  const middle = ([a, b]: [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return {
    ...moved(grab, middle(from), middle(to)),
    scale: clamp((transform.scale * apart(to)) / Math.max(apart(from), 1), MIN_SCALE, MAX_SCALE),
    rotation: turnedBy(transform.rotation, turn(angle(from), angle(to)), keys),
  };
}
