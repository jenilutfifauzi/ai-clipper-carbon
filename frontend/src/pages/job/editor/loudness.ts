import type { AudioEvent, Keyframe } from "../../../api";
import { valueAt } from "./keyframes";

// A keyed sound's gain is set as a curve of this many values a second of the Clip's time (ADR 0008).
export const CURVE_RATE = 100;

/**
 * How loud a Music Clip (or an Overlay video's sound) is heard `time` seconds into the Clip: its
 * volume, or its Keyframes sampled there, through its fades' linear ramps, as the renderer has it
 * (gain_at in backend/app/planner.py).
 */
export function loudness(event: AudioEvent, time: number): number {
  let share = 1;
  if (event.fade_in > 0) share = Math.min(share, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) share = Math.min(share, (event.end - time) / event.fade_out);
  return valueAt(event.gain, time - event.start, event.volume) * Math.max(0, Math.min(1, share));
}

/**
 * A Source Segment's own sound as the decks play it, from `start` to `end` seconds into the Clip: its
 * volume, or its volume Keyframes (`gain`, in seconds from its start), times the Clip's own sound
 * (`source_volume`), as the renderer has it; faded out over `fade` (a Transition taking it away), if any.
 */
export function sourceSound(
  segment: { id?: string; start: number; end: number; source_start: number; volume?: number; gain?: Keyframe[] },
  source_volume: number,
  fade?: { start: number; end: number },
): AudioEvent {
  return {
    media: "",
    start: segment.start,
    end: fade ? fade.end : segment.end,
    offset: segment.source_start,
    volume: source_volume * (segment.volume ?? 1),
    fade_in: 0,
    fade_out: fade ? fade.end - fade.start : 0,
    gain: (segment.gain ?? []).map((key) => ({ ...key, value: key.value * source_volume })),
    id: segment.id ?? "",
  };
}

/**
 * `event`'s loudness from `time` to its end, CURVE_RATE values a second of the Clip's time, the
 * first at `time` (at least two): the curve its gain node follows while it plays.
 */
export function loudnessCurve(event: AudioEvent, time: number): Float32Array<ArrayBuffer> {
  const count = Math.max(2, Math.ceil((event.end - time) * CURVE_RATE) + 1);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) curve[i] = loudness(event, time + i / CURVE_RATE);
  return curve;
}
