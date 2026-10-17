import type { ClipSegment } from "../../../api";

/**
 * A Segment's or a video Overlay's Speed (GLOSSARY.md, docs/adr/0009): 0.0625–16×, as Concat's
 * SPEED_RANGE and the backend's `Speed` (MIN_SPEED, MAX_SPEED in backend/app/candidates.py).
 */
export const SPEED_RANGE = [0.0625, 16] as const;

/** The Speeds the inspector offers as chips. */
export const SPEED_CHIPS = [0.25, 0.5, 1, 1.5, 2, 4] as const;

/** `value` as a Speed: within SPEED_RANGE, to three significant figures (0.0625 stays exact). */
export function speedOf(value: number): number {
  const [low, high] = SPEED_RANGE;
  return Number(Math.min(Math.max(value, low), high).toPrecision(3));
}

/** A Speed as the Timeline's badge and the inspector show it: "2×", "0.25×". */
export const speedLabel = (speed: number) => `${speedOf(speed)}×`;

// The slider runs over the Speed's octaves: 0.0625× is −4, 1× is 0, 16× is 4.
export const SPEED_OCTAVES = [Math.log2(SPEED_RANGE[0]), Math.log2(SPEED_RANGE[1])] as const;
export const octaveOf = (speed: number) => Math.log2(speed);
export const speedAtOctave = (octave: number) => speedOf(2 ** octave);

/**
 * What the clip editor says of a Clip cut into `segments`, which it gives way to the Advanced Edit
 * for: how many Segments, or how its one Segment plays (its Speed, its Reverse or both; a Freeze
 * frame; a video).
 */
export function cutNote(segments: readonly ClipSegment[]): string {
  if (segments.length !== 1) return `This clip is cut into ${segments.length} Segments`;
  const [{ speed = 1, reverse, hold, media }] = segments;
  if (hold != null) return "This clip is a Freeze frame";
  const sped = speedOf(speed) !== 1;
  if (sped && reverse) return `This clip plays in Reverse at a Speed of ${speedLabel(speed)}`;
  if (sped) return `This clip plays at a Speed of ${speedLabel(speed)}`;
  if (reverse) return "This clip plays in Reverse";
  return media ? "This clip plays a video from the Media Library" : "This clip is one Segment";
}
