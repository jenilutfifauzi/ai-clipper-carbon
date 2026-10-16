import type { Playback } from "./playback";

// A media element further than this from where the Clip's time puts it is moved back in step.
export const MAX_DRIFT_SECS = 0.15;
// A parked element this close to its start is there already.
const PARKED_SECS = 0.01;

/**
 * Keeps `element` (a song, a video's Segment, an Overlay) in step with `playback` while the Clip's
 * time shown (the skimmed time while skimming) is in its span, from `start` to `end`, where it plays
 * from `from` seconds into its file: moved back when it drifts, playing and pausing with the
 * playback, at its rate; paused outside its span, and with `park`, waiting at `from` so that its
 * first frame is ready when its turn comes.
 * Returns whether the time is in its span.
 */
export function follow(element: HTMLMediaElement, playback: Playback, span: { start: number; end: number; from: number }, park = false): boolean {
  const time = playback.shownTime;
  if (element.playbackRate !== playback.rate) element.playbackRate = playback.rate;
  if (time < span.start || time >= span.end) {
    if (!element.paused) element.pause();
    if (park && Math.abs(element.currentTime - span.from) > PARKED_SECS) element.currentTime = span.from;
    return false;
  }
  const want = span.from + (time - span.start);
  if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
  if (playback.playing && element.paused) void element.play().catch(() => {});
  if (!playback.playing && !element.paused) element.pause();
  return true;
}
