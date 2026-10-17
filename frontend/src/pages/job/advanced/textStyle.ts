import type { Plate, TextStyle } from "../../../api";

// A Text Layer's plate is padded this many of its sizes either side and above the capitals and below
// the descenders, its corners this many round: as the planner drew its box before Text Styles
// (backend/app/migration.py).
const PAD_X = 0.35;
const PAD_Y = 0.22;
const RADIUS = 0.25;

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
export function textStyle(style: Partial<Omit<TextStyle, "plate">> & { plate?: Partial<Plate> } = {}): TextStyle {
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
