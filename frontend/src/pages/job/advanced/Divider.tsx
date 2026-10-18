import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "../../../format";

// One arrow step, in CSS pixels, and the larger step Shift takes (ticket 05, ADR 0024).
const STEP = 16;
const BIG_STEP = 64;

/**
 * What a key does to a Divider, as a pure function so it can be unit-tested without the DOM. The sign
 * convention matches the pointer drag (right/down positive), so the caller's existing sign + clamp in
 * `onDrag` applies unchanged:
 * - vertical: `ArrowRight` → +step, `ArrowLeft` → −step;
 * - horizontal: `ArrowDown` → +step, `ArrowUp` → −step;
 * - step is 16px, 64px with Shift;
 * - `Enter` → `"reset"` (the keyboard twin of a double-click);
 * - anything else → `null` (the event is left to the browser).
 */
export function dividerKeyStep(
  key: string,
  shift: boolean,
  orientation: "vertical" | "horizontal",
): { deltaPx: number } | "reset" | null {
  if (key === "Enter") return "reset";
  const step = shift ? BIG_STEP : STEP;
  const grow = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
  const shrink = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
  if (key === grow) return { deltaPx: step };
  if (key === shrink) return { deltaPx: -step };
  return null;
}

/**
 * A Divider between two Workspace regions, dragged — or arrowed — to size the panel on its side (ADR
 * 0024). Drawn as the codebase draws hairlines — a `border-border` line in an ~8px grab zone, tinted
 * on hover and focus, with the right resize cursor. The pointer drag is the house pattern of
 * `TextBoxGrips.tsx`: `setPointerCapture`, a button-0 guard, the start pointer coord kept in a ref,
 * and each move writing the store live. The DOM reads (remPx, vhPx, the container width, the other
 * sidebar's width) and the clamp maths stay with the caller: this component only turns a pointer or a
 * key into a `deltaPx` and a reset.
 *
 * - `onStart` runs on pointer-down (and before a keyboard step), so the caller can snapshot the value
 *   being dragged and measure the DOM once. It must not depend on a PointerEvent.
 * - `onDrag(deltaPx)` runs every move (and once per key): the signed distance travelled along the axis
 *   from where the drag began (right/down positive). The caller applies the sign and the clamp.
 * - `onReset` runs on a double-click or Enter: the caller puts this Divider back to its default.
 *
 * Keyboard and ARIA (ticket 05): the Divider is a `role="separator"`, reachable by Tab, named by
 * `label`, with `aria-orientation` and `aria-valuenow`/`-valuemin`/`-valuemax` tracking the size the
 * caller passes in (`value`/`min`/`max`, rounded for AT). The arrows resize it, Shift takes a larger
 * step, Enter resets — all reusing the pointer path's `onStart`/`onDrag`/`onReset`.
 */
export function Divider({
  orientation,
  onStart,
  onDrag,
  onReset,
  label,
  value,
  min,
  max,
  style,
}: {
  orientation: "vertical" | "horizontal";
  onStart: () => void;
  onDrag: (deltaPx: number) => void;
  onReset: () => void;
  // A separator is named for AT; also the pointer tooltip.
  label: string;
  // The size this Divider sizes and its bounds, for aria-value* (rounded on the way out).
  value: number;
  min: number;
  max: number;
  // Where the caller places the Divider in its positioned parent (e.g. the boundary offset).
  style?: CSSProperties;
}) {
  // The drag in flight: the captured pointer id and where it began, along the axis this Divider sizes.
  const drag = useRef<{ pointer: number; start: number } | null>(null);
  const vertical = orientation === "vertical";

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      title={label}
      style={style}
      className={cx(
        "group pointer-events-auto absolute z-20 touch-none select-none",
        "focus-visible:outline-2 focus-visible:outline-focus",
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
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = dividerKeyStep(event.key, event.shiftKey, orientation);
        if (step === null) return;
        event.preventDefault();
        if (step === "reset") {
          onReset();
          return;
        }
        // Reuse the one-shot pointer path: snapshot + measure, then apply the step through the caller's
        // sign + clamp. Each key press is its own tiny drag from the current value.
        onStart();
        onDrag(step.deltaPx);
      }}
      onDoubleClick={onReset}
    >
      {/* The hairline: a thin tinted bar centred in the grab zone, brightening on hover, focus and
          while a drag is in flight. */}
      <span
        aria-hidden
        className={cx(
          "absolute bg-border transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent",
          vertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}
