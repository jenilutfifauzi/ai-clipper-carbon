// A drop shadow as the hook, the captions and Text Layers have it (backend/app/styles.py's
// DropShadow): whether it shows, where it falls, and turning it on or off in their fields.
import type { DropShadow } from "../../../api";

// The backend's default shadow (backend/app/styles.py): off, as it is neither moved nor blurred.
export const NO_SHADOW: DropShadow = { colour: "#000000", opacity: 0.6, blur: 0, distance: 0, angle: 45 };
// How far a shadow turned on falls and how much it is blurred, when it had neither.
const SHADOW_DISTANCE = 6;
const SHADOW_BLUR = 8;

/** Whether `shadow` shows: it isn't transparent, and it is moved or blurred. */
export function shadowOn(shadow: DropShadow): boolean {
  return shadow.opacity > 0 && (shadow.distance > 0 || shadow.blur > 0);
}

/** How far `shadow` falls from its letters: `x` right and `y` down, its distance along its angle (degrees clockwise). */
export function shadowOffset(shadow: DropShadow): { x: number; y: number } {
  const angle = (shadow.angle * Math.PI) / 180;
  return { x: shadow.distance * Math.cos(angle), y: shadow.distance * Math.sin(angle) };
}

/**
 * `shadow` turned on or off. Off, it is made transparent and keeps the rest, which turning it on
 * again brings back; on, it is made visible, and moved and blurred a little if it was neither.
 */
export function withShadow(shadow: DropShadow, on: boolean): DropShadow {
  if (!on) return shadowOn(shadow) ? { ...shadow, opacity: 0 } : shadow;
  if (shadowOn(shadow)) return shadow;
  const opacity = shadow.opacity > 0 ? shadow.opacity : NO_SHADOW.opacity;
  const moved = shadow.distance > 0 || shadow.blur > 0 ? {} : { distance: SHADOW_DISTANCE, blur: SHADOW_BLUR };
  return { ...shadow, opacity, ...moved };
}
