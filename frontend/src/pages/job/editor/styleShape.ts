// The Hook and Caption Styles' drop shadow and box shape: how the preview draws them, as the renderer
// does (backend/app/renderer.py), and the padding the clip editor shows for a box whose style gives
// none, as the planner pads it (backend/app/planner.py's _hook_padding).
import type { CaptionStyle, DropShadow, HookStyle } from "../../../api";

// The hook's box padding unless its style gives its own: a block's (and lines' with no box) in output
// pixels, a strip's in sizes (planner.py's HOOK_PAD_X, HOOK_PAD_Y, STRIP_PAD_X, STRIP_PAD_Y).
const HOOK_PAD_X = 36;
const HOOK_PAD_Y = 26;
const STRIP_PAD_X = 0.25;
const STRIP_PAD_Y = 0.14;
// The highlight box's padding and corners unless its style gives its own, in sizes of the line
// (renderer.py's HIGHLIGHT_PAD_X, HIGHLIGHT_PAD_Y, HIGHLIGHT_RADIUS).
const HIGHLIGHT_PAD_X = 0.12;
const HIGHLIGHT_PAD_Y = 0.08;
const HIGHLIGHT_RADIUS = 0.12;

/** The hook's box padding across and down at its style's size: the style's, or its Shape's own. */
export function hookPadding(style: Pick<HookStyle, "shape" | "size" | "padding_x" | "padding_y">): [number, number] {
  const strips = style.shape === "strips";
  const own: [number, number] = strips ? [STRIP_PAD_X * style.size, STRIP_PAD_Y * style.size] : [HOOK_PAD_X, HOOK_PAD_Y];
  if (style.shape === "none") return own;
  return [style.padding_x ?? own[0], style.padding_y ?? own[1]];
}

/** The highlight box's padding across and down and its corners' radius on a line set at `size`. */
export function highlightShape(
  style: Pick<CaptionStyle, "size" | "padding_x" | "padding_y" | "radius">,
  size: number,
): { padX: number; padY: number; radius: number } {
  const scale = size / style.size;
  return {
    padX: style.padding_x === null ? HIGHLIGHT_PAD_X * size : style.padding_x * scale,
    padY: style.padding_y === null ? HIGHLIGHT_PAD_Y * size : style.padding_y * scale,
    radius: style.radius === null ? HIGHLIGHT_RADIUS * size : style.radius * scale,
  };
}

/**
 * How a line's drop `shadow` is drawn under it, or null when it is off: moved `x` right and `y`
 * down, at `opacity`, blurred by a Gaussian of `sigma` (half its blur, as a CSS shadow's). The
 * shadow's letters and their stroke are in its colour.
 */
export function shadowLook(shadow: DropShadow): { x: number; y: number; opacity: number; sigma: number } | null {
  if (shadow.opacity <= 0 || (shadow.distance <= 0 && shadow.blur <= 0)) return null;
  const angle = (shadow.angle * Math.PI) / 180;
  return { x: shadow.distance * Math.cos(angle), y: shadow.distance * Math.sin(angle), opacity: shadow.opacity, sigma: shadow.blur / 2 };
}
