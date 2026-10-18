import type { Shape, ShapeKind, ShapeStyle } from "../../../api";
import { IDENTITY } from "../editor/picture";
import type { Outcome } from "./actions";
import { newId, newTiming, type AdvancedEdits } from "./edits";
import { picked } from "./pick";

// Shapes (docs/adr/0011, GLOSSARY.md): figures added from the Stickers tab, each drawn by the backend
// as a picture of its Shape Style, as a Text Layer is.

// A Shape Style's least and most width and height, in output pixels (SHAPE_SIZE in backend/app/candidates.py).
export const SHAPE_SIZE = { min: 2, max: 4096 } as const;

// What a Stickers tile adds: white, 400 px square, before its Transform's scale.
const NEW_SIDE = 400;
const NEW_FILL = "#FFFFFF";

/** A new Shape Style of `kind`: its tile's look. */
export const newShapeStyle = (kind: ShapeKind): ShapeStyle => ({ kind, width: NEW_SIDE, height: NEW_SIDE, fill: NEW_FILL });

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

/** A new Shape of `kind` (`newShape`) put on top of the others, picked: one change. */
export function addShape(scene: { edits: AdvancedEdits }, kind: ShapeKind, at: number, duration: number, id?: string): Outcome {
  const shape = newShape(kind, at, duration, id);
  return { edits: { ...scene.edits, shapes: [...scene.edits.shapes, shape] }, pick: picked({ kind: "shape", id: shape.id }) };
}
