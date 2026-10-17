import { useEffect, useState } from "react";
import { textPictureUrl, type Picture, type TextEvent } from "../../../api";
import { pictureAt } from "./picture";

// A Text Layer's picture as the preview draws it (docs/adr/0010): its URL, and the size it is drawn
// at, in output pixels, Transform scale included.
export interface ShownPicture {
  url: string;
  width: number;
  height: number;
}

// The picture a Text Layer's plan names: what it shows at any scale (`look`, by its Job) and how many
// pixels wide it was made (`made`). Pictures of one look differ only in size.
export interface WantedPicture extends ShownPicture {
  look: string;
  made: number;
}

// A picture the browser has loaded: the largest of its look.
export type Loaded = { url: string; made: number };

// The largest picture of each look the browser has loaded in this page.
const largest = new Map<string, Loaded>();

/** The picture of `event`, by its name alone: moving, turning or fading the layer asks for no new one. */
export function wantedPicture(jobId: string, event: TextEvent): WantedPicture {
  const { picture } = event;
  return {
    url: textPictureUrl(jobId, event.image),
    width: picture.width,
    height: picture.height,
    look: `${jobId}/${event.look}`,
    made: picture.item_size[0],
  };
}

/** Whether `wanted` has to be loaded: no picture of its look as large has been (`loaded`). */
export function needsLoading(wanted: WantedPicture, loaded: (look: string) => Loaded | undefined): boolean {
  const best = loaded(wanted.look);
  return !best || best.made < wanted.made;
}

/**
 * What to draw for a Text Layer that wants `wanted`, `shown` being what it drew last: the largest
 * picture of its look loaded (`loaded`), drawn at the wanted size, so that scaling the layer down
 * draws the larger picture it has, and scaling it up draws that one larger until the sharper one has
 * loaded; else the last one, so that the preview never blinks or goes blank while a changed look is
 * made and fetched (null before any has loaded).
 */
export function pictureToShow(shown: ShownPicture | null, wanted: WantedPicture, loaded: (look: string) => Loaded | undefined): ShownPicture | null {
  const best = loaded(wanted.look);
  return best ? { url: best.url, width: wanted.width, height: wanted.height } : shown;
}

const loadedLook = (look: string) => largest.get(look);

// Where a Text Layer's picture is drawn, in output pixels: its centre, its size, its turn in degrees
// clockwise about its centre, and its opacity.
export interface PlacedText {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

/**
 * A Text Layer's `picture` as drawn at `time` seconds into the Clip, its animations' `look` there
 * being its opacity, scale and drop (hookLook): as its Keyframes have it (pictureAt, ADR 0008), then
 * faded, scaled about its centre and moved down on top, as the renderer's text_at draws it.
 */
export function placedText(picture: Picture, time: number, [opacity, scale, below]: readonly [number, number, number]): PlacedText {
  const drawn = pictureAt(picture, time);
  const [x, y] = drawn.centre;
  return { x, y: y + below, width: drawn.width * scale, height: drawn.height * scale, rotation: drawn.rotation, opacity: drawn.opacity * opacity };
}

/** The picture a Text Layer draws now (`pictureToShow`), loading the one it wants when it needs to (`needsLoading`). */
export function useTextPicture(wanted: WantedPicture): ShownPicture | null {
  const [shown, setShown] = useState<ShownPicture | null>(() => pictureToShow(null, wanted, loadedLook));
  const { url, width, height, look, made } = wanted;
  useEffect(() => {
    const want = { url, width, height, look, made };
    if (!needsLoading(want, loadedLook)) {
      setShown(pictureToShow(null, want, loadedLook));
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (needsLoading(want, loadedLook)) largest.set(look, { url, made });
      if (current) setShown(pictureToShow(null, want, loadedLook));
    };
    image.src = url;
    return () => {
      current = false;
    };
  }, [url, width, height, look, made]);
  return pictureToShow(shown, wanted, loadedLook);
}
