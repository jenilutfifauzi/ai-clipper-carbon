import type { TransitionSound } from "../../../api";
import type { Share } from "./loudness";

// How long each side's sound takes to give way to the other's at the middle of a Cut (_CUT_SECS in
// backend/app/renderer.py).
const CUT_SECS = 0.02;

// A Transition's span in seconds into the Clip, and its sound (linear when left out).
export type Crossing = { start: number; end: number; sound?: TransitionSound };

/**
 * How loud each side of `transition` is heard `time` seconds into the Clip, as shares of its own
 * loudness, by its sound, as the render's acrossfade has it (`_sounds_crossed` in
 * backend/app/renderer.py): in straight lines; along quarter sines, so that the summed power stays
 * whole; or, for a Cut, the first side alone until the middle and the second after it, switched
 * over CUT_SECS. Before the Transition only the outgoing side is heard, after it only the incoming one.
 */
export function crossedVolumes(transition: Crossing, time: number): { outgoing: number; incoming: number } {
  const clamped = (share: number) => Math.min(1, Math.max(0, share));
  const length = transition.end - transition.start;
  if (transition.sound === "cut") {
    const incoming = clamped((time - (transition.start + length / 2 - CUT_SECS / 2)) / CUT_SECS);
    return { outgoing: 1 - incoming, incoming };
  }
  const progress = clamped((time - transition.start) / length);
  if (transition.sound === "equal_power") return { outgoing: Math.cos((progress * Math.PI) / 2), incoming: Math.sin((progress * Math.PI) / 2) };
  return { outgoing: 1 - progress, incoming: progress };
}

// A Segment's share of its own loudness across the Transition that brings it in (`into`) and the one
// that takes it away (`out`), either of which it may lack.
export const crossedBy =
  (into?: Crossing, out?: Crossing): Share =>
  (time) =>
    (into ? crossedVolumes(into, time).incoming : 1) * (out ? crossedVolumes(out, time).outgoing : 1);

// How loud the Segment `time` is in plays, as a share of its own loudness: within one of
// `transitions`, as the side it brings in (`crossedVolumes`); elsewhere whole.
export function broughtIn(transitions: Crossing[], time: number): number {
  const crossing = transitions.find((transition) => time >= transition.start && time < transition.end);
  return crossing ? crossedVolumes(crossing, time).incoming : 1;
}
