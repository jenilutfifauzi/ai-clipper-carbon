// Seam E (.scratch/navigation-playback/spec.md): where the playhead goes on the Clip's frame grid
// (a frame is 1/fps of the Clip, its rate the Source's), and how far the Timeline scrolls to show it,
// worked out from numbers alone.

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
