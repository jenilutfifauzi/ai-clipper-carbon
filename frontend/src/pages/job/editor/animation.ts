import type { HookStyle, OverlayAnimation, Picture } from "../../../api";
import { pictureAt } from "./picture";

// The renderer's numbers the animations repeat (backend/app/renderer.py): how far a sliding element
// moves, and the share of its size a popping one grows from.
export const SLIDE_PX = 60;
const POP_FROM = 0.7;

// What comes on and goes off as the hook does: the hook, a picture layer or an Overlay, in its style.
export type Timed = { start: number; end: number };
export type Moves = Pick<HookStyle, "animation_in" | "animation_out" | "animation_ms">;
// An element's opacity, scale and how far below its place it is.
export type Look = readonly [number, number, number];

/** How long an element's entrance and exit take (renderer.py's _hook_ends): its animation_ms each, at most half its time; none without an animation. */
export function hookEnds(hook: Timed, style: Moves): [number, number] {
  const most = (hook.end - hook.start) / 2;
  const ms = style.animation_ms / 1000;
  return [style.animation_in === "none" ? 0 : Math.min(ms, most), style.animation_out === "none" ? 0 : Math.min(ms, most)];
}

/**
 * An element's look at `time`, coming on `delay` after the hook starts: its opacity, scale and how
 * far below its place it is, as the renderer animates it (_hook_phases, _hook_motion, and for a
 * picture layer or an Overlay animation_at); null while it is off screen.
 */
export function hookLook(time: number, hook: Timed, style: Moves, delay: number): [number, number, number] | null {
  const start = hook.start + delay;
  if (time < start || time >= hook.end) return null;
  const ms = style.animation_ms / 1000;
  const moving = (a: string) => a === "pop" || a === "slide";
  if (!moving(style.animation_in) && !moving(style.animation_out)) {
    const on = style.animation_in === "fade" ? (time - start) / ms : 1;
    const off = style.animation_out === "fade" ? (hook.end - time) / ms : 1;
    return [Math.max(0, Math.min(1, on, off)), 1, 0];
  }
  const [on, off] = hookEnds(hook, style);
  const animate = (animation: string, shown: number): [number, number, number] =>
    animation === "pop"
      ? [shown, POP_FROM + (1 - POP_FROM) * shown, 0]
      : animation === "slide"
        ? [shown, 1, SLIDE_PX * (1 - shown)]
        : [shown, 1, 0];
  if (on && time < start + on) return animate(style.animation_in, (time - start) / on);
  if (off && time >= hook.end - off) return animate(style.animation_out, (hook.end - time) / off);
  return [1, 1, 0];
}

/** An item's animations, those left out (an Overlay's stored before it had them) at their defaults: none, none, 300 ms. */
export const movesOf = (item: OverlayAnimation): Moves => ({
  animation_in: item.animation_in ?? "none",
  animation_out: item.animation_out ?? "none",
  animation_ms: item.animation_ms ?? 300,
});

/** Whether an item comes on or goes off animated. */
export const isAnimated = (item: OverlayAnimation) => (item.animation_in ?? "none") !== "none" || (item.animation_out ?? "none") !== "none";

/** An Overlay's look at `time` (hookLook), as a picture layer's; null while it is off screen. */
export const overlayLook = (event: Timed & OverlayAnimation, time: number): Look | null => hookLook(time, event, movesOf(event), 0);

/**
 * `picture` as drawn at `time` seconds into the Clip, its animations' `look` there being its
 * opacity, scale and drop (hookLook): as its Keyframes have it (pictureAt, ADR 0008), then faded,
 * scaled about its centre (its corners with it) and moved down on top, as the renderer's
 * animated_at draws a picture layer or an Overlay.
 */
export function animatedPicture(picture: Picture, time: number, [opacity, scale, below]: Look): Picture {
  const drawn = pictureAt(picture, time);
  if (opacity === 1 && scale === 1 && below === 0) return drawn;
  const [x, y] = drawn.centre;
  return {
    ...drawn,
    width: drawn.width * scale,
    height: drawn.height * scale,
    radius: drawn.radius * scale,
    centre: [x, y + below],
    opacity: drawn.opacity * opacity,
  };
}
