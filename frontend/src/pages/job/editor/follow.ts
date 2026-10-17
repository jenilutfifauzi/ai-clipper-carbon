import type { AudioEvent, OverlayEvent, Retiming } from "../../../api";
import type { Playback } from "./playback";
import { playedSourceAt, retimingOf } from "./segmentTime";

// A media element further than this from where the Clip's time puts it is moved back in step.
export const MAX_DRIFT_SECS = 0.15;
// A parked element this close to its start is there already.
const PARKED_SECS = 0.01;
// The Speeds a browser plays a video at; beyond them it mutes or stutters, and the item plays a Retimed copy instead (ADR 0009, retimedCopy.ts).
export const PLAYABLE_SPEEDS = { min: 0.25, max: 4 };

/** The Speed a video is played at to show `speed`: the nearest a browser plays well (an item beyond them plays a Retimed copy, retimedCopy.ts). */
export const previewSpeed = (speed = 1) => Math.min(PLAYABLE_SPEEDS.max, Math.max(PLAYABLE_SPEEDS.min, speed));

/** A plan's Overlay or sound: from `start` to `end` in the Clip, its item from `offset`, as it plays it. */
export type PlannedEvent = Pick<OverlayEvent | AudioEvent, "start" | "end" | "offset"> & Omit<Retiming, "hold">;

/** The span `follow` keeps a plan's Overlay video or sound in. */
export const eventSpan = ({ start, end, offset, speed, pitch }: PlannedEvent) => ({ start, end, from: offset, speed, pitch });

/**
 * Keeps `element` (a song, a video's Segment, an Overlay) in step with `playback` while the Clip's
 * time shown (the skimmed time while skimming) is in its span, from `start` to `end`, where it plays
 * its file from `from` seconds into it, as a Segment as played does (segmentTime.ts): moved back
 * when it drifts, playing and pausing with the playback, at its rate times its Speed
 * (`previewSpeed`), its pitch kept unless `pitch` (a Freeze frame's paused at its frame throughout);
 * paused outside its span, and with `park`, waiting where it starts so that its first frame is
 * ready when its turn comes.
 * Returns whether the time is in its span.
 */
export function follow(
  element: HTMLMediaElement,
  playback: Playback,
  span: { start: number; end: number; from: number } & Retiming,
  park = false,
): boolean {
  const time = playback.shownTime;
  const played = { start: span.start, end: span.end, source_start: span.from, ...retimingOf(span) };
  const rate = playback.rate * previewSpeed(span.speed);
  if (element.playbackRate !== rate) element.playbackRate = rate;
  if (element.preservesPitch === !!span.pitch) element.preservesPitch = !span.pitch;
  if (time < span.start || time >= span.end) {
    if (!element.paused) element.pause();
    const first = playedSourceAt(played, span.start);
    if (park && Math.abs(element.currentTime - first) > PARKED_SECS) element.currentTime = first;
    return false;
  }
  const want = playedSourceAt(played, time);
  if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
  // A Freeze frame's stays paused at its frame.
  const plays = playback.playing && span.hold == null;
  if (plays && element.paused) void element.play().catch(() => {});
  if (!plays && !element.paused) element.pause();
  return true;
}
