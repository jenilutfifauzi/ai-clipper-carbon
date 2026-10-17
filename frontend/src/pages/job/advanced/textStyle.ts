import type { DropShadow, Plate, TextStyle } from "../../../api";

// A Text Layer's plate is padded this many of its sizes either side and above the capitals and below
// the descenders, its corners this many round: as the planner drew its box before Text Styles
// (backend/app/migration.py).
const PAD_X = 0.35;
const PAD_Y = 0.22;
const RADIUS = 0.25;

// The backend's default shadow (backend/app/styles.py): off, as it is neither moved nor blurred.
export const NO_SHADOW: DropShadow = { colour: "#000000", opacity: 0.6, blur: 0, distance: 0, angle: 45 };
// How far a shadow turned on falls and how much it is blurred, when it had neither.
const SHADOW_DISTANCE = 6;
const SHADOW_BLUR = 8;

const hundredths = (value: number) => Math.round(value * 100) / 100;

/** A plate as a Text Layer at `size` has it: padded and rounded in proportion to the size, with `plate`'s other fields. */
export function plateAt(size: number, plate: Partial<Plate> = {}): Plate {
  return {
    shape: "none",
    colour: "#000000",
    opacity: 0.7,
    ...plate,
    radius: hundredths(RADIUS * size),
    padding_x: hundredths(PAD_X * size),
    padding_y: hundredths(PAD_Y * size),
  };
}

/** A new Text Layer's style, as the backend's default (backend/app/candidates.py), with `style`'s fields; its plate at its size. */
export function textStyle(
  style: Partial<Omit<TextStyle, "plate" | "shadow">> & { plate?: Partial<Plate>; shadow?: Partial<DropShadow> } = {},
): TextStyle {
  const size = style.size ?? 80;
  return {
    font: "montserrat-extrabold",
    size,
    colour: "#FFFFFF",
    stroke_width: 0,
    stroke_colour: "#000000",
    line_height: 1.1,
    tracking: 0,
    align: "center",
    wrap_width: 0,
    fixed_height: 0,
    ...style,
    shadow: { ...NO_SHADOW, ...style.shadow },
    plate: plateAt(size, style.plate),
  };
}

/** `style` with `field` set to `value`; a new size takes the plate along (atSize). */
export function styled<K extends keyof TextStyle>(style: TextStyle, field: K, value: TextStyle[K]): TextStyle {
  return field === "size" ? atSize(style, value as number) : { ...style, [field]: value };
}

/** `style` at `size`, its plate's padding and corners grown or shrunk with it, as its lines are. */
export function atSize(style: TextStyle, size: number): TextStyle {
  if (size === style.size) return style;
  const by = size / style.size;
  const { plate } = style;
  return {
    ...style,
    size,
    plate: { ...plate, radius: hundredths(plate.radius * by), padding_x: hundredths(plate.padding_x * by), padding_y: hundredths(plate.padding_y * by) },
  };
}

/** Whether `shadow` shows: it isn't transparent, and it is moved or blurred. */
export function shadowOn(shadow: DropShadow): boolean {
  return shadow.opacity > 0 && (shadow.distance > 0 || shadow.blur > 0);
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
