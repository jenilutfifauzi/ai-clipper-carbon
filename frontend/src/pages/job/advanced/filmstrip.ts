import type { Retiming } from "../../../api";
import type { Layer } from "./ItemCanvas";
import type { MediaCache } from "./mediaCache";
import { CHUNK_SECS, filmstripTiles, tileWidth } from "./timelineView";

// A chunk fades in over this long when it arrives.
const FADE_MS = 150;

/**
 * An item's Filmstrip, as a layer of its canvas: tiles a frame wide at the canvas's height, each with
 * the frame under its middle, from the chunks at `url(start)` in `cache`. A tile whose chunk isn't
 * here yet is left clear, for what is under the canvas (a media item's thumbnail) to show.
 * `mediaStart` is the media's time at the item's left edge, played at `speed` (a Segment's Speed),
 * backwards in `reverse`; `media` is the video's length and size.
 */
export function filmstripLayer({
  cache,
  url,
  mediaStart,
  speed,
  reverse,
  media,
}: {
  cache: MediaCache;
  url: (start: number) => string;
  mediaStart: number;
  media: { duration: number; width: number; height: number };
} & Pick<Retiming, "speed" | "reverse">): Layer {
  return ({ ctx, span, view, width, height, dpr, pps, now, want }) => {
    const tile = tileWidth(height, media.width, media.height);
    const tiles = filmstripTiles({ width, mediaStart, speed, reverse, frames: Math.ceil(media.duration), tile, pps, view, span });
    const decoded = Math.round(height * dpr);
    let fading = false;
    for (const { left, frame } of tiles) {
      const start = Math.floor(frame / CHUNK_SECS) * CHUNK_SECS;
      const chunk = cache.strip(url(start), decoded, want(url(start)));
      if (!chunk || frame - start >= chunk.frames) continue;
      const frameWidth = chunk.bitmap.width / chunk.frames;
      const shown = Math.min(1, (now - chunk.arrived) / FADE_MS);
      fading ||= shown < 1;
      ctx.globalAlpha = shown;
      ctx.drawImage(chunk.bitmap, (frame - start) * frameWidth, 0, frameWidth, chunk.bitmap.height, left, 0, tile, height);
    }
    ctx.globalAlpha = 1;
    return fading;
  };
}
