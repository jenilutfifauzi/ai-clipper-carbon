// Seam H (.scratch/transform-crop/spec.md): Crop mode (GLOSSARY.md) worked out from numbers alone:
// the whole picture as it lies dimmed on the stage, the kept part on it, the handles that move the
// Crop in the picture's own axes, and the commit that keeps the kept part where it was. The crop is
// taken first and the cropped picture is what is fitted, so a new Crop changes the fitted size: the
// commit makes up for it with the Transform's scale and centre
// (docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md).
import type { Crop, Transform } from "../../../api";
import { clamp, fittedSize, SCALE_RANGE } from "./picture";
import { offsetOnPicture, placed, pointOnPicture, type Corner, type Edge, type Placed, type Point, type Size } from "./pictureGestures";

export type { Crop };

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

// An edge cuts off at most this much, and a pair leaves at least the rest of a whole.
const MAX_CUT = 0.9;

/** Each edge held to 0..0.9, and a pair that would leave less than a tenth pulled back (its second). */
export function tidyCrop(crop: Crop): Crop {
  const left = clamp(crop.left, [0, MAX_CUT]);
  const top = clamp(crop.top, [0, MAX_CUT]);
  return { left, top, right: clamp(crop.right, [0, MAX_CUT - left]), bottom: clamp(crop.bottom, [0, MAX_CUT - top]) };
}

/** The size of what is kept of a picture `item` pixels large: what is fitted. */
export function croppedSize(item: Size, crop: Crop): Size {
  return { width: item.width * (1 - crop.left - crop.right), height: item.height * (1 - crop.top - crop.bottom) };
}

/**
 * Crop mode as it was opened on a picture: its Transform and Crop then, its media item's size in
 * pixels, and the frame's. The whole picture lies where these put it until Crop mode closes.
 */
export interface CropEntry {
  transform: Transform;
  crop: Crop;
  item: Size;
  frame: Size;
}

// The kept part's span across and down the picture as drawn, as fractions from its own left and top:
// a flip draws the item's left cut on the right.
function spans(crop: Crop, { flip_h, flip_v }: Transform) {
  const [left, right] = flip_h ? [crop.right, crop.left] : [crop.left, crop.right];
  const [top, bottom] = flip_v ? [crop.bottom, crop.top] : [crop.top, crop.bottom];
  return { across: [left, 1 - right], down: [top, 1 - bottom] };
}

// The middle of `span` from the picture's middle, as a fraction of it.
const offCentre = ([start, end]: number[]) => (start + end) / 2 - 0.5;

/** Where the whole, uncropped picture lies on the frame in Crop mode: under the kept part, dimmed. */
export function wholePicture({ transform, crop, item, frame }: CropEntry): Placed {
  const kept = placed(transform, fittedSize(croppedSize(item, crop), frame));
  const { across, down } = spans(crop, transform);
  const width = kept.width / (across[1] - across[0]);
  const height = kept.height / (down[1] - down[0]);
  const centre = pointOnPicture(kept, -offCentre(across) * width, -offCentre(down) * height);
  return { ...centre, width, height, rotation: transform.rotation };
}

/** Where the part `crop` keeps lies on the whole picture of `entry`: what Crop mode shows bright. */
export function keptPart(entry: CropEntry, crop: Crop): Placed {
  const whole = wholePicture(entry);
  const { across, down } = spans(crop, entry.transform);
  const centre = pointOnPicture(whole, offCentre(across) * whole.width, offCentre(down) * whole.height);
  return { ...centre, width: (across[1] - across[0]) * whole.width, height: (down[1] - down[0]) * whole.height, rotation: whole.rotation };
}

/**
 * The Crop after the crop handle `handle` (named by where it sits on the picture as drawn) is
 * dragged from `from` to `to`, from the Crop `grabbed`: its edge or edges moved as far as the
 * pointer moved along the picture's own axes, from 0 to a tenth short of the opposite edge.
 */
export function cropDragged(entry: CropEntry, grabbed: Crop, handle: Corner | Edge, from: Point, to: Point): Crop {
  const whole = wholePicture(entry);
  const [start, end] = [offsetOnPicture(whole, from), offsetOnPicture(whole, to)];
  const across = (end.along - start.along) / whole.width;
  const down = (end.down - start.down) / whole.height;
  const { flip_h, flip_v } = entry.transform;
  // The fields of the Crop cut off the picture's own left, right, top and bottom as drawn.
  const [left, right] = flip_h ? (["right", "left"] as const) : (["left", "right"] as const);
  const [top, bottom] = flip_v ? (["bottom", "top"] as const) : (["top", "bottom"] as const);
  const next = { ...grabbed };
  const cut = (edge: keyof Crop, opposite: keyof Crop, by: number) => {
    next[edge] = clamp(grabbed[edge] + by, [0, MAX_CUT - grabbed[opposite]]);
  };
  if (handle.includes("left")) cut(left, right, across);
  if (handle.includes("right")) cut(right, left, -across);
  if (handle.includes("top")) cut(top, bottom, down);
  if (handle.includes("bottom")) cut(bottom, top, -down);
  return next;
}

/**
 * The Transform that, with `crop` (tidied), draws the part it keeps where Crop mode showed it: the
 * scale that makes the newly fitted picture as large, and the centre at the kept part's (which, on a
 * turned picture, moves along its own axes). Its stretch, rotation, flips and opacity are kept.
 */
export function cropCommitted(entry: CropEntry, crop: Crop): Transform {
  const tidied = tidyCrop(crop);
  const kept = keptPart(entry, tidied);
  const fitted = fittedSize(croppedSize(entry.item, tidied), entry.frame);
  const { transform, frame } = entry;
  return {
    ...transform,
    x: clamp(kept.x, [0, frame.width]),
    y: clamp(kept.y, [0, frame.height]),
    scale: clamp(kept.width / (fitted.width * transform.stretch_x), SCALE_RANGE),
  };
}
