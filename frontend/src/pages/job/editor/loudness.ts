import type { AudioEvent, SegmentPlan } from "../../../api";
import { valueAt } from "./keyframes";

// A keyed sound's gain is set as a curve of this many values a second of the Clip's time (ADR 0008).
export const CURVE_RATE = 100;

/**
 * A sound as the preview hears it: a Music Clip's (or an Overlay video's), or a Segment's
 * (`segmentSound`), which a Transition taking it away fades out over its `crossfade`.
 */
export type Heard = AudioEvent & { crossfade?: { start: number; end: number } };

/**
 * How loud a sound is heard `time` seconds into the Clip: its volume, or its Keyframes sampled there,
 * through its fades' linear ramps; silent outside it. As the renderer has it (gain_at in
 * backend/app/planner.py): both are tested on the cases in backend/tests/fixtures/gain_vectors.json,
 * so that they can't drift. Under a Transition's `crossfade`, that falls linearly from 1 to 0 over it
 * and multiplies the rest, as acrossfade does in the render.
 */
export function loudness(event: Heard, time: number): number {
  if (time < event.start || time > event.end) return 0;
  let share = 1;
  if (event.fade_in > 0) share = Math.min(share, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) share = Math.min(share, (event.end - time) / event.fade_out);
  const { crossfade } = event;
  const taken = crossfade && time > crossfade.start ? (crossfade.end - time) / (crossfade.end - crossfade.start) : 1;
  return valueAt(event.gain, time - event.start, event.volume) * Math.max(0, Math.min(1, share)) * Math.max(0, Math.min(1, taken));
}

/**
 * A Segment's sound as heard: its volume (a Source Segment's under the Clip's own, `sourceVolume`)
 * or its Keyframes, and its fades, from its start to its end on the Timeline (a Transition's overlap
 * included); taken away over `crossfade`, if any.
 */
export function segmentSound(segment: SegmentPlan, sourceVolume: number, crossfade?: { start: number; end: number }): Heard {
  return {
    media: segment.media ?? "",
    start: segment.start,
    end: segment.end,
    offset: segment.source_start,
    volume: segment.volume * (segment.media ? 1 : sourceVolume),
    fade_in: segment.fade_in,
    fade_out: segment.fade_out,
    gain: segment.gain,
    id: segment.id,
    ...(crossfade && { crossfade }),
  };
}

/** Whether a sound's loudness changes over its time: keyed, faded or taken away by a Transition. */
export const changing = (event: Heard): boolean => event.gain.length > 0 || event.fade_in > 0 || event.fade_out > 0 || !!event.crossfade;

/**
 * `event`'s loudness from `time` to its end, CURVE_RATE values a second of the Clip's time, the
 * first at `time` (at least two): the curve its gain node follows while it plays. The last, which
 * may fall just past its end, is its loudness at its end.
 */
export function loudnessCurve(event: Heard, time: number): Float32Array<ArrayBuffer> {
  const count = Math.max(2, Math.ceil((event.end - time) * CURVE_RATE) + 1);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) curve[i] = loudness(event, Math.min(time + i / CURVE_RATE, event.end));
  return curve;
}
