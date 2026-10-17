import { useRef, useState, type PointerEvent } from "react";
import type { RenderPlan } from "../../../api";
import { cx } from "../../../format";
import type { Placed, Point } from "./pictureGestures";
import { gripCursor, gripsOnFrame } from "./stagePicture";
import { BOX_EDGES, boxGrab, type BoxEdge, type BoxGrab } from "./textBox";

const percent = (value: number) => `${value * 100}%`;

// A box Grip: a white bar along its edge (an Overlay's edge Grips are orange), with a hit area larger
// than it, larger still under a finger.
const ACROSS_LOOK = "h-2 w-5 pointer-coarse:h-2.5 pointer-coarse:w-6";
const DOWN_LOOK = "h-5 w-2 pointer-coarse:h-6 pointer-coarse:w-2.5";
const GRIP =
  "pointer-events-auto absolute touch-none rounded-full border-2 border-accent bg-white shadow-sm before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-3.5";

let drags = 0;

/**
 * The box Grips of a Text Layer picked alone, on its area as drawn (`box`: its centre, its size
 * scaled `scale` times, turned), pulled in from off the stage as its other Grips are, `inset` frame
 * pixels: its sides set its wrap width and its top and bottom its fixed height, about its middle
 * and along its own axes (`boxDragged`). While one is dragged, and once it is let go until the next
 * plan comes, the box it sets is outlined; the words rewrap only in that plan. A drag is saved once,
 * when it is let go (`onBox`, the length in the layer's own pixels): one step of undo. `at` is where
 * a pointer is, in frame pixels.
 */
export function TextBoxGrips({
  plan,
  box,
  scale,
  inset,
  at,
  onBox,
}: {
  plan: RenderPlan;
  box: Placed;
  scale: number;
  inset: number;
  at: (pointer: { clientX: number; clientY: number }) => Point | null;
  onBox: (edge: BoxEdge, length: number, group: string) => void;
}) {
  const grab = useRef<{ pointer: number; grab: BoxGrab } | null>(null);
  // The box as dragged: while it is, and once let go, until a plan other than `plan` comes.
  const [drawn, setDrawn] = useState<{ box: Placed; plan: RenderPlan; held: boolean } | null>(null);
  const outline = drawn && (drawn.held || drawn.plan === plan) ? drawn.box : null;
  const shown = outline ?? box;

  const handlers = (edge: BoxEdge) => ({
    onPointerDown: (pointer: PointerEvent<HTMLElement>) => {
      const point = at(pointer);
      if (!point || pointer.button !== 0) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      grab.current = { pointer: pointer.pointerId, grab: boxGrab(box, edge, point, scale) };
    },
    onPointerMove: (pointer: PointerEvent<HTMLElement>) => {
      const held = grab.current;
      const point = at(pointer);
      if (!held || held.pointer !== pointer.pointerId || !point) return;
      setDrawn({ box: held.grab.move(point), plan, held: true });
    },
    onPointerUp: (pointer: PointerEvent<HTMLElement>) => {
      const held = grab.current;
      if (!held || held.pointer !== pointer.pointerId) return;
      grab.current = null;
      const length = held.grab.end();
      if (length === null) {
        setDrawn(null);
        return;
      }
      setDrawn((old) => old && { ...old, held: false });
      onBox(edge, length, `drag:stage-box:${++drags}`);
    },
    onPointerCancel: () => {
      grab.current = null;
      setDrawn(null);
    },
  });

  const turned = `translate(-50%, -50%) rotate(${shown.rotation}deg)`;
  const on = gripsOnFrame(shown, plan, 0, inset);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {outline && (
        <div
          className="absolute outline-2 outline-accent outline-dashed"
          style={{
            left: percent(outline.x / plan.width),
            top: percent(outline.y / plan.height),
            width: percent(outline.width / plan.width),
            height: percent(outline.height / plan.height),
            transform: turned,
          }}
        />
      )}
      {BOX_EDGES.map((edge) => (
        <span
          key={edge}
          data-box-grip={edge}
          {...handlers(edge)}
          className={cx(GRIP, edge === "top" || edge === "bottom" ? ACROSS_LOOK : DOWN_LOOK)}
          style={{ left: percent(on[edge].x / plan.width), top: percent(on[edge].y / plan.height), transform: turned, cursor: gripCursor(edge, shown.rotation) }}
        />
      ))}
    </div>
  );
}
