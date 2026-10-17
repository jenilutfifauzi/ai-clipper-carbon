import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Box, RenderPlan } from "../../../api";
import { cx } from "../../../format";
import { BOX_EDGES, boxGrab, edgeMiddle, type BoxEdge, type BoxGrab } from "./textBox";

const percent = (value: number) => `${value * 100}%`;

// A box Grip: a bar along its edge, with a hit area larger than it, larger still under a finger.
const ACROSS_LOOK = "h-2 w-4 cursor-ns-resize pointer-coarse:h-2.5 pointer-coarse:w-5";
const DOWN_LOOK = "h-4 w-2 cursor-ew-resize pointer-coarse:h-5 pointer-coarse:w-2.5";
const GRIP =
  "pointer-events-auto absolute touch-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-sm before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-3.5";

let drags = 0;

/**
 * The box Grips of a Text Layer picked alone, on its `area` as drawn: its sides set its wrap width
 * and its top and bottom its fixed height, about its middle (`boxDragged`). While one is dragged, and
 * once it is let go until the next plan comes, the box it sets is outlined; the words rewrap only in
 * that plan. A drag is saved once, when it is let go (`onBox`): one step of undo. `at` is where a
 * pointer is, in output pixels.
 */
export function TextBoxGrips({
  plan,
  area,
  at,
  onBox,
}: {
  plan: RenderPlan;
  area: Box;
  at: (pointer: { clientX: number; clientY: number }) => { x: number; y: number } | null;
  onBox: (edge: BoxEdge, box: Box, group: string) => void;
}) {
  const grab = useRef<{ pointer: number; grab: BoxGrab } | null>(null);
  // The box as dragged: while it is, and once let go, until a plan other than `plan` comes.
  const [drawn, setDrawn] = useState<{ box: Box; plan: RenderPlan; held: boolean } | null>(null);
  const outline = drawn && (drawn.held || drawn.plan === plan) ? drawn.box : null;

  const handlers = (edge: BoxEdge) => ({
    onPointerDown: (pointer: PointerEvent<HTMLElement>) => {
      const point = at(pointer);
      if (!point || pointer.button !== 0) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      grab.current = { pointer: pointer.pointerId, grab: boxGrab(area, edge, point) };
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
      const box = held.grab.end();
      if (!box) {
        setDrawn(null);
        return;
      }
      setDrawn({ box, plan, held: false });
      onBox(edge, box, `drag:stage-box:${++drags}`);
    },
    onPointerCancel: () => {
      grab.current = null;
      setDrawn(null);
    },
  });

  const place = (box: Box): CSSProperties => ({
    left: percent(box.x / plan.width),
    top: percent(box.y / plan.height),
    width: percent(box.width / plan.width),
    height: percent(box.height / plan.height),
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {outline && <div className="absolute outline-2 outline-accent outline-dashed" style={place(outline)} />}
      {BOX_EDGES.map((edge) => {
        const { x, y } = edgeMiddle(outline ?? area, edge);
        return (
          <span
            key={edge}
            data-box-grip={edge}
            {...handlers(edge)}
            className={cx(GRIP, edge === "top" || edge === "bottom" ? ACROSS_LOOK : DOWN_LOOK)}
            style={{ left: percent(x / plan.width), top: percent(y / plan.height) }}
          />
        );
      })}
    </div>
  );
}
