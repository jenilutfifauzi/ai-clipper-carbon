import { useEffect, useState } from "react";
import { layerPictureUrl, type Picture, type PictureLayerEvent } from "../../../api";
import { animatedPicture, type Look } from "./animation";
import type { Size } from "./pictureGestures";

// A picture layer's picture as the preview draws it (docs/adr/0010): its URL, and the size it is drawn
// at, in output pixels, Transform scale included.
export interface ShownPicture {
  url: string;
  width: number;
  height: number;
}

// The picture a picture layer's plan names: what it shows at any scale (`key`, its picture_key by its
// Job) and how many pixels wide it was made (`made`). Pictures of one key differ only in size.
export interface WantedPicture extends ShownPicture {
  key: string;
  made: number;
}

// A picture the browser has loaded: the largest of its key.
export type Loaded = { url: string; made: number };

// The largest picture of each key the browser has loaded in this page.
const largest = new Map<string, Loaded>();

/** The picture of `event`, by its name alone: moving, turning or fading the layer asks for no new one. */
export function wantedPicture(jobId: string, event: PictureLayerEvent): WantedPicture {
  const { picture } = event;
  return {
    url: layerPictureUrl(jobId, event.image),
    width: picture.width,
    height: picture.height,
    key: `${jobId}/${event.picture_key}`,
    made: picture.item_size[0],
  };
}

/** Whether `wanted` has to be loaded: no picture of its key as large has been (`loaded`). */
export function needsLoading(wanted: WantedPicture, loaded: (key: string) => Loaded | undefined): boolean {
  const best = loaded(wanted.key);
  return !best || best.made < wanted.made;
}

/**
 * What to draw for a picture layer that wants `wanted`, `shown` being what it drew last: the largest
 * picture of its key loaded (`loaded`), drawn at the wanted size, so that scaling the layer down
 * draws the larger picture it has, and scaling it up draws that one larger until the sharper one has
 * loaded; else the last one, so that the preview never blinks or goes blank while a changed look is
 * made and fetched (null before any has loaded).
 */
export function pictureToShow(shown: ShownPicture | null, wanted: WantedPicture, loaded: (key: string) => Loaded | undefined): ShownPicture | null {
  const best = loaded(wanted.key);
  return best ? { url: best.url, width: wanted.width, height: wanted.height } : shown;
}

const loadedPicture = (key: string) => largest.get(key);

// Where a picture layer's picture is drawn, in output pixels: its centre, its size, its turn in degrees
// clockwise about its centre, and its opacity.
export interface PlacedLayer {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

/**
 * A picture layer's `picture` as drawn at `time` seconds into the Clip on the Canvas `frame`, its animations' `look` there
 * being its opacity, scale and drop (hookLook): as an Overlay's is (animatedPicture), as the
 * renderer's layer_at draws it.
 */
export function placedLayer(picture: Picture, time: number, look: Look, frame: Size): PlacedLayer {
  const drawn = animatedPicture(picture, time, look, frame);
  const [x, y] = drawn.centre;
  return { x, y, width: drawn.width, height: drawn.height, rotation: drawn.rotation, opacity: drawn.opacity };
}

/** The picture a picture layer draws now (`pictureToShow`), loading the one it wants when it needs to (`needsLoading`). */
export function useLayerPicture(wanted: WantedPicture): ShownPicture | null {
  const [shown, setShown] = useState<ShownPicture | null>(() => pictureToShow(null, wanted, loadedPicture));
  const { url, width, height, key, made } = wanted;
  useEffect(() => {
    const want = { url, width, height, key, made };
    if (!needsLoading(want, loadedPicture)) {
      setShown(pictureToShow(null, want, loadedPicture));
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (needsLoading(want, loadedPicture)) largest.set(key, { url, made });
      if (current) setShown(pictureToShow(null, want, loadedPicture));
    };
    image.src = url;
    return () => {
      current = false;
    };
  }, [url, width, height, key, made]);
  return pictureToShow(shown, wanted, loadedPicture);
}
