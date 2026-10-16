// Seam E (.scratch/navigation-playback/spec.md): where the playhead goes on the Clip's frame grid
// (a frame is 1/fps of the Clip, its rate the Source's), how far the Timeline scrolls to show it,
// and the Loop Region (GLOSSARY.md), worked out from numbers alone.

// The Clip's frame rate until a Preview Plan says what it is.
export const DEFAULT_FPS = 30;
// A playhead brought back into view lands this many CSS pixels inside the Timeline's edge.
const REVEAL_PX = 48;
// A hair of float noise at a frame's boundary is forgiven.
const HAIR = 1e-6;

/** `time` on the nearest frame of the Clip at `fps`. */
export function onFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps;
}

/** The start of the Clip's last frame, the last one wholly in its `duration` at `fps`: End takes the playhead there. */
export function lastFrame(duration: number, fps: number): number {
  return Math.max(Math.floor(duration * fps + HAIR) - 1, 0) / fps;
}

/**
 * The playhead `frames` frames on from `time` (back when negative), on the frame grid: from the
 * frame nearest `time`, and kept between 0 and the Clip's last frame.
 */
export function stepFrames(time: number, frames: number, { fps, duration }: { fps: number; duration: number }): number {
  const frame = Math.round(time * fps) + frames;
  return Math.min(Math.max(frame / fps, 0), lastFrame(duration, fps));
}

/**
 * The scroll that shows a playhead `x` CSS pixels from 0 s on a Timeline showing `width` pixels from
 * `scroll`: as it is while the playhead is in view, else with the playhead REVEAL_PX inside the edge
 * it went past (a quarter of a narrow Timeline's width), never before 0 s.
 */
export function revealScroll(x: number, { scroll, width }: { scroll: number; width: number }): number {
  const margin = Math.min(REVEAL_PX, width / 4);
  if (x > scroll + width) return x - width + margin;
  if (x < scroll) return Math.max(x - margin, 0);
  return scroll;
}

// --- The Loop Region ---

/** The stretch playback repeats while Loop is on, in Timeline time: from `in` to `out`. */
export interface LoopRegion {
  in: number;
  out: number;
}

/** The In and Out marks as set at the playhead, in Timeline time: either may be unset. */
export interface LoopMarks {
  in: number | null;
  out: number | null;
}

/**
 * The Region `marks` make on a Clip `duration` long at `fps`: an unset In is the Clip's start and an
 * unset Out its end; crossed marks swap; both are kept inside the Clip, at least a frame apart. Null
 * with neither mark set, or a Clip shorter than a frame.
 */
export function loopRegion(marks: LoopMarks, { fps, duration }: { fps: number; duration: number }): LoopRegion | null {
  const frame = 1 / fps;
  if ((marks.in === null && marks.out === null) || duration < frame) return null;
  const within = (time: number) => Math.min(Math.max(time, 0), duration);
  const [a, b] = [within(marks.in ?? 0), within(marks.out ?? duration)];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end - start >= frame) return { in: start, out: end };
  // Closer than a frame: Out a frame after In, or at the Clip's end a frame before it.
  return start + frame <= duration ? { in: start, out: start + frame } : { in: duration - frame, out: duration };
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
