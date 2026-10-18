import type { Shape, ShapeKind, ShapeStyle, Transform } from "../../../api";
import { FRAME, IDENTITY, SHAPE_SIZE_RANGE } from "../editor/picture";
import type { Size } from "../editor/pictureGestures";
import { NO_SHADOW } from "../editor/shadow";
import type { Outcome } from "./actions";
import { newId, newTiming, type AdvancedEdits } from "./edits";
import { writeItemTransform, type KeyScene } from "./keying";
import { picked } from "./pick";

// Shapes (docs/adr/0011, GLOSSARY.md): figures added from the Stickers tab, each drawn by the backend
// as a picture of its Shape Style, as a Text Layer is.

// A Shape Style's least and most width and height, in output pixels.
export const SHAPE_SIZE = { min: SHAPE_SIZE_RANGE[0], max: SHAPE_SIZE_RANGE[1] } as const;
// The thickest a Shape's stroke is, in output pixels (SHAPE_STROKE_MAX in backend/app/candidates.py).
export const SHAPE_STROKE_MAX = 200;

// Every Shape Kind, in the Stickers tab's order.
export const SHAPE_KINDS: readonly ShapeKind[] = ["rectangle", "ellipse", "triangle", "parallelogram", "trapezoid", "line", "arrow"];

/**
 * Whether a Shape of `kind` is all stroke (a line, an arrow): its width is its length, its stroke
 * width its thickness and its stroke colour its colour, and its height and fill aren't used.
 */
export const allStroke = (kind: ShapeKind): boolean => kind === "line" || kind === "arrow";

// What a Stickers tile adds: white, 400 px square, before its Transform's scale, with no stroke,
// square corners and no shadow (the backend's defaults); a line or an arrow 600 px long and 12 px
// thick, white.
const NEW_SIDE = 400;
export const NEW_FILL = "#FFFFFF";
const NEW_LENGTH = 600;
const NEW_THICKNESS = 12;

/** A new Shape Style of `kind`: its tile's look. */
export function newShapeStyle(kind: ShapeKind): ShapeStyle {
  const style: ShapeStyle = {
    kind,
    width: NEW_SIDE,
    height: NEW_SIDE,
    fill: NEW_FILL,
    stroke_colour: "#000000",
    stroke_width: 0,
    radius: 0,
    shadow: NO_SHADOW,
  };
  return allStroke(kind) ? { ...style, width: NEW_LENGTH, stroke_width: NEW_THICKNESS, stroke_colour: NEW_FILL } : style;
}

/**
 * `style` as a Shape of `kind`, its size, colours, corners and shadow kept (those `kind` doesn't use
 * too, for switching back). Made a line or an arrow while it has no stroke, it is 12 px thick in
 * its fill's colour: the colour it showed.
 */
export function withKind(style: ShapeStyle, kind: ShapeKind): ShapeStyle {
  if (allStroke(kind) && !style.stroke_width) return { ...style, kind, stroke_width: NEW_THICKNESS, stroke_colour: style.fill ?? style.stroke_colour };
  return { ...style, kind };
}

// What the inspector says where a Shape would be left with neither fill nor stroke, which the
// backend refuses as nothing to draw.
export const NOTHING_TO_DRAW = "A shape needs a fill or a stroke: give it a stroke to turn its fill off.";

/** Whether a Shape of `style` draws anything: a fill or a stroke; a line or an arrow, a thickness. */
export const drawsSomething = (style: ShapeStyle): boolean =>
  allStroke(style.kind) ? style.stroke_width > 0 : style.fill !== null || style.stroke_width > 0;

/**
 * A Shape of `kind` added at `at` (the playhead) in a Clip `duration` long: for a new Text Layer's
 * length (or to the Clip's end, `newTiming`), centred on the frame, in its tile's look, unanimated.
 */
export function newShape(kind: ShapeKind, at: number, duration: number, id: string = newId()): Shape {
  return {
    id,
    ...newTiming(at, duration),
    transform: IDENTITY,
    style: newShapeStyle(kind),
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
    keys: {},
  };
}

/**
 * A new Shape of `kind` (`newShape`) put on top of the others, picked: one change. Dropped on the
 * preview, its centre is at the drop point (`place`, in output pixels), whole pixels inside the frame.
 */
export function addShape(
  scene: { edits: AdvancedEdits },
  kind: ShapeKind,
  at: number,
  duration: number,
  { id, place }: { id?: string; place?: { x: number; y: number } } = {},
): Outcome {
  const made = newShape(kind, at, duration, id);
  const within = (value: number, most: number) => Math.round(Math.min(Math.max(value, 0), most));
  const shape = place ? { ...made, transform: { ...made.transform, x: within(place.x, FRAME.width), y: within(place.y, FRAME.height) } } : made;
  return { edits: { ...scene.edits, shapes: [...scene.edits.shapes, shape] }, pick: picked({ kind: "shape", id: shape.id }) };
}

/**
 * `style` with its box set to `box` (in its own pixels) by its Grips on the stage: its width and
 * height; a line's or an arrow's length alone (its box's height is its thickness or its head's,
 * and its stored height isn't used). Its stroke and corners are as they were, so they keep their size.
 */
export function sizedStyle(style: ShapeStyle, box: Size): ShapeStyle {
  return allStroke(style.kind) ? { ...style, width: box.width } : { ...style, width: box.width, height: box.height };
}

/**
 * Shape `id` resized on the stage (an edge Grip, or a line's or an arrow's end), with the playhead at
 * `time`: its box set to `box` (`sizedStyle`) and its Transform to `transform`, from what was `shown`
 * there, auto-keyed as the Grips' Transforms are (`writeItemTransform`); together, one change. Null
 * for one that isn't there or is on a locked Track.
 */
export function resizeShape(scene: KeyScene, id: string, box: Size, transform: Transform, time: number, shown?: Transform): Outcome | null {
  const shape = scene.edits.shapes.find((other) => other.id === id);
  if (!shape) return null;
  const shapes = scene.edits.shapes.map((other) => (other === shape ? { ...shape, style: sizedStyle(shape.style, box) } : other));
  return writeItemTransform({ ...scene, edits: { ...scene.edits, shapes } }, { kind: "shape", id }, transform, time, shown);
}
