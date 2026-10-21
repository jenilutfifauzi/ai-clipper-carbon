import { useSyncExternalStore } from "react";
import type { Grade, Picture } from "../../../api";
import { gradedColour } from "./grading";
import { offsetOnPicture, type Point } from "./pictureGestures";

/*
 * Chroma key's eyedropper (ADR 0014): the Inspector arms it for the picked Overlays, and the next
 * click on the paused preview over one of them picks the colour of its own picture there, as its
 * Grade turns it (the render keys after the Grade): its media's frame read at that point (not the
 * stage's pixels, which its effects, its key among them, have already changed).
 */

/** What the eyedropper is armed for: the Overlays (by id) it may pick from, and what takes the colour. */
export interface EyedropperRequest {
  overlays: string[];
  onPick: (colour: string) => void;
}

let armed: EyedropperRequest | null = null;
const listeners = new Set<() => void>();
const told = () => listeners.forEach((listener) => listener());

/** The eyedropper: armed by the Inspector, taken by the stage's click (EyedropperLayer in ClipPreview). */
export const eyedropper = {
  arm(request: EyedropperRequest) {
    armed = request;
    told();
  },
  cancel() {
    if (!armed) return;
    armed = null;
    told();
  },
  get current() {
    return armed;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** What the eyedropper is armed for now, or null. */
export const useEyedropper = (): EyedropperRequest | null => useSyncExternalStore(eyedropper.subscribe, () => armed);

/**
 * Where the frame point `point` (output pixels) is on `picture`'s media item, in its pixels (of its
 * `item_size`), turned, flipped and cropped back as the picture is drawn; null off the picture.
 */
export function mediaPointOf(picture: Picture, point: Point): Point | null {
  const [x, y] = picture.centre;
  const { along, down } = offsetOnPicture({ x, y, rotation: picture.rotation }, point);
  let u = along / picture.width + 0.5;
  let v = down / picture.height + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  if (picture.flip_h) u = 1 - u;
  if (picture.flip_v) v = 1 - v;
  const { crop } = picture;
  return {
    x: Math.min(crop.x + u * crop.width, picture.item_size[0] - 0.5),
    y: Math.min(crop.y + v * crop.height, picture.item_size[1] - 0.5),
  };
}

/** A display colour (0..1 each) as `#RRGGBB`. */
export const hexOf = (rgb: readonly number[]): string =>
  `#${rgb
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;

/**
 * The colour the eyedropper picks from `media` (an Overlay's image or video, as the preview draws it)
 * at `at` on its item (`item_size` pixels): its pixel there, read from a canvas, through `grade`.
 * Null when it can't be read (not loaded yet).
 */
export function pickedColour(media: HTMLImageElement | HTMLVideoElement, itemSize: [number, number], at: Point, grade: Grade | undefined): string | null {
  const [width, height] = media instanceof HTMLVideoElement ? [media.videoWidth, media.videoHeight] : [media.naturalWidth, media.naturalHeight];
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  // The media may be a smaller copy of the item (a video's proxy): the same point of it.
  const [sx, sy] = [Math.floor((at.x / itemSize[0]) * width), Math.floor((at.y / itemSize[1]) * height)];
  context.drawImage(media, sx, sy, 1, 1, 0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return hexOf(gradedColour(grade, [red / 255, green / 255, blue / 255]));
}
