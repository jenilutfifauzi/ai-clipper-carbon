// The Loop Region (GLOSSARY.md) as the preview plays it: where Play starts with Loop on, and where
// playback goes back to from Out, worked out from numbers alone. The marks that make it are the
// Advanced Edit's (../advanced/playhead.ts).

/** The stretch playback repeats while Loop is on, in Timeline time: from `in` to `out`. */
export interface LoopRegion {
  in: number;
  out: number;
}

/** Where Play starts with Loop on: at `time` inside the Region (Out is past it), otherwise at In. */
export function loopStart(time: number, region: LoopRegion): number {
  return time >= region.in && time < region.out ? time : region.in;
}

/**
 * Where playback goes from Out: In, in the Segment it is in (as played, back to back from 0 s; at a
 * join, the Segment after it), and In's time in the Source, or null in a media Segment, whose video
 * the preview plays itself.
 */
export function wrapTarget(
  region: LoopRegion,
  segments: { start: number; end: number; source_start: number; media?: string | null }[],
): { index: number; time: number; source: number | null } {
  const found = segments.findIndex((segment) => region.in < segment.end);
  const index = found === -1 ? segments.length - 1 : found;
  const segment = segments[index];
  return { index, time: region.in, source: segment.media ? null : segment.source_start + (region.in - segment.start) };
}
