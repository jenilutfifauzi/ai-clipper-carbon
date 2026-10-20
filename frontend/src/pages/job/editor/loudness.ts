import type { AudioEvent, Ducking, Keyframe } from "../../../api";
import { valueAt } from "./keyframes";
import { crossedVolumes, type Crossing } from "./transitionSound";

// A keyed sound's gain is set as a curve of this many values a second of the Clip's time (ADR 0008).
export const CURVE_RATE = 100;

// A share of a sound's loudness at a time into the Clip: across a Transition (transitionSound.ts).
export type Share = (time: number) => number;

/**
 * A sound as the preview hears it: a Music Clip's (or an Overlay video's), or a Segment's
 * (`segmentSound`), which a Transition taking it away fades out over its `crossfade`, along its sound
 * (transitionSound.ts). A ducked one
 * carries its plan's `ducking` (`eventSound`).
 */
export type Heard = AudioEvent & { crossfade?: Crossing; ducking?: Ducking };

/**
 * How far a sound ducked `depth` dB under `spans` (seconds into the Clip) is turned down at `time`:
 * 1 away from speech, the depth's gain over a span, in straight lines between over the lead before
 * one and the release after it; the lowest of the spans'. As duck_at in backend/app/ducking.py.
 */
export function duckAt(spans: [number, number][], depth: number, time: number, ducking: Ducking): number {
  const low = 10 ** (depth / 20);
  let share = 1;
  for (const [start, end] of spans) {
    if (time < start) share = Math.min(share, 1 + (low - 1) * Math.max(0, (time - start + ducking.lead_secs) / ducking.lead_secs));
    else if (time <= end) share = low;
    else share = Math.min(share, low + (1 - low) * Math.min(1, (time - end) / ducking.release_secs));
  }
  return share;
}

/**
 * How loud a sound is heard `time` seconds into the Clip: its volume, or its Keyframes sampled there,
 * through its fades' linear ramps, and a ducked one's duck (`duckAt`); silent outside it, and when
 * Muted (ADR 0016). Track mute doesn't reach the duck: speech counts by `muted` alone. As the renderer has
 * it (gain_at in backend/app/planner.py): both are tested on the cases in
 * backend/tests/fixtures/gain_vectors.json, so that they can't drift. The Timeline's Volume Line and
 * Waveform are drawn by it too (timelineView.ts' gainAt). Under a Transition's
 * `crossfade`, that falls from 1 to 0 over it along the Transition's sound (the outgoing side of
 * `crossedVolumes`) and multiplies the rest, as acrossfade does in the render; times `crossed`, a
 * Segment's share as the side a Transition brings in (transitionSound.ts' `crossedBy`).
 */
export function loudness(event: Heard, time: number, crossed: Share = () => 1): number {
  if (event.muted || time < event.start || time > event.end) return 0;
  let share = 1;
  if (event.fade_in > 0) share = Math.min(share, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) share = Math.min(share, (event.end - time) / event.fade_out);
  const { crossfade } = event;
  const taken = crossfade && time > crossfade.start ? crossedVolumes(crossfade, time).outgoing : 1;
  const ducked = event.duck != null && event.ducking ? duckAt(event.speech_spans ?? [], event.duck, time, event.ducking) : 1;
  return valueAt(event.gain, time - event.start, event.volume) * Math.max(0, Math.min(1, share)) * Math.max(0, Math.min(1, taken)) * ducked * crossed(time);
}

/**
 * A Segment's own sound as heard, from `start` to `end` seconds into the Clip (a Transition's overlap
 * included): its volume, or its volume Keyframes (`gain`, in seconds from its start), a Source
 * Segment's times the Clip's own sound (`sourceVolume`), as the renderer has it; through its fades,
 * and taken away over `crossfade` (a Transition), if any. A Segment as planned, or as played from the
 * draft (without its fades, which the plan fits).
 */
export function segmentSound(
  segment: {
    id?: string;
    start: number;
    end: number;
    source_start: number;
    media?: string | null;
    volume?: number;
    gain?: Keyframe[];
    fade_in?: number;
    fade_out?: number;
    muted?: boolean;
  },
  sourceVolume: number,
  crossfade?: Crossing,
): Heard {
  const own = segment.media ? 1 : sourceVolume;
  return {
    media: segment.media ?? "",
    start: segment.start,
    end: segment.end,
    offset: segment.source_start,
    volume: own * (segment.volume ?? 1),
    fade_in: segment.fade_in ?? 0,
    fade_out: segment.fade_out ?? 0,
    gain: (segment.gain ?? []).map((key) => ({ ...key, value: key.value * own })),
    id: segment.id ?? "",
    muted: segment.muted ?? false,
    ...(crossfade && { crossfade }),
  };
}

/**
 * A Music Clip's (or an Overlay video's) sound as heard, from its plan's `event`: a Music Clip of the
 * Source's (`source`) times the Clip's own sound (`sourceVolume`), its Keyframes' values too, as the
 * renderer has it; a ducked one with its plan's `ducking`; any other, and the Source's at 1, the
 * event itself.
 */
export function eventSound(event: AudioEvent, sourceVolume: number, ducking?: Ducking): Heard {
  if (event.duck != null && ducking) return { ...eventSound(event, sourceVolume), ducking };
  if (!event.source || sourceVolume === 1) return event;
  return { ...event, volume: event.volume * sourceVolume, gain: event.gain.map((key) => ({ ...key, value: key.value * sourceVolume })) };
}

/** Whether a sound's loudness changes over its time: keyed, faded, ducked under speech or taken away by a Transition. */
export const changing = (event: Heard): boolean =>
  event.gain.length > 0 || event.fade_in > 0 || event.fade_out > 0 || !!event.crossfade || (event.duck != null && !!event.speech_spans?.length);

/**
 * `event`'s loudness (times `crossed`) from `time` to its end, CURVE_RATE values a second of the
 * Clip's time, the first at `time` (at least two): the curve its gain node follows while it plays.
 * The last, which may fall just past its end, is its loudness at its end.
 */
export function loudnessCurve(event: Heard, time: number, crossed?: Share): Float32Array<ArrayBuffer> {
  const count = Math.max(2, Math.ceil((event.end - time) * CURVE_RATE) + 1);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) curve[i] = loudness(event, Math.min(time + i / CURVE_RATE, event.end), crossed);
  return curve;
}
