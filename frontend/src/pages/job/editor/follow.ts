import type { Playback } from "./playback";

// A media element further than this from where the Clip's time puts it is moved back in step.
export const MAX_DRIFT_SECS = 0.15;

/**
 * Keeps `element` (a song, a video's Segment, an Overlay) in step with `playback` while the Clip's
 * time is in its span, from `start` to `end`, where it plays from `from` seconds into its file:
 * moved back when it drifts, playing and pausing with the playback; paused outside its span.
 * Returns whether the time is in its span.
 */
export function follow(element: HTMLMediaElement, playback: Playback, span: { start: number; end: number; from: number }): boolean {
  const time = playback.time;
  if (time < span.start || time >= span.end) {
    if (!element.paused) element.pause();
    return false;
  }
  const want = span.from + (time - span.start);
  if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
  if (playback.playing && element.paused) void element.play().catch(() => {});
  if (!playback.playing && !element.paused) element.pause();
  return true;
}
