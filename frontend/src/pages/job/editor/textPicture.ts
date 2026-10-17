import { useEffect, useState } from "react";
import { textPictureUrl, type TextEvent } from "../../../api";

// A Text Layer's picture as the preview draws it (docs/adr/0010): its URL, and the size it is drawn
// at, in output pixels, before its Transform scales it.
export interface ShownPicture {
  url: string;
  width: number;
  height: number;
}

// The pictures the browser has loaded in this page: one of them shows at once.
const loaded = new Set<string>();

/** The picture of `event`, by its name alone: moving, turning or fading the layer asks for no new one. */
export function wantedPicture(jobId: string, event: TextEvent): ShownPicture {
  return { url: textPictureUrl(jobId, event.image), width: event.picture.width, height: event.picture.height };
}

/**
 * What to draw for a Text Layer that wants `wanted`, `shown` being what it drew last: the wanted
 * picture once it has loaded, else the last one, so that the preview never blinks or goes blank
 * while a changed look is made and fetched (null before any has loaded).
 */
export function pictureToShow(shown: ShownPicture | null, wanted: ShownPicture, isLoaded: (url: string) => boolean): ShownPicture | null {
  return isLoaded(wanted.url) ? wanted : shown;
}

/** The picture a Text Layer draws now (`pictureToShow`), loading the one it wants. */
export function useTextPicture(wanted: ShownPicture): ShownPicture | null {
  const [shown, setShown] = useState<ShownPicture | null>(() => pictureToShow(null, wanted, (url) => loaded.has(url)));
  const { url, width, height } = wanted;
  useEffect(() => {
    if (loaded.has(url)) {
      setShown({ url, width, height });
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => {
      loaded.add(url);
      if (current) setShown({ url, width, height });
    };
    image.src = url;
    return () => {
      current = false;
    };
  }, [url, width, height]);
  return pictureToShow(shown, wanted, (url) => loaded.has(url));
}
