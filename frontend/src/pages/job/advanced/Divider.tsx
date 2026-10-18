import { useRef, type CSSProperties, type PointerEvent } from "react";
import { cx } from "../../../format";

/**
 * A Divider between two Workspace regions, dragged to size the panel on its side (ADR 0024). Drawn as
 * the codebase draws hairlines — a `border-border` line in an ~8px grab zone, tinted on hover and
 * focus, with the right resize cursor. The pointer drag is the house pattern of `TextBoxGrips.tsx`:
 * `setPointerCapture`, a button-0 guard, the start pointer coord kept in a ref, and each move writing
 * the store live. The DOM reads (remPx, vhPx, the container width, the other sidebar's width) and the
 * clamp maths stay with the caller: this component only turns a pointer into a `deltaPx` and a reset.
 *
 * - `onStart` runs on pointer-down, before the first move, so the caller can snapshot the value being
 *   dragged and measure the DOM once.
 * - `onDrag(deltaPx)` runs every move: the signed distance the pointer has travelled along the axis
 *   from where the drag began (right/down positive). The caller applies the sign and the clamp.
 * - `onReset` runs on a double-click: the caller puts this Divider back to its default.
 *
 * Keyboard and ARIA are deliberately not here — they are ticket 05.
 */
export function Divider({
  orientation,
  onStart,
  onDrag,
  onReset,
  label,
  style,
}: {
  orientation: "vertical" | "horizontal";
  onStart: () => void;
  onDrag: (deltaPx: number) => void;
  onReset: () => void;
  label?: string;
  // Where the caller places the Divider in its positioned parent (e.g. the boundary offset).
  style?: CSSProperties;
}) {
  // The drag in flight: the captured pointer id and where it began, along the axis this Divider sizes.
  const drag = useRef<{ pointer: number; start: number } | null>(null);
  const vertical = orientation === "vertical";

  return (
    <div
      role="presentation"
      title={label}
      style={style}
      className={cx(
        "group pointer-events-auto absolute z-20 touch-none select-none",
        // An ~8px grab zone centred on the boundary; the hairline is drawn inside it.
        vertical
          ? "top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize"
          : "inset-x-0 top-0 h-2 cursor-row-resize",
      )}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, start: vertical ? event.clientX : event.clientY };
        onStart();
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const held = drag.current;
        if (!held || held.pointer !== event.pointerId) return;
        const now = vertical ? event.clientX : event.clientY;
        onDrag(now - held.start);
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointer === event.pointerId) drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={onReset}
    >
      {/* The hairline: a thin tinted bar centred in the grab zone, brightening on hover and while a
          drag is in flight. */}
      <span
        aria-hidden
        className={cx(
          "absolute bg-border transition-colors group-hover:bg-accent group-active:bg-accent",
          vertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}
