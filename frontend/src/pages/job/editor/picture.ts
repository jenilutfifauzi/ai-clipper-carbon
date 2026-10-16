import type { Background, Panel, Picture, Transform } from "../../../api";

/**
 * Pictures as the preview draws them (ADR 0007): a Picture of the plan as CSS, and the fitted-size
 * rule of backend/app/pictures.py, which the inspector's Fit and Fill and a new Overlay go by. The
 * plan resolves every Picture (ADR 0001); this only turns it into boxes.
 */

// The frame's size, in output pixels.
export const FRAME = { width: 1080, height: 1920 } as const;

// The Transform's limits (backend/app/candidates.py).
export const SCALE_RANGE = [0.05, 8] as const;
export const STRETCH_RANGE = [0.1, 10] as const;

// Every field at its identity: fitted, centred, upright, unflipped and opaque.
export const IDENTITY: Transform = { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 };

export interface PictureStyle {
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  opacity: number;
  // The media inside the box: its whole item, sized and moved so that only the crop shows in it.
  inner: { left: string; top: string; width: string; height: string };
  // An Overlay's rounded corners (a border-radius in shares of the box), border, and drop shadow
  // (a filter for a box that isn't turned, so that it falls in screen space); undefined without.
  radius?: string;
  border?: string;
  shadow?: string;
}

const percent = (share: number) => `${share * 100}%`;

// Output pixels as stage pixels: `--scale` is the stage's pixels per output pixel (ClipPreview).
const pixels = (value: number) => `calc(${value}px * var(--scale))`;

const rgb = (colour: string, opacity: number) =>
  `rgb(${[1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)).join(" ")} / ${opacity})`;

/**
 * The CSS of a box drawing `picture` on a stage of the `frame`'s shape: placed at its centre and as
 * large as it is drawn (in shares of the frame, so it may go past its edges), then centred on that
 * point, turned clockwise and flipped. CSS applies a transform's functions right to left, so the
 * flip comes first and the turn after it, in the renderer's order. Inside it, its media is as large
 * as its whole item would be and moved so that its crop fills the box (as `PanelView` shows a
 * Source crop), cut off by the box. Its corners are rounded as many output pixels across as down,
 * and its border and shadow stay as many output pixels whatever its size, as the renderer draws them.
 */
export function pictureStyle(picture: Picture, frame: { width: number; height: number }): PictureStyle {
  const [x, y] = picture.centre;
  const { crop, item_size: [across, down] } = picture;
  const steps = ["translate(-50%, -50%)"];
  if (picture.rotation % 360) steps.push(`rotate(${picture.rotation}deg)`);
  if (picture.flip_h || picture.flip_v) steps.push(`scale(${picture.flip_h ? -1 : 1}, ${picture.flip_v ? -1 : 1})`);
  return {
    left: percent(x / frame.width),
    top: percent(y / frame.height),
    width: percent(picture.width / frame.width),
    height: percent(picture.height / frame.height),
    transform: steps.join(" "),
    opacity: picture.opacity,
    inner: {
      left: percent(-crop.x / crop.width),
      top: percent(-crop.y / crop.height),
      width: percent(across / crop.width),
      height: percent(down / crop.height),
    },
    radius: picture.radius ? `${percent(picture.radius / picture.width)} / ${percent(picture.radius / picture.height)}` : undefined,
    border: picture.border ? `${pixels(picture.border.width)} solid ${picture.border.colour}` : undefined,
    shadow: picture.shadow
      ? `drop-shadow(${[picture.shadow.x, picture.shadow.y, picture.shadow.blur].map(pixels).join(" ")} ${rgb(picture.shadow.colour, picture.shadow.opacity)})`
      : undefined,
  };
}

export interface PanelStyle {
  box: { left: string; top: string; width: string; height: string };
  // Its item inside the box, sized and moved so that only the panel's crop shows in it.
  inner: { left: string; top: string; width: string; height: string };
}

/**
 * The CSS of a still panel of the plan (a Background's blurred cover) cropped from an item `item`
 * pixels large, on a stage of the `frame`'s shape: its area, and its item as large as the crop
 * makes it and moved to the crop's first point, as `PanelView` shows a Source crop.
 */
export function panelStyle(panel: Panel, [across, down]: [number, number], frame: { width: number; height: number }): PanelStyle {
  const { area, crop_width: width, crop_height: height } = panel;
  const point = panel.path[0] ?? { x: 0, y: 0 };
  return {
    box: {
      left: percent(area.x / frame.width),
      top: percent(area.y / frame.height),
      width: percent(area.width / frame.width),
      height: percent(area.height / frame.height),
    },
    inner: { left: percent(-point.x / width), top: percent(-point.y / height), width: percent(across / width), height: percent(down / height) },
  };
}

// The Background of the picture itself, blurred (the colour is kept for when it is switched to one).
export const BLURRED: Background = { kind: "blur", colour: "#000000" };

/** The largest size of a `width` x `height` picture that fits the frame keeping its aspect: its size at scale 1. */
export function fittedSize(width: number, height: number): { width: number; height: number } {
  const fit = Math.min(FRAME.width / width, FRAME.height / height);
  return { width: width * fit, height: height * fit };
}

/** The scale at which a `width` x `height` picture covers the frame. */
export function coverScale(width: number, height: number): number {
  return Math.max(FRAME.width / width, FRAME.height / height) / Math.min(FRAME.width / width, FRAME.height / height);
}

/**
 * The scale at which a `width` x `height` picture turned `rotation` degrees covers the frame: Fill.
 * Turned a quarter (or three), its fitted width stands up the frame and its height across it; at
 * any other angle it is the cover scale of the picture unturned.
 */
export function fillScale(width: number, height: number, rotation: number): number {
  if (Math.abs(rotation % 180) !== 90) return coverScale(width, height);
  const fitted = fittedSize(width, height);
  return Math.max(FRAME.width / fitted.height, FRAME.height / fitted.width);
}

/** The scale that draws a `width` x `height` picture `pixels` wide, within the Transform's range. */
export function scaleForWidth(width: number, height: number, pixels: number): number {
  return clamp(pixels / fittedSize(width, height).width, SCALE_RANGE);
}

export const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);
