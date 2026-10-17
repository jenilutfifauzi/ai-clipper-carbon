import type { TextStyle } from "../../../api";
import { offsetOnPicture, type Placed, type Point } from "./pictureGestures";

/** An edge of a Text Layer's box: its Grip sets the wrap width (the sides) or the fixed height (the top and bottom). */
export type BoxEdge = "left" | "right" | "top" | "bottom";

export const BOX_EDGES: BoxEdge[] = ["top", "right", "bottom", "left"];

// The least and the most a box Grip sets the wrap width or the fixed height to, in the layer's own
// pixels (the most is the backend's, app/candidates.py).
const MIN_BOX_PX = 8;
const MAX_BOX_PX = 4096;

export const across = (edge: BoxEdge) => edge === "left" || edge === "right";

/**
 * The box `from` as drawn (its centre, its size scaled `scale` times, turned) with its `edge` dragged
 * from `grab` to `point` (frame pixels), along its own axes: the opposite edge moved as far the other
 * way, as the planner centres a Text Layer's box on its Transform. Its size along that axis is whole
 * pixels of the layer's own, between MIN_BOX_PX and MAX_BOX_PX, times `scale`.
 */
export function boxDragged(from: Placed, edge: BoxEdge, grab: Point, point: Point, scale: number): Placed {
  const [held, now] = [offsetOnPicture(from, grab), offsetOnPicture(from, point)];
  const by = { left: held.along - now.along, right: now.along - held.along, top: held.down - now.down, bottom: now.down - held.down }[edge];
  const sized = (length: number) => Math.round(Math.min(Math.max((length + 2 * by) / scale, MIN_BOX_PX), MAX_BOX_PX)) * scale;
  return across(edge) ? { ...from, width: sized(from.width) } : { ...from, height: sized(from.height) };
}

/**
 * A box Grip's drag, from the box `from` as drawn, grabbed at `grab` by its `edge`: the box as drawn
 * after each move, and, when it is let go, the length it sets in the layer's own pixels (its width
 * from a side, its height from the top or bottom; null when it is where it was), so that a drag is
 * one step of undo.
 */
export function boxGrab(from: Placed, edge: BoxEdge, grab: Point, scale: number) {
  let box = from;
  return {
    edge,
    move(point: Point): Placed {
      box = boxDragged(from, edge, grab, point, scale);
      return box;
    },
    end(): number | null {
      if (box.width === from.width && box.height === from.height) return null;
      return Math.round((across(edge) ? box.width : box.height) / scale);
    },
  };
}

export type BoxGrab = ReturnType<typeof boxGrab>;

/**
 * `style` with what a box Grip on `edge` sets to `length` (the layer's own pixels): its wrap width
 * (the sides) or its fixed height (the top and bottom). The words then break at that width, less the
 * plate's padding, and are centred down that height, once the next plan comes.
 */
export function boxStyle(style: TextStyle, edge: BoxEdge, length: number): TextStyle {
  return across(edge) ? { ...style, wrap_width: length } : { ...style, fixed_height: length };
}
