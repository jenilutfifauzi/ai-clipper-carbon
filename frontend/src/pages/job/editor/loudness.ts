import type { AudioEvent } from "../../../api";
import { valueAt } from "./keyframes";

// A keyed sound's gain is set as a curve of this many values a second of the Clip's time (ADR 0008).
export const CURVE_RATE = 100;

/**
 * How loud a Music Clip (or an Overlay video's sound) is heard `time` seconds into the Clip: its
 * volume, or its Keyframes sampled there, through its fades' linear ramps; silent outside it. As the
 * renderer has it (gain_at in backend/app/planner.py): both are tested on the cases in
 * backend/tests/fixtures/gain_vectors.json, so that they can't drift.
 */
export function loudness(event: AudioEvent, time: number): number {
  if (time < event.start || time > event.end) return 0;
  let share = 1;
  if (event.fade_in > 0) share = Math.min(share, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) share = Math.min(share, (event.end - time) / event.fade_out);
  return valueAt(event.gain, time - event.start, event.volume) * Math.max(0, Math.min(1, share));
}

/**
 * `event`'s loudness from `time` to its end, CURVE_RATE values a second of the Clip's time, the
 * first at `time` (at least two): the curve its gain node follows while it plays. The last, which
 * may fall just past its end, is its loudness at its end.
 */
export function loudnessCurve(event: AudioEvent, time: number): Float32Array<ArrayBuffer> {
  const count = Math.max(2, Math.ceil((event.end - time) * CURVE_RATE) + 1);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) curve[i] = loudness(event, Math.min(time + i / CURVE_RATE, event.end));
  return curve;
}
