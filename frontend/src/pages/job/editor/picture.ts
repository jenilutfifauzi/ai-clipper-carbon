import type { Picture, Transform } from "../../../api";

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
}

const percent = (share: number) => `${share * 100}%`;

/**
 * The CSS of a box drawing `picture` on a stage of the `frame`'s shape: placed at its centre and as
 * large as it is drawn (in shares of the frame, so it may go past its edges), then centred on that
 * point, turned clockwise and flipped. CSS applies a transform's functions right to left, so the
 * flip comes first and the turn after it, in the renderer's order.
 */
export function pictureStyle(picture: Picture, frame: { width: number; height: number }): PictureStyle {
  const [x, y] = picture.centre;
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
  };
}

/** The largest size of a `width` x `height` picture that fits the frame keeping its aspect: its size at scale 1. */
export function fittedSize(width: number, height: number): { width: number; height: number } {
  const fit = Math.min(FRAME.width / width, FRAME.height / height);
  return { width: width * fit, height: height * fit };
}

/** The scale at which a `width` x `height` picture covers the frame. */
export function coverScale(width: number, height: number): number {
  return Math.max(FRAME.width / width, FRAME.height / height) / Math.min(FRAME.width / width, FRAME.height / height);
}

/** The scale that draws a `width` x `height` picture `pixels` wide, within the Transform's range. */
export function scaleForWidth(width: number, height: number, pixels: number): number {
  return clamp(pixels / fittedSize(width, height).width, SCALE_RANGE);
}

export const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);
