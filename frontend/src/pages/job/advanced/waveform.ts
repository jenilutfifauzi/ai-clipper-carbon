import type { Layer } from "./ItemCanvas";
import type { MediaCache } from "./mediaCache";
import { offsetAt, playingFrom, sourceAt } from "../editor/segmentTime";
import { CHUNK_SECS, chunksAcross, peaksExtremes, peaksLevel } from "./timelineView";

// A chunk fades in over this long when it arrives, as a Filmstrip's does.
const FADE_MS = 150;
// Under a Waveform drawn as a band, so that it reads over the frames.
const BAND_BACKDROP = "rgb(0 0 0 / 0.45)";

/**
 * An item's Waveform, as a layer of its canvas: a bar for each device-pixel column, from the lowest
 * to the highest of the sound under it, about the middle of the canvas or of its bottom `band` pixels
 * (over a dark backdrop), scaled by `gain(time)` (`time` in seconds into the item) and clipped there.
 * Its Peaks are the chunks at `url(start)` in `cache`; a stretch whose chunk isn't here yet is left
 * clear. `mediaStart` is the media's time at the item's left edge, played at `speed` (a Segment's
 * Speed), backwards in `reverse` (its Waveform mirrored), and `duration` the media's length.
 */
export function waveformLayer({
  cache,
  url,
  mediaStart,
  speed,
  reverse,
  duration,
  gain,
  color,
  band,
}: {
  cache: MediaCache;
  url: (start: number) => string;
  mediaStart: number;
  speed?: number;
  reverse?: boolean;
  duration: number;
  gain: (time: number) => number;
  color: string;
  band?: number;
}): Layer {
  return ({ ctx, span, width, height, dpr, pps, now, want }) => {
    const tall = Math.min(band ?? height, height);
    const middle = height - tall / 2;
    const column = 1 / dpr;
    let fading = false;
    const media = playingFrom(mediaStart, speed, reverse);
    for (const start of chunksAcross({ mediaStart, speed, reverse, pps, width, span, duration })) {
      const chunk = cache.peaks(url(start), want(url(start)));
      if (!chunk) continue;
      const shown = Math.min(1, (now - chunk.arrived) / FADE_MS);
      fading ||= shown < 1;
      const level = peaksLevel(chunk.levels, pps, dpr);
      // The columns of the canvas (counted from its left) that start in this chunk, on the item: in
      // Reverse its end is to the left of its start.
      const [from, to] = [offsetAt(media, start), offsetAt(media, Math.min(start + CHUNK_SECS, duration))];
      const left = Math.max(span.left, 0, Math.min(from, to) * pps);
      const right = Math.min(span.right, width, Math.max(from, to) * pps);
      const first = Math.ceil((left - span.left) * dpr - 1e-6);
      const last = Math.ceil((right - span.left) * dpr - 1e-6);
      if (last <= first) continue;
      ctx.globalAlpha = shown;
      if (band) {
        ctx.fillStyle = BAND_BACKDROP;
        ctx.fillRect(span.left + first * column, height - tall, (last - first) * column, tall);
      }
      ctx.beginPath();
      for (let i = first; i < last; i++) {
        const x = span.left + i * column;
        const [a, b] = [sourceAt(media, x / pps) - start, sourceAt(media, (x + column) / pps) - start];
        const [low, high] = peaksExtremes(level, Math.min(a, b), Math.max(a, b));
        const scale = (gain((x + column / 2) / pps) * tall) / 2;
        const top = Math.min(high * scale, tall / 2);
        const bottom = Math.min(-low * scale, tall / 2);
        if (top + bottom > 0) ctx.rect(x, middle - top, column, Math.max(top + bottom, column));
      }
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return fading;
  };
}
