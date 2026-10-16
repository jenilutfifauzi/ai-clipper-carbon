// Seam H (.scratch/transform-crop/spec.md): what the Grips (GLOSSARY.md) on a picked picture do to
// its Transform, worked out from numbers alone, without React or the DOM: the picture's drawn box
// and where its Grips sit on it, then moving, corner scale, edge stretch, rotation with its snaps,
// and a phone's pinch and twist. Points are in frame (output) pixels, y down; angles are degrees
// clockwise (docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md).
import type { Box, Transform } from "../../../api";
import { clamp, SCALE_RANGE, STRETCH_RANGE } from "./picture";

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
  transform: Transform;
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

// Rotation snaps to a quarter turn this near it, in degrees, and turns in steps this large with Shift.
const ROTATION_SNAP = 3;
const ROTATION_STEP = 15;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
// `-0` read as 0.
const unsigned = (value: number) => value + 0;

/** Where a picture is drawn by `transform`, given its fitted size. */
export function placed(transform: Transform, fitted: Size): Placed {
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
const centredAt = (transform: Transform, point: Point, frame: Size): Transform => ({
  ...transform,
  x: clamp(point.x, [0, frame.width]),
  y: clamp(point.y, [0, frame.height]),
});

/** The picture dragged by its body from `from` to `to`: its centre moved as far, kept on the frame. */
export function moved({ transform, frame }: Grabbed, from: Point, to: Point): Transform {
  return centredAt(transform, { x: transform.x + to.x - from.x, y: transform.y + to.y - from.y }, frame);
}

/**
 * The picture scaled about its centre by a corner dragged from `from` to `to`: by how much further
 * from the centre the pointer is than where it was grabbed. Its stretch is kept.
 */
export function scaled({ transform }: Grabbed, from: Point, to: Point): Transform {
  const reach = Math.max(Math.hypot(from.x - transform.x, from.y - transform.y), 1);
  const ratio = Math.hypot(to.x - transform.x, to.y - transform.y) / reach;
  return { ...transform, scale: clamp(transform.scale * ratio, SCALE_RANGE) };
}

/**
 * The picture stretched about its centre by `edge` dragged from `from` to `to`: across for the left
 * and right edges, down for the top and bottom, by how much further the pointer is from the centre
 * along the picture's own axis (so a turned picture stretches along its own sides).
 */
export function stretched({ transform }: Grabbed, edge: Edge, from: Point, to: Point): Transform {
  const across = edge === "left" || edge === "right";
  const reach = (point: Point) => {
    const off = offsetOnPicture(transform, point);
    return Math.abs(across ? off.along : off.down);
  };
  const ratio = reach(to) / Math.max(reach(from), 1);
  const key = across ? "stretch_x" : "stretch_y";
  return { ...transform, [key]: clamp(transform[key] * ratio, STRETCH_RANGE) };
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
export function rotated({ transform }: Grabbed, from: Point, to: Point, keys: GestureKeys): Transform {
  const angle = (point: Point) => Math.atan2(point.y - transform.y, point.x - transform.x);
  return { ...transform, rotation: turnedBy(transform.rotation, turn(angle(from), angle(to)), keys) };
}

/** The picture after `grip` (or its body) is dragged from `from` to `to`. */
export function dragged(grab: Grabbed, grip: Grip | "body", from: Point, to: Point, keys: GestureKeys): Transform {
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
export function pinched(grab: Grabbed, from: [Point, Point], to: [Point, Point], keys: GestureKeys): Transform {
  const { transform } = grab;
  const apart = ([a, b]: [Point, Point]) => Math.hypot(b.x - a.x, b.y - a.y);
  const angle = ([a, b]: [Point, Point]) => Math.atan2(b.y - a.y, b.x - a.x);
  const middle = ([a, b]: [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return {
    ...moved(grab, middle(from), middle(to)),
    scale: clamp((transform.scale * apart(to)) / Math.max(apart(from), 1), SCALE_RANGE),
    rotation: turnedBy(transform.rotation, turn(angle(from), angle(to)), keys),
  };
}

/**
 * A gesture on a picture under one finger or two (a pointer each, by id): with one, its Grip (or the
 * body) dragged from where the finger was; with two, a pinch from where both were (`pinched`). Each
 * finger's `from` is where it was when this part of the gesture began, and `grab` the picture then.
 */
export interface Fingers {
  grip: Grip | "body";
  grab: Grabbed;
  down: { id: number; from: Point; at: Point }[];
}

/** A gesture begun by finger `id` going down at `at` on `grip` (or the body) of the picture `grab`. */
export function fingersOn(grab: Grabbed, grip: Grip | "body", id: number, at: Point): Fingers {
  return { grip, grab, down: [{ id, from: at, at }] };
}

// The fingers `down` each starting again where it is, from the picture as `held` now.
const again = (fingers: Fingers, held: Transform, down: Fingers["down"], grip: Fingers["grip"]): Fingers => ({
  grip,
  grab: { ...fingers.grab, transform: held },
  down: down.map(({ id, at }) => ({ id, from: at, at })),
});

/**
 * A second finger `id` down at `at`: a pinch from here, of the picture as `held` now (the first
 * finger's move so far, as the stage shows it). A third finger is left out.
 */
export function fingerDown(fingers: Fingers, id: number, at: Point, held: Transform): Fingers {
  if (fingers.down.length !== 1 || fingers.down[0].id === id) return fingers;
  return again(fingers, held, [...fingers.down, { id, from: at, at }], fingers.grip);
}

/** Finger `id` now at `at`. */
export function fingerMoved(fingers: Fingers, id: number, at: Point): Fingers {
  if (!fingers.down.some((finger) => finger.id === id)) return fingers;
  return { ...fingers, down: fingers.down.map((finger) => (finger.id === id ? { ...finger, at } : finger)) };
}

/**
 * Finger `id` lifted, the picture as `held` now: the other of two moves its body on from here, and
 * the last ends the gesture (null).
 */
export function fingerUp(fingers: Fingers, id: number, held: Transform): Fingers | null {
  if (!fingers.down.some((finger) => finger.id === id)) return fingers;
  const left = fingers.down.filter((finger) => finger.id !== id);
  return left.length ? again(fingers, held, left, "body") : null;
}

/** The picture as the fingers put it now. */
export function fingersHeld({ grip, grab, down }: Fingers, keys: GestureKeys): Transform {
  const [first, second] = down;
  if (second) return pinched(grab, [first.from, second.from], [first.at, second.at], keys);
  return dragged(grab, grip, first.from, first.at, keys);
}
