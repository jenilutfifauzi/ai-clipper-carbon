import type { Box, TextStyle } from "../../../api";
import type { Point } from "./pictureGestures";

/** An edge of a Text Layer's box: its Grip sets the wrap width (the sides) or the fixed height (the top and bottom). */
export type BoxEdge = "left" | "right" | "top" | "bottom";

export const BOX_EDGES: BoxEdge[] = ["top", "right", "bottom", "left"];

// The least and the most a box Grip sets the wrap width or the fixed height to, in output pixels
// (the most is the backend's, app/candidates.py).
const MIN_BOX_PX = 8;
const MAX_BOX_PX = 4096;

const across = (edge: BoxEdge) => edge === "left" || edge === "right";

/**
 * The box `from` with its `edge` dragged from `grab` to `point` (output pixels): the opposite edge
 * moved as far the other way, as the planner centres a Text Layer's box on its Transform. In whole
 * pixels, between MIN_BOX_PX and MAX_BOX_PX across (the sides) or down (the top and bottom).
 */
export function boxDragged(from: Box, edge: BoxEdge, grab: Point, point: Point): Box {
  const by = { left: grab.x - point.x, right: point.x - grab.x, top: grab.y - point.y, bottom: point.y - grab.y }[edge];
  const sized = (length: number) => Math.round(Math.min(Math.max(length + 2 * by, MIN_BOX_PX), MAX_BOX_PX));
  if (across(edge)) {
    const width = sized(from.width);
    return { ...from, x: from.x + (from.width - width) / 2, width };
  }
  const height = sized(from.height);
  return { ...from, y: from.y + (from.height - height) / 2, height };
}

/**
 * A box Grip's drag, from the box `from` as planned, grabbed at `grab` by its `edge`: the box as
 * drawn after each move, and, when it is let go, the one box it sets (null when it is where it was),
 * so that a drag is one step of undo.
 */
export function boxGrab(from: Box, edge: BoxEdge, grab: Point) {
  let box = from;
  return {
    edge,
    move(point: Point): Box {
      box = boxDragged(from, edge, grab, point);
      return box;
    },
    end(): Box | null {
      return box.width === from.width && box.height === from.height ? null : box;
    },
  };
}

export type BoxGrab = ReturnType<typeof boxGrab>;

/**
 * `style` with what a box dragged by `edge` to `box` sets: its wrap width to the box's width (the
 * sides), or its fixed height to its height (the top and bottom). The words then break at that width,
 * less the plate's padding, and are centred down that height, once the next plan comes.
 */
export function boxStyle(style: TextStyle, edge: BoxEdge, box: Box): TextStyle {
  return across(edge) ? { ...style, wrap_width: box.width } : { ...style, fixed_height: box.height };
}

/** The middle of `edge` of `box`, where its Grip is. */
export function edgeMiddle(box: Box, edge: BoxEdge): Point {
  const x = { left: box.x, right: box.x + box.width, top: box.x + box.width / 2, bottom: box.x + box.width / 2 }[edge];
  const y = { left: box.y + box.height / 2, right: box.y + box.height / 2, top: box.y, bottom: box.y + box.height }[edge];
  return { x, y };
}
